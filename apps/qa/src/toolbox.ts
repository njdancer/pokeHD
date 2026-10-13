// What the player can do, shared by both ways of running it (./player.ts): the API with a key,
// or Claude Code with the machine's own login. Each tool call is one turn. Tool results come
// back as text and images; developer messages and glitch notes ride along after them.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import type { Bus } from "./bus.ts";
import type { ActionEvent, ActionKind, ChatEvent, ChatTag, Severity } from "./events.ts";
import type { Direction, GameDriver } from "./game/types.ts";

/** How long the player waits for the developer before carrying on alone. */
const REPLY_TIMEOUT_MS = 30 * 60_000;

export const SYSTEM = `You are the QA tester for pokeHD, a fan-made HD remake of the original 1996 Game Boy monster-catching RPG (the blue version). The real game runs underneath in an emulator; on top it has a 3D world, new menus (a Pokédex-style menu replaces the Start menu), tap-friendly text boxes and on-screen touch controls. You are playing it live on a stream, start to finish, the way a child would on a phone.

Your job, in order:
1. Find bugs: anything broken, confusing, ugly, slow, or different from how the original game behaves. Report each with report_bug. Small things count.
2. Make progress through the game (the goal is to finish it), because progress takes you to new places where new bugs live.

How you play:
- You only have touch: tap the screen and use the on-screen joystick, like a person. The screen is 528 wide by 1000 tall (CSS pixels); (0,0) is the top left.
- After each action you get a short text description of what's on screen: where you are, the text and choices showing (with where to tap them), or a small text map around you. It does not tell you everything; take a screenshot when you need to see. Screenshots are cheap enough, but don't take one every turn.
- Underneath the HD game is the original Game Boy screen, which comes to the front wherever the HD version doesn't cover something yet. When it flashes up or takes over during an action, the result ends with a "Screen:" line timing it. A brief flash, or the Game Boy screen somewhere it looks out of place, is worth a contact_sheet and, the first time you see it somewhere new, a bug report.
- Every action is a turn and is numbered. contact_sheet shows recorded frames around an earlier turn: use it when something looked off for a moment.
- If the game gets stuck or something needs a fresh start (or the developer tells you a fix is in), use restart_game. By default it comes back exactly where you are; from:"save" rolls back to your last in-game save.
- Keep a notebook for things you need to remember (where you are going, what's in your bag, places to revisit, bugs to recheck). It survives restarts; your memory of this conversation doesn't always.
- Save the game in the game's own menu now and then, like a careful player.

Talking to the developer (Claude Opus, who fixes bugs and builds your tools): use message_developer. Ask for tools or information you wish you had; they can change the harness. Set wait_for_reply when you need an answer before continuing; the game pauses on stream while you wait. Messages from the developer arrive with your next result. When they say a bug is fixed, retest it when you can.

You must not cheat: no guessing hidden information, no looking things up outside what the game shows you.

Viewers are watching. Before every tool call, write one short sentence (under 20 words) saying what you're doing and why, in a friendly voice. Don't write anything else outside tool calls. Never stop playing: always end with a tool call.`;

/** Tool inputs, as zod shapes (the Claude Code side takes these; the API side converts them to JSON Schema). */
export const TOOLS = {
  tap: {
    description: "Tap the screen at (x, y) in screen pixels (528×1000, origin top left). Returns what's on screen afterwards.",
    shape: { x: z.number(), y: z.number(), what: z.string().describe('What you\'re tapping, e.g. "YES" or "the Pokédex".') },
  },
  joystick: {
    description: "Push the on-screen joystick in a direction for about `tiles` steps (1–8), then let go. Returns what's on screen afterwards.",
    shape: { direction: z.enum(["up", "down", "left", "right"]), tiles: z.number().int().min(1).max(8) },
  },
  wait: {
    description: "Do nothing for a few seconds (e.g. while text prints or an animation plays). Returns what's on screen afterwards.",
    shape: { seconds: z.number().min(0.5).max(10) },
  },
  screenshot: { description: "See the screen as it is now.", shape: {} },
  contact_sheet: {
    description:
      "See recorded frames around an earlier turn as one image: from `before` seconds before that turn started to `after` seconds after, at `fps` frames per second (at most 24 frames). The recording keeps about the last 90 seconds.",
    shape: { turn: z.number().int(), before: z.number().min(0).max(10), after: z.number().min(0).max(10), fps: z.number().min(0.5).max(12) },
  },
  notebook: {
    description: "Your notebook. read: returns it. append: adds a line. replace: rewrites it entirely (keep it under about 60 lines).",
    shape: { action: z.enum(["read", "append", "replace"]), text: z.string().optional() },
  },
  report_bug: {
    description: "Report a bug. A screenshot, the last few seconds of recording, the save and the page's state are attached automatically, so report it right when you see it.",
    shape: {
      title: z.string().describe('Short, specific: "PC message ignores the first tap".'),
      severity: z.enum(["high", "med", "low"]).describe("high: blocks play or loses progress; med: wrong or confusing; low: cosmetic."),
      steps: z.string(),
      expected: z.string(),
      actual: z.string(),
    },
  },
  message_developer: {
    description: "Send the developer a message: a question, a harness request, a note about a bug. With wait_for_reply the game pauses until they answer.",
    shape: {
      text: z.string(),
      tag: z.enum(["bug", "harness", "question", "note"]),
      bug: z.number().int().optional().describe("The bug this is about, if any."),
      wait_for_reply: z.boolean().optional(),
    },
  },
  restart_game: {
    description: 'Reload the game, picking up any fixes. Comes back exactly where you are unless from is "save", which rolls back to your last in-game save.',
    shape: { from: z.enum(["now", "save"]).optional() },
  },
  set_goal: {
    description: "Set the goal shown to viewers: what you're trying to do right now, in one line.",
    shape: { goal: z.string() },
  },
} satisfies Record<string, { description: string; shape: z.ZodRawShape }>;

export type ToolName = keyof typeof TOOLS;

export type Part = { type: "text"; text: string } | { type: "image"; png: Buffer };
export interface ToolOutput {
  parts: Part[];
  isError?: boolean;
}

const ARROWS: Record<Direction, string> = { up: "↑", down: "↓", left: "←", right: "→" };

export class Toolbox {
  readonly bus: Bus;
  readonly driver: GameDriver;
  turn = 0;
  /** Developer messages not yet shown to the player. */
  #inbox: ChatEvent[] = [];
  #replyWaiter: (() => void) | null = null;

  constructor(bus: Bus, driver: GameDriver) {
    this.bus = bus;
    this.driver = driver;
    bus.on((e) => {
      if (e.t !== "chat" || e.from !== "developer") return;
      this.#inbox.push(e);
      this.#replyWaiter?.();
    });
  }

  /** Lets a player waiting on the developer go (when stopping). */
  release(): void {
    this.#replyWaiter?.();
  }

  /** Runs one tool call as a turn. Never throws: failures come back as an error result. */
  async run(name: string, input: Record<string, unknown>): Promise<ToolOutput> {
    const turn = ++this.turn;
    this.driver.markTurn(turn);
    const text = (s: string, isError = false): ToolOutput => ({ parts: [{ type: "text", text: `Turn ${turn}. ${s}` }], ...(isError && { isError }) });
    const image = (caption: string, png: Buffer): ToolOutput => ({ parts: [{ type: "text", text: `Turn ${turn}. ${caption}` }, { type: "image", png }] });
    const act = (kind: ActionKind, label: string) => this.bus.emit<ActionEvent>({ t: "action", turn, kind, label });
    try {
      switch (name as ToolName) {
        case "tap": {
          const x = Number(input["x"]);
          const y = Number(input["y"]);
          act("tap", `tap ${String(input["what"] ?? `${x},${y}`)}`);
          return text((await this.driver.tap(x, y)).text);
        }
        case "joystick": {
          const direction = input["direction"] as Direction;
          if (!(direction in ARROWS)) return text("direction must be up, down, left or right.", true);
          const tiles = Math.max(1, Math.min(8, Math.round(Number(input["tiles"]) || 1)));
          act("joystick", `joystick ${ARROWS[direction]} ${tiles} tile${tiles === 1 ? "" : "s"}`);
          return text((await this.driver.joystick(direction, tiles)).text);
        }
        case "wait": {
          const seconds = Math.max(0.5, Math.min(10, Number(input["seconds"]) || 1));
          act("wait", `wait ${seconds}s`);
          return text((await this.driver.wait(seconds * 1000)).text);
        }
        case "screenshot":
          act("screenshot", "screenshot");
          return image("The screen now:", await this.driver.screenshot());
        case "contact_sheet": {
          const at = Number(input["turn"]);
          const before = Number(input["before"]);
          const after = Number(input["after"]);
          const fps = Number(input["fps"]);
          act("contact_sheet", `contact sheet turn ${at} −${before}s…+${after}s`);
          return image(`Frames around turn ${at}, ${fps} per second:`, await this.driver.contactSheet(at, before, after, fps));
        }
        case "notebook":
          return text(this.#notebook(input, act));
        case "report_bug":
          return text(await this.#reportBug(input, turn));
        case "message_developer":
          return text(await this.#message(input));
        case "restart_game": {
          const from = input["from"] === "save" ? "save" : "now";
          act("tap", from === "save" ? "restart from last save" : "restart game");
          return text((await this.driver.restart({ from })).text);
        }
        case "set_goal": {
          const goal = String(input["goal"] ?? "").trim();
          this.bus.setStatus({ goal });
          return text(`Goal set: ${goal}`);
        }
        default:
          return text(`There's no tool called ${name}.`, true);
      }
    } catch (error) {
      return text(`That didn't work: ${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      await this.#refreshStatus(turn);
    }
  }

  /** Developer messages that arrived while the player was busy. */
  mail(): string | null {
    const mail = this.#inbox.splice(0);
    return mail.length ? `Message from the developer:\n${mail.map(describeChat).join("\n")}` : null;
  }

  /** What the glitch detectors noticed since last time, as a note for the player (and events for the stream). */
  glitchNote(): string | null {
    const glitches = this.driver.takeGlitches();
    if (!glitches.length) return null;
    for (const g of glitches) this.bus.emit({ t: "glitch", turn: this.turn, kind: g.kind, text: g.text });
    return `Harness glitch detector, during turn ${this.turn}:\n${glitches.map((g) => `- ${g.text}`).join("\n")}\nLook into it (contact_sheet helps) and report it if it's a real bug.`;
  }

  /** The opening of a conversation: notebook, bugs so far, goal, then `now`. */
  opening(now: string): string {
    const path = this.bus.notebookPath;
    const notebook = existsSync(path) ? readFileSync(path, "utf8").trim() : "";
    const bugs = this.bus.bugs.slice(-30).map((b) => `#${b.id} [${b.status}] ${b.title}`).join("\n");
    const goal = this.bus.status?.goal;
    return [
      notebook ? `Your notebook:\n${notebook}` : "Your notebook is empty.",
      bugs ? `Bugs reported so far:\n${bugs}` : "No bugs reported yet.",
      goal ? `Your goal shown to viewers: ${goal}` : "Set a goal for viewers with set_goal.",
      now,
    ].join("\n\n");
  }

  #notebook(input: Record<string, unknown>, act: (kind: ActionKind, label: string) => void): string {
    const path = this.bus.notebookPath;
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
    const bug = this.bus.addBug({
      turn,
      title: String(input["title"] ?? "Untitled"),
      severity,
      steps: String(input["steps"] ?? ""),
      expected: String(input["expected"] ?? ""),
      actual: String(input["actual"] ?? ""),
    });
    this.bus.emit<ActionEvent>({ t: "action", turn, kind: "report_bug", label: `report bug #${bug.id}` });
    let attachments: string[] = [];
    try {
      attachments = await this.driver.collectEvidence(this.bus.bugDir(bug.id), turn);
      this.bus.updateBug(bug.id, { attachments });
    } catch (error) {
      attachments = [`(evidence failed: ${String(error)})`];
    }
    this.bus.emit<ChatEvent>({ t: "chat", from: "player", tag: "bug", bug: bug.id, text: `${bug.title}. ${bug.actual}` });
    return `Filed as bug #${bug.id} (${severity}), with ${attachments.length} attachments. The developer has been told.`;
  }

  async #message(input: Record<string, unknown>): Promise<string> {
    const tags: ChatTag[] = ["bug", "harness", "question", "note"];
    const tag = tags.includes(input["tag"] as ChatTag) ? (input["tag"] as ChatTag) : "note";
    const bug = typeof input["bug"] === "number" ? input["bug"] : undefined;
    this.bus.emit<ActionEvent>({ t: "action", turn: this.turn, kind: "message", label: "message the developer" });
    this.bus.emit<ChatEvent>({ t: "chat", from: "player", tag, text: String(input["text"] ?? ""), ...(bug !== undefined && { bug }) });
    if (!input["wait_for_reply"]) return "Sent.";
    if (!this.#inbox.length) {
      this.bus.setStatus({ mode: "talk" });
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
      this.bus.setStatus({ mode: "play" });
    }
    const replies = this.#inbox.splice(0);
    return replies.length ? `Sent. The developer replied:\n${replies.map(describeChat).join("\n")}` : "Sent. No reply after 30 minutes; carry on and check back later.";
  }

  async #refreshStatus(turn: number): Promise<void> {
    try {
      const s = await this.driver.status();
      this.bus.setStatus({ turn, map: s.map, playTime: s.playTime, fps: s.fps });
    } catch {
      this.bus.setStatus({ turn });
    }
  }
}

function describeChat(c: ChatEvent): string {
  return `${c.tag ? `[${c.tag}${c.bug !== undefined ? ` #${c.bug}` : ""}] ` : ""}${c.text}`;
}
