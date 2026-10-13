// The player: a Haiku agent that plays the game through the driver's touches, keeps a notebook,
// reports bugs and talks to the developer. Each tool call is one turn. The words it writes before
// a tool call are its "thoughts" on the stream.
//
// Context: the conversation runs in chapters. When a request's prompt passes CHAPTER_TOKENS, the
// player writes a handoff and a new chapter starts from it, the notebook and the current screen,
// so prompts stay in the model's cheaper band and old screenshots fall away.
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { Bus } from "./bus.ts";
import type { ActionEvent, ActionKind, ChatEvent, ChatTag, Severity } from "./events.ts";
import type { Direction, GameDriver, Outcome } from "./game/types.ts";

type Message = Anthropic.Beta.BetaMessageParam;
type Block = Anthropic.Beta.BetaContentBlockParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

export const DEFAULT_MODEL = "claude-haiku-5-5";
const CHAPTER_TOKENS = 90_000;
const MAX_TOKENS = 8_000;
/** How long the player waits for the developer before carrying on alone. */
const REPLY_TIMEOUT_MS = 30 * 60_000;

const SYSTEM = `You are the QA tester for pokeHD, a fan-made HD remake of the original 1996 Game Boy monster-catching RPG (the blue version). The real game runs underneath in an emulator; on top it has a 3D world, new menus (a Pokédex-style menu replaces the Start menu), tap-friendly text boxes and on-screen touch controls. You are playing it live on a stream, start to finish, the way a child would on a phone.

Your job, in order:
1. Find bugs: anything broken, confusing, ugly, slow, or different from how the original game behaves. Report each with report_bug. Small things count.
2. Make progress through the game (the goal is to finish it), because progress takes you to new places where new bugs live.

How you play:
- You only have touch: tap the screen and use the on-screen joystick, like a person. The screen is 528 wide by 1000 tall (CSS pixels); (0,0) is the top left.
- After each action you get a short text description of what's on screen: where you are, the text and choices showing (with where to tap them), or a small text map around you. It does not tell you everything; take a screenshot when you need to see. Screenshots are cheap enough, but don't take one every turn.
- Every action is a turn and is numbered. contact_sheet shows recorded frames around an earlier turn: use it when something looked off for a moment.
- If the game gets stuck or something needs a fresh start (or the developer tells you a fix is in), use restart_game. By default it comes back exactly where you are; from:"save" rolls back to your last in-game save.
- Keep a notebook for things you need to remember (where you are going, what's in your bag, places to revisit, bugs to recheck). It survives restarts; your memory of this conversation doesn't always.
- Save the game in the game's own menu now and then, like a careful player.

Talking to the developer (Claude Opus, who fixes bugs and builds your tools): use message_developer. Ask for tools or information you wish you had; they can change the harness. Set wait_for_reply when you need an answer before continuing; the game pauses on stream while you wait. Messages from the developer arrive with your next result. When they say a bug is fixed, retest it when you can.

You must not cheat: no guessing hidden information, no looking things up outside what the game shows you.

Viewers are watching. Before every tool call, write one short sentence (under 20 words) saying what you're doing and why, in a friendly voice. Don't write anything else outside tool calls.`;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "tap",
    description: "Tap the screen at (x, y) in screen pixels (528×1000, origin top left). Returns what's on screen afterwards.",
    input_schema: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, what: { type: "string", description: "What you're tapping, e.g. \"YES\" or \"the Pokédex\"." } }, required: ["x", "y", "what"] },
  },
  {
    name: "joystick",
    description: "Push the on-screen joystick in a direction for about `tiles` steps (1–8), then let go. Returns what's on screen afterwards.",
    input_schema: { type: "object", properties: { direction: { type: "string", enum: ["up", "down", "left", "right"] }, tiles: { type: "integer", minimum: 1, maximum: 8 } }, required: ["direction", "tiles"] },
  },
  {
    name: "wait",
    description: "Do nothing for a few seconds (e.g. while text prints or an animation plays). Returns what's on screen afterwards.",
    input_schema: { type: "object", properties: { seconds: { type: "number", minimum: 0.5, maximum: 10 } }, required: ["seconds"] },
  },
  { name: "screenshot", description: "See the screen as it is now.", input_schema: { type: "object", properties: {} } },
  {
    name: "contact_sheet",
    description: "See recorded frames around an earlier turn as one image: from `before` seconds before that turn started to `after` seconds after, at `fps` frames per second (at most 24 frames). The recording keeps about the last 90 seconds.",
    input_schema: {
      type: "object",
      properties: { turn: { type: "integer" }, before: { type: "number", minimum: 0, maximum: 10 }, after: { type: "number", minimum: 0, maximum: 10 }, fps: { type: "number", minimum: 0.5, maximum: 12 } },
      required: ["turn", "before", "after", "fps"],
    },
  },
  {
    name: "notebook",
    description: "Your notebook. read: returns it. append: adds a line. replace: rewrites it entirely (keep it under about 60 lines).",
    input_schema: { type: "object", properties: { action: { type: "string", enum: ["read", "append", "replace"] }, text: { type: "string" } }, required: ["action"] },
  },
  {
    name: "report_bug",
    description: "Report a bug. A screenshot, the last few seconds of recording, the save and the page's state are attached automatically, so report it right when you see it.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short, specific: \"PC message ignores the first tap\"." },
        severity: { type: "string", enum: ["high", "med", "low"], description: "high: blocks play or loses progress; med: wrong or confusing; low: cosmetic." },
        steps: { type: "string" },
        expected: { type: "string" },
        actual: { type: "string" },
      },
      required: ["title", "severity", "steps", "expected", "actual"],
    },
  },
  {
    name: "message_developer",
    description: "Send the developer a message: a question, a harness request, a note about a bug. With wait_for_reply the game pauses until they answer.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string" },
        tag: { type: "string", enum: ["bug", "harness", "question", "note"] },
        bug: { type: "integer", description: "The bug this is about, if any." },
        wait_for_reply: { type: "boolean" },
      },
      required: ["text", "tag"],
    },
  },
  {
    name: "restart_game",
    description: "Reload the game, picking up any fixes. Comes back exactly where you are unless from is \"save\", which rolls back to your last in-game save.",
    input_schema: { type: "object", properties: { from: { type: "string", enum: ["now", "save"] } } },
  },
  {
    name: "set_goal",
    description: "Set the goal shown to viewers: what you're trying to do right now, in one line.",
    input_schema: { type: "object", properties: { goal: { type: "string" } }, required: ["goal"] },
  },
];

const ARROWS: Record<Direction, string> = { up: "↑", down: "↓", left: "←", right: "→" };

export interface PlayerOptions {
  bus: Bus;
  driver: GameDriver;
  model?: string;
  /** Stops after this many turns (for trial runs). */
  maxTurns?: number;
}

export class Player {
  readonly #client = new Anthropic();
  readonly #bus: Bus;
  readonly #driver: GameDriver;
  readonly #model: string;
  readonly #maxTurns: number;
  #messages: Message[] = [];
  #turn = 0;
  #chapter = 0;
  /** Developer messages not yet shown to the player. */
  #inbox: ChatEvent[] = [];
  #replyWaiter: (() => void) | null = null;
  #systemTurns = true;
  #stopped = false;

  constructor(opts: PlayerOptions) {
    this.#bus = opts.bus;
    this.#driver = opts.driver;
    this.#model = opts.model ?? DEFAULT_MODEL;
    this.#maxTurns = opts.maxTurns ?? Infinity;
    this.#bus.on((e) => {
      if (e.t !== "chat" || e.from !== "developer") return;
      this.#inbox.push(e);
      this.#replyWaiter?.();
    });
  }

  stop(): void {
    this.#stopped = true;
    this.#replyWaiter?.();
  }

  async run(first: Outcome): Promise<void> {
    this.#startChapter(`The game is loaded. ${first.text}`);
    while (!this.#stopped && this.#turn < this.#maxTurns) {
      const response = await this.#request();
      this.#messages.push({ role: "assistant", content: response.content as Block[] });
      this.#log({ role: "assistant", content: response.content, usage: response.usage });

      const results: Block[] = [];
      for (const block of response.content) {
        if (block.type === "text" && block.text.trim()) this.#bus.emit({ t: "thought", turn: this.#turn + 1, text: block.text.trim() });
        if (block.type === "tool_use") results.push(await this.#call(block));
      }
      if (response.stop_reason === "refusal" || !results.length) {
        // It answered without acting: nudge it back to the game.
        this.#messages.push({ role: "user", content: [{ type: "text", text: "Keep playing: take your next action with a tool." }] });
        continue;
      }
      results.push(...this.#mail());
      this.#messages.push({ role: "user", content: results });
      this.#glitchNotice();

      const usage = response.usage;
      const prompt = usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
      if (prompt > CHAPTER_TOKENS) await this.#nextChapter();
    }
  }

  async #request(): Promise<Anthropic.Beta.BetaMessage> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#client.beta.messages.create({
          model: this.#model,
          max_tokens: MAX_TOKENS,
          system: SYSTEM,
          tools: TOOLS,
          messages: this.#messages,
          cache_control: { type: "ephemeral" },
        });
      } catch (error) {
        // Mid-conversation system messages are newer than some models: fall back to plain text.
        if (error instanceof Anthropic.BadRequestError && this.#systemTurns && /role.*system/i.test(error.message)) {
          this.#systemTurns = false;
          this.#messages = this.#messages.flatMap((m): Message[] => (m.role === "system" ? [] : [m]));
          continue;
        }
        if (error instanceof Anthropic.APIError && (error.status === undefined || error.status >= 500 || error.status === 429) && attempt < 6) {
          await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
          continue;
        }
        throw error;
      }
    }
  }

  async #call(block: Anthropic.Beta.BetaToolUseBlock): Promise<ToolResult> {
    const input = block.input as Record<string, unknown>;
    const turn = ++this.#turn;
    this.#driver.markTurn(turn);
    const result = (content: ToolResult["content"], isError = false): ToolResult => ({ type: "tool_result", tool_use_id: block.id, content, ...(isError && { is_error: true }) });
    const text = (s: string) => [{ type: "text" as const, text: `Turn ${turn}. ${s}` }];
    const act = (kind: ActionKind, label: string) => this.#bus.emit<ActionEvent>({ t: "action", turn, kind, label });
    try {
      switch (block.name) {
        case "tap": {
          const x = Number(input["x"]);
          const y = Number(input["y"]);
          act("tap", `tap ${String(input["what"] ?? `${x},${y}`)}`);
          return result(text((await this.#driver.tap(x, y)).text));
        }
        case "joystick": {
          const direction = input["direction"] as Direction;
          const tiles = Math.max(1, Math.min(8, Math.round(Number(input["tiles"]) || 1)));
          act("joystick", `joystick ${ARROWS[direction]} ${tiles} tile${tiles === 1 ? "" : "s"}`);
          return result(text((await this.#driver.joystick(direction, tiles)).text));
        }
        case "wait": {
          const seconds = Math.max(0.5, Math.min(10, Number(input["seconds"]) || 1));
          act("wait", `wait ${seconds}s`);
          return result(text((await this.#driver.wait(seconds * 1000)).text));
        }
        case "screenshot": {
          act("screenshot", "screenshot");
          return result([...text("The screen now:"), png(await this.#driver.screenshot())]);
        }
        case "contact_sheet": {
          const at = Number(input["turn"]);
          const before = Number(input["before"]);
          const after = Number(input["after"]);
          const fps = Number(input["fps"]);
          act("contact_sheet", `contact sheet turn ${at} −${before}s…+${after}s`);
          return result([...text(`Frames around turn ${at}, ${fps} per second:`), png(await this.#driver.contactSheet(at, before, after, fps))]);
        }
        case "notebook":
          return result(text(this.#notebook(input, act)));
        case "report_bug":
          return result(text(await this.#reportBug(input, turn)));
        case "message_developer":
          return result(text(await this.#message(input)));
        case "restart_game": {
          const from = input["from"] === "save" ? "save" : "now";
          act("tap", from === "save" ? "restart from last save" : "restart game");
          return result(text((await this.#driver.restart({ from })).text));
        }
        case "set_goal": {
          const goal = String(input["goal"] ?? "").trim();
          this.#bus.setStatus({ goal });
          return result(text(`Goal set: ${goal}`));
        }
        default:
          return result(text(`There's no tool called ${block.name}.`), true);
      }
    } catch (error) {
      return result(text(`That didn't work: ${error instanceof Error ? error.message : String(error)}`), true);
    } finally {
      await this.#refreshStatus(turn);
    }
  }

  #notebook(input: Record<string, unknown>, act: (kind: ActionKind, label: string) => void): string {
    const path = this.#bus.notebookPath;
    const current = existsSync(path) ? readFileSync(path, "utf8") : "";
    const value = String(input["text"] ?? "").trim();
    if (input["action"] === "append" && value) {
      act("notebook", "notebook: noted");
      appendFileSync(path, value + "\n");
      return "Noted.";
    }
    if (input["action"] === "replace") {
      act("notebook", "notebook: rewritten");
      writeFileSync(path, value + "\n");
      return "Notebook rewritten.";
    }
    return current.trim() ? `Your notebook:\n${current}` : "Your notebook is empty.";
  }

  async #reportBug(input: Record<string, unknown>, turn: number): Promise<string> {
    const severity: Severity = input["severity"] === "high" || input["severity"] === "low" ? input["severity"] : "med";
    const bug = this.#bus.addBug({
      turn,
      title: String(input["title"] ?? "Untitled"),
      severity,
      steps: String(input["steps"] ?? ""),
      expected: String(input["expected"] ?? ""),
      actual: String(input["actual"] ?? ""),
    });
    this.#bus.emit<ActionEvent>({ t: "action", turn, kind: "report_bug", label: `report bug #${bug.id}` });
    let attachments: string[] = [];
    try {
      attachments = await this.#driver.collectEvidence(this.#bus.bugDir(bug.id), turn);
      this.#bus.updateBug(bug.id, { attachments });
    } catch (error) {
      attachments = [`(evidence failed: ${String(error)})`];
    }
    this.#bus.emit<ChatEvent>({ t: "chat", from: "player", tag: "bug", bug: bug.id, text: `${bug.title}. ${bug.actual}` });
    return `Filed as bug #${bug.id} (${severity}), with ${attachments.length} attachments. The developer has been told.`;
  }

  async #message(input: Record<string, unknown>): Promise<string> {
    const tags: ChatTag[] = ["bug", "harness", "question", "note"];
    const tag = tags.includes(input["tag"] as ChatTag) ? (input["tag"] as ChatTag) : "note";
    const bug = typeof input["bug"] === "number" ? input["bug"] : undefined;
    this.#bus.emit<ChatEvent>({ t: "chat", from: "player", tag, text: String(input["text"] ?? ""), ...(bug !== undefined && { bug }) });
    if (!input["wait_for_reply"]) return "Sent.";
    if (!this.#inbox.length) {
      this.#bus.setStatus({ mode: "talk" });
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, REPLY_TIMEOUT_MS);
        this.#replyWaiter = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.#replyWaiter = null;
      // Linger on the conversation a moment so viewers can read the answer.
      await new Promise((r) => setTimeout(r, 6000));
      this.#bus.setStatus({ mode: "play" });
    }
    const replies = this.#inbox.splice(0);
    return replies.length ? `Sent. The developer replied:\n${replies.map(describeChat).join("\n")}` : "Sent. No reply after 30 minutes; carry on and check back later.";
  }

  /** Developer messages that arrived while the player was busy, as text after the tool results. */
  #mail(): Block[] {
    const mail = this.#inbox.splice(0);
    return mail.length ? [{ type: "text", text: `Message from the developer:\n${mail.map(describeChat).join("\n")}` }] : [];
  }

  /** Harness heuristics that spotted something on screen, as a system note after the latest results. */
  #glitchNotice(): void {
    const glitches = this.#driver.takeGlitches();
    if (!glitches.length) return;
    for (const g of glitches) this.#bus.emit({ t: "glitch", turn: this.#turn, kind: g.kind, text: g.text });
    const note = `Harness glitch detector, during turn ${this.#turn}:\n${glitches.map((g) => `- ${g.text}`).join("\n")}\nLook into it (contact_sheet helps) and report it if it's a real bug.`;
    if (this.#systemTurns) this.#messages.push({ role: "system", content: note });
    else (this.#messages.at(-1)!.content as Block[]).push({ type: "text", text: `[${note}]` });
  }

  async #refreshStatus(turn: number): Promise<void> {
    try {
      const s = await this.#driver.status();
      this.#bus.setStatus({ turn, map: s.map, playTime: s.playTime, fps: s.fps });
    } catch {
      this.#bus.setStatus({ turn });
    }
  }

  #startChapter(opening: string): void {
    this.#chapter++;
    const path = this.#bus.notebookPath;
    const notebook = existsSync(path) ? readFileSync(path, "utf8").trim() : "";
    const bugs = this.#bus.bugs.slice(-30).map((b) => `#${b.id} [${b.status}] ${b.title}`).join("\n");
    const goal = this.#bus.status?.goal;
    this.#messages = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              notebook ? `Your notebook:\n${notebook}` : "Your notebook is empty.",
              bugs ? `Bugs reported so far:\n${bugs}` : "No bugs reported yet.",
              goal ? `Your goal shown to viewers: ${goal}` : "Set a goal for viewers with set_goal.",
              opening,
            ].join("\n\n"),
          },
        ],
      },
    ];
    this.#log({ chapter: this.#chapter, opening: this.#messages[0] });
  }

  /** Asks for a handoff note, then starts a fresh conversation from it. */
  async #nextChapter(): Promise<void> {
    this.#messages.push({
      role: "user",
      content: [{ type: "text", text: "This conversation is about to be reset to save memory. Write a handoff for yourself: where you are, what you're doing and why, what you've learned about the controls, anything you were checking. Plain text, no tools." }],
    });
    // The model may still try a tool; the answer text is what's kept.
    const response = await this.#client.beta.messages.create({
      model: this.#model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      tools: TOOLS,
      tool_choice: { type: "none" },
      messages: this.#messages,
      cache_control: { type: "ephemeral" },
    });
    const handoff = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    this.#startChapter(`Handoff from before the reset:\n${handoff}\n\nThe screen now: ${(await this.#driver.wait(500)).text}`);
  }

  #log(entry: unknown): void {
    appendFileSync(join(this.#bus.dir, "transcript.jsonl"), JSON.stringify({ at: Date.now(), turn: this.#turn, entry }) + "\n");
  }
}

function png(data: Buffer): Anthropic.Beta.BetaImageBlockParam {
  return { type: "image", source: { type: "base64", media_type: "image/png", data: data.toString("base64") } };
}

function describeChat(c: ChatEvent): string {
  return `${c.tag ? `[${c.tag}${c.bug !== undefined ? ` #${c.bug}` : ""}] ` : ""}${c.text}`;
}
