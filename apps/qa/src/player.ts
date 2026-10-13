// The player loop, two ways:
// - "claude": through Claude Code (the Agent SDK), signed in with the machine's own Claude login,
//   so no API key is needed.
// - "api": the Messages API with ANTHROPIC_API_KEY. Glitch notes go in as mid-conversation system
//   messages.
// Both run in chapters: when a prompt passes CHAPTER_TOKENS, or the developer changes the prompt
// (prompt.md, announced with `pnpm qa say --tag prompt`), the player writes a handoff and a fresh
// conversation starts from it, the notebook, the bugs and the current screen, on the prompt as it
// is then. With Claude Code the handoff is the notebook itself, rewritten, which comes before
// Claude Code's own auto-compact would.
// Either way the tools are the Toolbox's, and the words the player writes before a tool call are
// its "thoughts" on the stream.
import Anthropic from "@anthropic-ai/sdk";
import { createSdkMcpServer, query, tool, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { appendFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { Outcome } from "./game/types.ts";
import { systemPrompt, TOOLS, type Part, type ToolName, Toolbox, type ToolOutput } from "./toolbox.ts";

export const DEFAULT_MODEL = "claude-haiku-5-5";
export type Backend = "claude" | "api";

export interface PlayerOptions {
  toolbox: Toolbox;
  backend?: Backend;
  model?: string;
  /** Stops after this many turns (for trial runs). */
  maxTurns?: number;
}

const KEEP_PLAYING = "Keep playing: take your next action with a tool.";
/** Claude Code's request errors worth waiting out; the rest (sign-in, billing, a bad model) end the run. */
const TRANSIENT = new Set(["rate_limit", "overloaded", "server_error", "unknown"]);
const MAX_RETRIES = 6;

export class Player {
  readonly #box: Toolbox;
  readonly #backend: Backend;
  readonly #model: string;
  readonly #maxTurns: number;
  #stopped = false;
  #onStop: (() => void) | null = null;

  constructor(opts: PlayerOptions) {
    this.#box = opts.toolbox;
    this.#backend = opts.backend ?? "claude";
    this.#model = opts.model ?? DEFAULT_MODEL;
    this.#maxTurns = opts.maxTurns ?? Infinity;
  }

  stop(): void {
    this.#stopped = true;
    this.#box.release();
    this.#onStop?.();
  }

  get #done(): boolean {
    return this.#stopped || this.#box.turn >= this.#maxTurns;
  }

  run(first: Outcome): Promise<void> {
    const opening = this.#box.opening(`The game is loaded. ${first.text}`);
    return this.#backend === "claude" ? this.#runClaude(opening) : this.#runApi(opening);
  }

  #thoughts(content: readonly { type: string; text?: string }[]): void {
    for (const block of content) {
      const text = block.type === "text" ? block.text?.trim() : "";
      if (text) this.#box.bus.emit({ t: "thought", turn: this.#box.turn + 1, text });
    }
  }

  #log(entry: unknown): void {
    appendFileSync(join(this.#box.bus.dir, "transcript.jsonl"), JSON.stringify({ at: Date.now(), turn: this.#box.turn, entry }) + "\n");
  }

  // ---- Claude Code ----

  async #runClaude(opening: string): Promise<void> {
    // The player's own login, not a key: drop ANTHROPIC_API_KEY so Claude Code uses the subscription,
    // and anything a parent Claude Code session (one running this command) would otherwise pass down
    // (its proxy, its host-managed auth), which the player can't use.
    // CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) is the machine's subscription too, so it stays.
    // Or the token saved by `claude setup-token` on this machine, kept out of the repo and the shell env.
    const tokenFile = join(homedir(), ".config", "pokehd", "claude-oauth-token");
    if (!process.env["CLAUDE_CODE_OAUTH_TOKEN"] && existsSync(tokenFile)) process.env["CLAUDE_CODE_OAUTH_TOKEN"] = readFileSync(tokenFile, "utf8").trim();
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k === "CLAUDE_CODE_OAUTH_TOKEN" || !/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDECODE$)/.test(k)));
    // Claude Code tells the model the signed-in account's email, read from its own config. With a
    // token from `claude setup-token` the player doesn't need that config, so it gets an empty one
    // and never learns who is signed in. Without a token it borrows the machine's login, email included.
    const isolated = env["CLAUDE_CODE_OAUTH_TOKEN"] ? { CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), "pokehd-qa-config-")) } : {};
    if (!env["CLAUDE_CODE_OAUTH_TOKEN"]) console.warn("No CLAUDE_CODE_OAUTH_TOKEN: the player borrows this machine's Claude login, and Claude Code shows it the account's email. Save a token from `claude setup-token` in ~/.config/pokehd/claude-oauth-token to keep it out.");
    const sessionEnv = { ...env, ...isolated, CLAUDE_AGENT_SDK_CLIENT_APP: "pokehd-qa/1", ENABLE_CLAUDEAI_MCP_SERVERS: "false", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" };

    let next: string | null = opening;
    while (next !== null && !this.#done) {
      next = await this.#chapterClaude(next, sessionEnv);
      if (next !== null) this.#log({ chapter: next });
    }
  }

  /** One Claude Code conversation. Returns the next chapter's opening, or null when the run is over. */
  async #chapterClaude(opening: string, env: Record<string, string | undefined>): Promise<string | null> {
    const box = this.#box;
    box.promptChanged = false;
    let session: ReturnType<typeof query> | null = null;
    /** The last request's prompt size, in tokens. */
    let promptTokens = 0;
    // The handoff: asked for once the chapter is due, done when the notebook is rewritten (or the
    // player has had HANDOFF_TURNS turns to do it, so a forgetful player can't stall the reset).
    let handoffAt: number | null = null;
    let handoffDone = false;
    const handler = (name: ToolName) => async (args: Record<string, unknown>) => {
      // Past the turn limit (or after stop, or once the handoff is in) nothing runs. A note in a tool
      // result is only data to the player, which keeps chaining calls inside one turn, so the session
      // is interrupted.
      if (this.#done || handoffDone) {
        void session?.interrupt().catch(() => {});
        return { content: [{ type: "text" as const, text: handoffDone ? "A new chapter is starting." : "The session has ended." }], isError: true };
      }
      const out = await box.run(name, args);
      if (handoffAt !== null && ((name === "notebook" && args["action"] === "replace") || box.turn - handoffAt >= HANDOFF_TURNS)) handoffDone = true;
      // Developer mail and glitch notes ride on the result, since Claude Code has no system turns.
      const extra = [box.mail(), box.glitchNote()].filter((s): s is string => !!s).map((text): Part => ({ type: "text", text }));
      if (handoffAt === null && (box.promptChanged || promptTokens > CHAPTER_TOKENS)) {
        handoffAt = box.turn;
        extra.push({ type: "text", text: HANDOFF });
      }
      if (this.#done) this.#onStop?.();
      if (handoffDone) void session?.interrupt().catch(() => {});
      return {
        content: [...out.parts, ...extra].map((p) => (p.type === "text" ? { type: "text" as const, text: p.text } : { type: "image" as const, data: p.png.toString("base64"), mimeType: "image/png" })),
        ...(out.isError && { isError: true }),
      };
    };
    const server = createSdkMcpServer({
      name: "game",
      alwaysLoad: true,
      tools: (Object.keys(TOOLS) as ToolName[]).map((name) => tool(name, TOOLS[name].description, TOOLS[name].shape, handler(name))),
    });

    // The conversation's user side: the opening, then a nudge whenever the player stops without acting.
    const inbox: SDKUserMessage[] = [];
    let wake: (() => void) | null = null;
    const say = (text: string) => {
      inbox.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, origin: { kind: "human" } });
      wake?.();
    };
    const ended = () => this.#done || handoffDone;
    const prompt = async function* (): AsyncGenerator<SDKUserMessage> {
      while (!ended()) {
        if (!inbox.length) await new Promise<void>((r) => (wake = r));
        wake = null;
        while (inbox.length) yield inbox.shift()!;
      }
    };
    this.#onStop = () => {
      wake?.();
      void session?.interrupt().catch(() => {});
    };
    say(opening);

    session = query({
      prompt: prompt(),
      options: {
        model: this.#model,
        systemPrompt: systemPrompt(),
        tools: [],
        mcpServers: { game: server },
        allowedTools: Object.keys(TOOLS).map((name) => `mcp__game__${name}`),
        permissionMode: "dontAsk",
        // Nothing from this repository or the machine's own Claude setup, some of it personal: no
        // settings or CLAUDE.md, no claude.ai connectors or other MCP servers, no auto-memory. It
        // runs in an empty folder outside any git repository, so Claude Code ties it to no project.
        settingSources: [],
        strictMcpConfig: true,
        settings: { disableClaudeAiConnectors: true, autoMemoryEnabled: false },
        cwd: mkdtempSync(join(tmpdir(), "pokehd-qa-player-")),
        env,
      },
    });
    let failure: string | null = null;
    let retries = 0;
    try {
      for await (const message of session) {
        if (ended() && message.type === "result") break;
        if (message.type === "assistant" && !message.parent_tool_use_id) {
          this.#log({ role: "assistant", content: message.message.content, usage: message.message.usage, ...(message.error && { error: message.error }) });
          if (message.error) {
            // Claude Code reports a failed request as an assistant message: not the player's words.
            const text = message.message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ");
            if (!TRANSIENT.has(message.error) || retries >= MAX_RETRIES) {
              failure = `${message.error}: ${text}${message.error === "authentication_failed" ? " (sign this machine in with `claude auth login`, or set CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`, or use --via api)" : ""}`;
              break;
            }
            retries++;
            await new Promise((r) => setTimeout(r, 2000 * 2 ** retries));
            continue;
          }
          retries = 0;
          const usage = message.message.usage;
          promptTokens = usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
          this.#thoughts(message.message.content);
        } else if (message.type === "result") {
          this.#log({ result: message.subtype, ...(message.subtype !== "success" && { errors: message.errors }) });
          if (ended()) break;
          say(KEEP_PLAYING);
        }
      }
    } finally {
      session.close();
    }
    if (failure) throw new Error(`The player stopped: ${failure}`);
    if (this.#done || !handoffDone) return null;
    return box.opening(`${NEW_CHAPTER}\n\nThe screen now: ${(await box.driver.wait(500)).text}`);
  }

  // ---- Messages API ----

  async #runApi(opening: string): Promise<void> {
    const client = new Anthropic();
    const tools: Anthropic.Beta.BetaTool[] = (Object.keys(TOOLS) as ToolName[]).map((name) => ({
      name,
      description: TOOLS[name].description,
      input_schema: inputSchema(TOOLS[name].shape),
    }));
    let messages: Message[] = [user(opening)];
    let system = systemPrompt();
    this.#box.promptChanged = false;
    let systemTurns = true;

    const request = async (extra: Partial<Anthropic.Beta.MessageCreateParamsNonStreaming> = {}): Promise<Anthropic.Beta.BetaMessage> => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await client.beta.messages.create({ model: this.#model, max_tokens: MAX_TOKENS, system, tools, messages, cache_control: { type: "ephemeral" }, ...extra });
        } catch (error) {
          // Mid-conversation system messages are newer than some models: fall back to plain text.
          if (error instanceof Anthropic.BadRequestError && systemTurns && /role.*system/i.test(error.message)) {
            systemTurns = false;
            messages = messages.map((m) => (m.role === "system" ? user(`[${typeof m.content === "string" ? m.content : ""}]`) : m));
            continue;
          }
          if (error instanceof Anthropic.APIError && (error.status === undefined || error.status >= 500 || error.status === 429) && attempt < 6) {
            await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
            continue;
          }
          throw error;
        }
      }
    };

    while (!this.#done) {
      const response = await request();
      messages.push({ role: "assistant", content: response.content as Block[] });
      this.#log({ role: "assistant", content: response.content, usage: response.usage });
      this.#thoughts(response.content);

      const results: Block[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        results.push(toolResult(block.id, await this.#box.run(block.name, block.input as Record<string, unknown>)));
      }
      if (!results.length) {
        messages.push(user(KEEP_PLAYING));
        continue;
      }
      const mail = this.#box.mail();
      if (mail) results.push({ type: "text", text: mail });
      messages.push({ role: "user", content: results });
      const note = this.#box.glitchNote();
      if (note && systemTurns) messages.push({ role: "system", content: note });
      else if (note) results.push({ type: "text", text: `[${note}]` });

      const usage = response.usage;
      const prompt = usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
      if (prompt <= CHAPTER_TOKENS && !this.#box.promptChanged) continue;
      // A new chapter: the player's handoff, then a fresh conversation on the prompt as it is now.
      messages.push(user("This conversation is about to be reset, to save memory or because your instructions changed. Write a handoff for yourself: where you are, what you're doing and why, what you've learned about the controls, anything you were checking. Plain text, no tools."));
      const handoff = (await request({ tool_choice: { type: "none" } })).content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
      system = systemPrompt();
      this.#box.promptChanged = false;
      messages = [user(this.#box.opening(`${NEW_CHAPTER}\n\nHandoff from before the reset:\n${handoff}\n\nThe screen now: ${(await this.#box.driver.wait(500)).text}`))];
      this.#log({ chapter: messages[0] });
    }
  }
}

type Message = Anthropic.Beta.BetaMessageParam;
type Block = Anthropic.Beta.BetaContentBlockParam;
const CHAPTER_TOKENS = 150_000;
/** Turns the player gets to write its handoff before the chapter ends anyway. */
const HANDOFF_TURNS = 4;
const HANDOFF =
  "Your conversation is about to be reset for a new chapter (to save memory, or because your instructions changed). Before anything else, use notebook with action replace to write your handoff: where you are and where you're heading, what you're doing and why, what you've learned about the controls and the game, bugs to recheck, anything you were in the middle of. Keep what still matters from your current notebook; under about 60 lines.";
const NEW_CHAPTER = "A new chapter: your conversation was reset, and your instructions may have changed, so reread them. Your notebook above is your handoff from before. Carry on from where you are.";
const MAX_TOKENS = 8_000;

function inputSchema(shape: z.ZodRawShape): Anthropic.Beta.BetaTool.InputSchema {
  const { $schema: _, ...schema } = z.toJSONSchema(z.object(shape));
  return schema as Anthropic.Beta.BetaTool.InputSchema;
}

function user(text: string): Message {
  return { role: "user", content: [{ type: "text", text }] };
}

function toolResult(id: string, out: ToolOutput): Anthropic.Beta.BetaToolResultBlockParam {
  return {
    type: "tool_result",
    tool_use_id: id,
    content: out.parts.map((p) => (p.type === "text" ? { type: "text" as const, text: p.text } : { type: "image" as const, source: { type: "base64" as const, media_type: "image/png" as const, data: p.png.toString("base64") } })),
    ...(out.isError && { is_error: true }),
  };
}
