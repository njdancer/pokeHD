// One scenario played by the model through Claude Code (the Agent SDK) on the subscription token,
// the way the live player runs: the QA prompt as the system prompt, the variant's movement tools
// and nothing else. It ends when the goal is met, the turn cap is hit, or the model stops calling
// tools.
import { createSdkMcpServer, query, tool, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { systemPrompt } from "../toolbox.ts";
import { reached, type Scenario } from "./scenarios.ts";
import type { Sim } from "./sim.ts";
import type { Variant } from "./variants.ts";

export interface TurnLog {
  tool: string;
  input: Record<string, unknown>;
  asked: number | null;
  walked: number | null;
  stop: string | null;
  at: { map: number; x: number; y: number };
  error?: boolean;
  /** What the model wrote before the call. */
  thought?: string;
}

export interface EpisodeResult {
  scenario: string;
  variant: string;
  rep: number;
  model: string;
  success: boolean;
  /** success, cap (turn cap), stopped (the model ended without arriving), error. */
  end: "success" | "cap" | "stopped" | "error";
  turns: number;
  /** Arrows asked for, and steps actually walked, over the episode. */
  asked: number;
  walked: number;
  par: number;
  parTurns: number;
  /** Tokens over every request: prompt (input + cache read + cache write) and output. */
  inputTokens: number;
  outputTokens: number;
  requests: number;
  ms: number;
  log: TurnLog[];
  /** The model's last words (why it stopped, when it did). */
  last?: string;
  error?: string;
}

let sessionEnv: Record<string, string | undefined> | null = null;

/** Claude Code's environment, as the live player builds it: the saved subscription token, an empty config. */
function env(): Record<string, string | undefined> {
  if (sessionEnv) return sessionEnv;
  const tokenFile = join(homedir(), ".config", "pokehd", "claude-oauth-token");
  if (!process.env["CLAUDE_CODE_OAUTH_TOKEN"] && existsSync(tokenFile)) process.env["CLAUDE_CODE_OAUTH_TOKEN"] = readFileSync(tokenFile, "utf8").trim();
  if (!process.env["CLAUDE_CODE_OAUTH_TOKEN"]) throw new Error("No subscription token: save one from `claude setup-token` in ~/.config/pokehd/claude-oauth-token");
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => k === "CLAUDE_CODE_OAUTH_TOKEN" || !/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDECODE$)/.test(k)));
  sessionEnv = {
    ...base,
    CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), "pokehd-eval-config-")),
    CLAUDE_AGENT_SDK_CLIENT_APP: "pokehd-qa-eval/1",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
  };
  return sessionEnv;
}

export function openingText(scenario: Scenario, variant: Variant, sim: Sim): string {
  return `Movement drill: ${Object.keys(variant.tools).length > 1 ? `only ${Object.keys(variant.tools).join(" and ")} work` : "only the joystick works"} for this one, and the drill ends by itself the moment you get there.\nGoal: ${scenario.text}\n\nThe screen now: ${variant.opening(sim)}`;
}

export async function playEpisode(sim: Sim, scenario: Scenario, variant: Variant, opts: { model: string; rep: number }): Promise<EpisodeResult> {
  const started = Date.now();
  sim.teleport(scenario.start, scenario.lastMap, { events: scenario.events ?? [], hidden: scenario.hidden ?? [] });
  const result: EpisodeResult = {
    scenario: scenario.id,
    variant: variant.id,
    rep: opts.rep,
    model: opts.model,
    success: false,
    end: "stopped",
    turns: 0,
    asked: 0,
    walked: 0,
    par: scenario.par,
    parTurns: scenario.parTurns,
    inputTokens: 0,
    outputTokens: 0,
    requests: 0,
    ms: 0,
    log: [],
  };
  let session: ReturnType<typeof query> | null = null;
  let finished = false;
  let thought = "";
  const handler = (name: string) => async (args: Record<string, unknown>) => {
    if (finished) {
      void session?.interrupt().catch(() => {});
      return { content: [{ type: "text" as const, text: "The drill is over." }], isError: true };
    }
    const turn = ++result.turns;
    const out = variant.tools[name]!.run(sim, args, turn);
    const s = sim.state();
    result.log.push({
      tool: name,
      input: args,
      asked: out.walk?.asked ?? null,
      walked: out.walk?.walked ?? null,
      stop: out.walk?.stop ?? null,
      at: { map: s.mapId, x: s.player.x, y: s.player.y },
      ...(out.isError && { error: true }),
      ...(thought && { thought }),
    });
    thought = "";
    if (out.walk) {
      result.asked += out.walk.asked;
      result.walked += out.walk.walked;
    }
    if (reached(scenario, s)) {
      result.success = true;
      result.end = "success";
      finished = true;
    } else if (turn >= scenario.turnCap) {
      result.end = "cap";
      finished = true;
    }
    if (finished) void session?.interrupt().catch(() => {});
    return { content: [{ type: "text" as const, text: out.text }], ...(out.isError && { isError: true }) };
  };
  const server = createSdkMcpServer({
    name: "game",
    alwaysLoad: true,
    tools: Object.entries(variant.tools).map(([name, t]) => tool(name, t.description, t.shape, handler(name))),
  });
  let sent = false;
  let release: (() => void) | null = null;
  const prompt = async function* (): AsyncGenerator<SDKUserMessage> {
    if (!sent) {
      sent = true;
      yield { type: "user", message: { role: "user", content: openingText(scenario, variant, sim) }, parent_tool_use_id: null, origin: { kind: "human" } };
    }
    // Hold the input open until the episode ends, so Claude Code doesn't close the session early.
    await new Promise<void>((r) => (release = r));
  };
  session = query({
    prompt: prompt(),
    options: {
      model: opts.model,
      systemPrompt: systemPrompt(),
      tools: [],
      mcpServers: { game: server },
      allowedTools: Object.keys(variant.tools).map((n) => `mcp__game__${n}`),
      permissionMode: "dontAsk",
      settingSources: [],
      strictMcpConfig: true,
      settings: { disableClaudeAiConnectors: true, autoMemoryEnabled: false },
      cwd: mkdtempSync(join(tmpdir(), "pokehd-eval-player-")),
      env: env(),
    },
  });
  try {
    for await (const message of session) {
      if (message.type === "assistant" && !message.parent_tool_use_id) {
        if (message.error) {
          result.error = `${message.error}`;
          if (!["rate_limit", "overloaded", "server_error"].includes(message.error)) {
            result.end = "error";
            break;
          }
          continue;
        }
        const u = message.message.usage;
        result.requests++;
        result.inputTokens += u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        result.outputTokens += u.output_tokens;
        const text = message.message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ").trim();
        if (text) {
          thought = thought ? `${thought} ${text}` : text;
          result.last = text;
        }
      } else if (message.type === "result") {
        break;
      }
      if (finished) break;
    }
  } catch (error) {
    if (!finished) {
      result.end = "error";
      result.error = error instanceof Error ? error.message : String(error);
    }
  } finally {
    (release as (() => void) | null)?.();
    session.close();
  }
  result.ms = Date.now() - started;
  return result;
}
