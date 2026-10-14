// The movement tool under test, as variants: what the player is told about it (description and
// input shape) and what it gets back. "baseline" is the live joystick exactly (toolbox.ts and the
// driver's result text). Each other variant changes one thing; the eval keeps a change only when
// it beats the variant it was built on by more than the noise.
import { z } from "zod";
import { parseMoves, TOOLS } from "../toolbox.ts";
import type { WalkResult } from "./sim.ts";
import type { Sim } from "./sim.ts";

export interface ToolCall {
  text: string;
  isError?: boolean;
  /** The walk, when the tool walked. */
  walk?: WalkResult;
}

export interface VariantTool {
  description: string;
  shape: z.ZodRawShape;
  run(sim: Sim, input: Record<string, unknown>, turn: number): ToolCall;
}

export interface Variant {
  id: string;
  /** What changed, from which variant. */
  note: string;
  parent: string | null;
  tools: Record<string, VariantTool>;
  features: Features;
  /** The screen description that opens an episode. */
  opening(sim: Sim): string;
}

/** The live joystick, with an optional extra line put in before the buttons. */
function joystick(opts: { description?: string; extra?: (sim: Sim, walk: WalkResult, before: { x: number; y: number; map: number }) => string | null } = {}): VariantTool {
  return {
    description: opts.description ?? TOOLS.joystick.description,
    shape: TOOLS.joystick.shape,
    run(sim, input, turn) {
      const moves = parseMoves(String(input["moves"] ?? ""));
      if (typeof moves === "string") return { text: `Turn ${turn}. ${moves}`, isError: true };
      const s0 = sim.state();
      const walk = sim.joystick(moves);
      return { text: `Turn ${turn}. ${withExtra(walk.text, opts.extra?.(sim, walk, { x: s0.player.x, y: s0.player.y, map: s0.mapId }) ?? null)}`, walk };
    },
  };
}

function withExtra(text: string, extra: string | null): string {
  if (!extra) return text;
  const at = text.indexOf("\nButtons:");
  return at < 0 ? `${text}\n${extra}` : `${text.slice(0, at)}\n${extra}${text.slice(at)}`;
}

/** What each turn's walk came to, from the steps the player took (they could count them). */
function netMove(walk: WalkResult, before: { x: number; y: number; map: number }, sim: Sim): string | null {
  const s = sim.state();
  if (s.mapId !== before.map || walk.walked === 0) return null;
  const dx = s.player.x - before.x;
  const dy = s.player.y - before.y;
  const parts = [dy ? `${Math.abs(dy)} ${dy < 0 ? "north" : "south"}` : "", dx ? `${Math.abs(dx)} ${dx < 0 ? "west" : "east"}` : ""].filter(Boolean);
  return `This turn took you ${parts.length ? parts.join(" and ") : "back where you started"}.`;
}

/** The pieces a variant can switch on; each variant is its parent plus one more. */
export interface Features {
  exitNote?: boolean;
  netMove?: boolean;
  description?: string;
}

function build(id: string, note: string, parent: string | null, f: Features): Variant {
  const extra = (sim: Sim, walk: WalkResult, before: { x: number; y: number; map: number }) =>
    // The exit note is in the text map itself now (textmap.ts underfoot), so only the rest is added.
    [f.netMove ? netMove(walk, before, sim) : null].filter(Boolean).join("\n") || null;
  const tool = joystick({ ...(f.description && { description: f.description }), extra });
  return { id, note, parent, features: f, tools: { joystick: tool }, opening: (sim) => sim.opening() };
}

const RECENTRE =
  'Walk with the on-screen joystick: one arrow per step, in order, e.g. "↑↑↑→→" walks 3 up then 2 right in one go, keeping your finger on the stick. U/D/L/R work too. Stops early if something interrupts you (a wall, a door, someone talking, a battle). The text map is always centred on you (you\'re the @ at column 4, row 4), so it shifts with every step: to reach column c, row r of the map you\'re looking at, walk c−4 steps right (left if negative) and r−4 down (up if negative), around anything in the way, and after a walk work out where your target is on the new map. Usually stay within about one screen\'s worth of steps so you can see where you\'re going; longer routes are allowed when you\'re sure. Returns what\'s on screen afterwards.';

export const VARIANTS: Record<string, Variant> = {
  // Since the exit note moved into the text map (kept), "baseline" and "exit-note" are the same tool.
  baseline: build("baseline", "The live joystick: arrows string, step note, 10×9 text map, buttons.", null, {}),
  "exit-note": build("exit-note", "When you stop on an exit mat (D under the @), the result says so and which way walks out.", "baseline", { exitNote: true }),
  "exit-net": build("exit-net", "Adds a line saying how far the turn took you (e.g. 3 north and 2 east).", "exit-note", { exitNote: true, netMove: true }),
  "exit-recentre": build("exit-recentre", "Description explains the map recentres on you each step, and how to turn a column and row into arrows.", "exit-note", { exitNote: true, description: RECENTRE }),
};
