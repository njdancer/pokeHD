// When the game will take the player's next input, so every action waits for it (before and after)
// and the player never has to: the page's own word (window.__pokehd.input: who has the next tap,
// from its message box's ▼, its battle menu's and sheets' questions, and where the game's CPU is
// waiting for buttons, see apps/web qa-signals.ts and @pokehd/emu input-wait.ts), plus what the
// harness sees itself (loading, a fade, a step under way). And the lines the game showed between
// two actions, which it may have moved past by itself (QA bug 65).
import { startingUp } from "./outcome.ts";
import type { ScreenRead } from "./screen-read.ts";

export type Readiness = { ready: true; on: string } | { ready: false; why: string };

/** What the page says keeps it from taking a tap, for the player. */
const BUSY: Record<string, string> = {
  printing: "a message still printing",
  "message-held": "a message the game is holding up (an animation, a jingle)",
  battle: "the battle's animations",
  busy: "the game moving you or running a scene",
  acting: "a menu action running in the game",
};

/** Page screens that take taps whatever the game is doing (they hold it): its start screen, the name prompt, its dialogs. */
const PAGE_SCREENS = new Set(["start", "name", "dialog"]);

export function readiness(r: ScreenRead): Readiness {
  if (!r.hooked || r.loading || startingUp(r)) return { ready: false, why: "the game loading" };
  if (r.panels.some((p) => PAGE_SCREENS.has(p.kind))) return { ready: true, on: "page" };
  const input = r.input;
  // A fade under way runs outside the overworld loop and its waits, so the page's word covers it.
  // Without that word, any fade counts. A dark cave (Rock Tunnel without Flash) keeps its palette
  // two shades down the whole time: that's the map's light, not a fade, and every action there
  // used to wait out the full READY_MAX_MS for it.
  if (r.state?.fade && !input?.ready) return { ready: false, why: "a screen fade" };
  if (r.state?.player.step) return { ready: false, why: "a step under way" };
  // A page without the signal (an older build): a message box without its ▼ is all there is to go on.
  if (!input) return r.printing ? { ready: false, why: BUSY["printing"]! } : { ready: true, on: "screen" };
  if (!input.ready) return { ready: false, why: BUSY[input.why] ?? input.why };
  // The battle menu is the page's to draw: it takes taps once it's on screen.
  if (input.on === "battle-menu" && !r.panels.some((p) => p.kind === "battle-menu")) return { ready: false, why: "the battle menu coming up" };
  return { ready: true, on: input.on };
}

/** A line of the page's message log (apps/web qa-signals.ts). */
export interface LoggedLine {
  seq: number;
  group: number;
  text: string;
}

const norm = (s: string) => s.replace(/▼/g, "").replace(/\s+/g, " ").trim();

/**
 * The messages the game showed since the last action, a box to a quoted line, oldest first, less
 * what the screen still shows (the result says that anyway). Empty when there's nothing more.
 */
export function describeMessages(lines: readonly LoggedLine[], onScreen: readonly string[]): string {
  const boxes: string[] = [];
  lines.forEach((l, i) => (i && lines[i - 1]!.group === l.group ? (boxes[boxes.length - 1] += ` ${l.text}`) : boxes.push(l.text)));
  const shown = onScreen.map(norm).join(" ");
  while (boxes.length && shown.includes(norm(boxes.at(-1)!))) boxes.pop();
  if (!boxes.length) return "";
  return `Since your last action the game showed, in order: ${boxes.map((b) => `"${norm(b)}"`).join(" → ")}`;
}
