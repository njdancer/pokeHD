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

/**
 * What the player has seen of the map it's on, kept from each turn's text map, measured from where
 * it came in (a fixed origin, which the live player asked for: "the text map recentres after every
 * move, so I can't keep absolute coordinates"). Starts again on a new map.
 */
class Explored {
  map = -1;
  entry = { x: 0, y: 0 };
  cells = new Map<string, string>();

  see(sim: Sim): void {
    const s = sim.state();
    if (s.mapId !== this.map) {
      this.map = s.mapId;
      this.entry = { x: s.player.x, y: s.player.y };
      this.cells.clear();
    }
    const rows = sim.textMap(s).split("\n").slice(1, 10).map((l) => l.slice(2));
    rows.forEach((row, dy) =>
      [...row].forEach((c, dx) => {
        // People move: remember the floor under them as floor.
        this.cells.set(`${s.player.x + dx - 4},${s.player.y + dy - 4}`, c === "@" || c === "N" ? "." : c);
      }),
    );
  }

  where(sim: Sim): string {
    const s = sim.state();
    const dx = s.player.x - this.entry.x;
    const dy = s.player.y - this.entry.y;
    const parts = [dy ? `${Math.abs(dy)} ${dy < 0 ? "north" : "south"}` : "", dx ? `${Math.abs(dx)} ${dx < 0 ? "west" : "east"}` : ""].filter(Boolean);
    return parts.length ? `You're ${parts.join(" and ")} of where you came into this map (or started).` : "You're where you came into this map (or started).";
  }

  draw(sim: Sim): string {
    const s = sim.state();
    const keys = [...this.cells.keys()].map((k) => k.split(",").map(Number) as [number, number]);
    const xs = keys.map((k) => k[0]);
    const ys = keys.map((k) => k[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const lines: string[] = [];
    for (let y = y0; y <= y1; y++) {
      let line = "";
      for (let x = x0; x <= x1; x++) {
        line += x === s.player.x && y === s.player.y ? "@" : x === this.entry.x && y === this.entry.y ? "E" : (this.cells.get(`${x},${y}`) ?? " ");
      }
      lines.push(line.trimEnd());
    }
    return `Everything you've seen of this map so far (fixed: north up, E where you came in or started, @ you, blank not seen yet):\n${lines.join("\n")}`;
  }
}

/** The pieces a variant can switch on; each variant is its parent plus one more. */
export interface Features {
  exitNote?: boolean;
  netMove?: boolean;
  description?: string;
  /** A line saying where you are from where you came into the map. */
  fromEntry?: boolean;
  /** A fixed map of everything seen on this map so far. */
  exploredMap?: boolean;
}

function build(id: string, note: string, parent: string | null, f: Features): Variant {
  // One memory per game, started again with each episode's opening.
  const memory = new WeakMap<Sim, Explored>();
  const explored = (sim: Sim) => memory.get(sim) ?? memory.set(sim, new Explored()).get(sim)!;
  const tracking = (sim: Sim): string | null => {
    if (!f.fromEntry && !f.exploredMap) return null;
    const e = explored(sim);
    e.see(sim);
    return [f.exploredMap ? e.draw(sim) : null, e.where(sim)].filter(Boolean).join("\n");
  };
  const extra = (sim: Sim, walk: WalkResult, before: { x: number; y: number; map: number }) =>
    // The exit note is in the text map itself now (textmap.ts underfoot), so only the rest is added.
    [f.netMove ? netMove(walk, before, sim) : null, tracking(sim)].filter(Boolean).join("\n") || null;
  const tool = joystick({ ...(f.description && { description: f.description }), extra });
  return {
    id,
    note,
    parent,
    features: f,
    tools: { joystick: tool },
    opening: (sim) => {
      memory.set(sim, new Explored());
      return withExtra(sim.opening(), tracking(sim));
    },
  };
}

const RECENTRE =
  'Walk with the on-screen joystick: one arrow per step, in order, e.g. "↑↑↑→→" walks 3 up then 2 right in one go, keeping your finger on the stick. U/D/L/R work too. Stops early if something interrupts you (a wall, a door, someone talking, a battle). The text map is always centred on you (you\'re the @ at column 4, row 4), so it shifts with every step: to reach column c, row r of the map you\'re looking at, walk c−4 steps right (left if negative) and r−4 down (up if negative), around anything in the way, and after a walk work out where your target is on the new map. Usually stay within about one screen\'s worth of steps so you can see where you\'re going; longer routes are allowed when you\'re sure. Returns what\'s on screen afterwards.';

export const VARIANTS: Record<string, Variant> = {
  // Since the exit note moved into the text map (kept), "baseline" and "exit-note" are the same tool.
  baseline: build("baseline", "The live joystick: arrows string, step note, 10×9 text map, buttons.", null, {}),
  "exit-note": build("exit-note", "When you stop on an exit mat (D under the @), the result says so and which way walks out.", "baseline", { exitNote: true }),
  "exit-net": build("exit-net", "Adds a line saying how far the turn took you (e.g. 3 north and 2 east).", "exit-note", { exitNote: true, netMove: true }),
  "exit-recentre": build("exit-recentre", "Description explains the map recentres on you each step, and how to turn a column and row into arrows.", "exit-note", { exitNote: true, description: RECENTRE }),
  "from-entry": build("from-entry", "Adds a line saying where you are from where you came into the map (a fixed origin).", "exit-note", { exitNote: true, fromEntry: true }),
  "explored-map": build("explored-map", "Adds a fixed map of everything seen on this map so far (E where you came in), with the from-entry line.", "from-entry", { exitNote: true, fromEntry: true, exploredMap: true }),
};
