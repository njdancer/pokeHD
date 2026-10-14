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

/**
 * The text map clipped to what the walk revealed (Nick's idea, as a tokens test): after a walk on
 * the same map, instead of the full 10×9 view, only the strips of cells that came into view (every
 * window along the way, less the view before the walk), labelled in steps from the player, who is
 * 0,0. A walk longer than a screen shows every row it passed. `ground` adds the row or column
 * just inside the old view's edge, already seen, to line the strips up against.
 */
function clippedMap(sim: Sim, walk: WalkResult, ground: boolean): string | null {
  const s = sim.state();
  const cells = walk.cells;
  if (s.mapId !== walk.startMap || cells.length < 2 || s.mode !== "overworld") return null;
  const from = cells[0]!;
  const view = (c: { x: number; y: number }) => ({ x0: c.x - 4, x1: c.x + 5, y0: c.y - 4, y1: c.y + 4 });
  const old = view(from);
  const inOld = (x: number, y: number) => x >= old.x0 && x <= old.x1 && y >= old.y0 && y <= old.y1;
  const fresh = new Set<string>();
  for (const c of cells) {
    const v = view(c);
    for (let y = v.y0; y <= v.y1; y++) for (let x = v.x0; x <= v.x1; x++) if (!inOld(x, y)) fresh.add(`${x},${y}`);
  }
  if (!fresh.size) return "Nothing new came into view.";
  const pts = [...fresh].map((k) => k.split(",").map(Number) as [number, number]);
  // A big text map around the player, to read any cell from.
  const reach = 4 + Math.max(...pts.map(([x, y]) => Math.max(Math.abs(x - s.player.x), Math.abs(y - s.player.y))));
  const big = sim.textMap(s, { left: reach, right: reach, up: reach, down: reach }).split("\n").slice(1, 2 * reach + 2).map((l) => l.slice(l.indexOf(" ") + 1));
  const cell = (x: number, y: number) => big[y - s.player.y + reach]?.[x - s.player.x + reach] ?? "#";
  const strips: string[] = [];
  const rel = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  const strip = (name: string, xs: [number, number], ys: [number, number], seen: Set<string>) => {
    const lines = [`New ${name} (columns ${rel(xs[0] - s.player.x)} to ${rel(xs[1] - s.player.x)}, rows ${rel(ys[0] - s.player.y)} to ${rel(ys[1] - s.player.y)}):`];
    for (let y = ys[0]; y <= ys[1]; y++) {
      let row = "";
      for (let x = xs[0]; x <= xs[1]; x++) row += cell(x, y);
      lines.push(`${rel(y - s.player.y).padStart(3)} ${row}${seen.has(String(y)) ? "   (seen before)" : ""}`);
    }
    strips.push(lines.join("\n"));
  };
  const xsAll = pts.map((p) => p[0]);
  const north = pts.filter(([, y]) => y < old.y0);
  const south = pts.filter(([, y]) => y > old.y1);
  if (north.length) {
    const ys: [number, number] = [Math.min(...north.map((p) => p[1])), old.y0 - 1 + (ground ? 1 : 0)];
    strip("to the north", [Math.min(...xsAll), Math.max(...xsAll)], ys, new Set(ground ? [String(old.y0)] : []));
  }
  if (south.length) {
    const ys: [number, number] = [old.y1 + 1 - (ground ? 1 : 0), Math.max(...south.map((p) => p[1]))];
    strip("to the south", [Math.min(...xsAll), Math.max(...xsAll)], ys, new Set(ground ? [String(old.y1)] : []));
  }
  const side = pts.filter(([, y]) => y >= old.y0 && y <= old.y1);
  const east = side.filter(([x]) => x > old.x1);
  const west = side.filter(([x]) => x < old.x0);
  const cols = (name: string, xs: [number, number]) => strip(name, xs, [old.y0, old.y1], new Set());
  if (east.length) cols("to the east", [old.x1 + 1 - (ground ? 1 : 0), Math.max(...east.map((p) => p[0]))]);
  if (west.length) cols("to the west", [Math.min(...west.map((p) => p[0])), old.x0 - 1 + (ground ? 1 : 0)]);
  return `${strips.join("\n")}\nYou're the @ at 0,0 (columns count east, rows count south${ground ? "; the row or column marked seen before, or the first column of a side strip, was already in your last view" : ""}).`;
}

/**
 * The text map with a space between cells. Run together, a row like "##########" is about three
 * tokens to the model (90 cells cost ~43 tokens), so it can't see columns one by one; spaced,
 * each cell is its own token (~100 tokens for the 90).
 */
function spaceCells(text: string): string {
  const lines = text.split("\n");
  const head = lines.findIndex((l) => /^(Turn \d+\. .*\n?)?\s*0123456789$/.test(l) || /0123456789$/.test(l));
  if (head < 0) return text;
  const legend = lines.findIndex((l, i) => i > head && l.startsWith("Legend:"));
  for (let i = head; i < legend; i++) {
    const l = lines[i]!;
    if (i === head) lines[i] = l.replace(/0123456789$/, "0 1 2 3 4 5 6 7 8 9");
    else lines[i] = `${l.slice(0, 2)}${[...l.slice(2)].join(" ")}`;
  }
  return lines.join("\n");
}

/**
 * The text map in symbols that are one token each to Haiku, alone and beside each other (checked
 * with tok.ts: ASCII runs like "##########" merge to ~3 tokens; these stay at one a cell), so the
 * model sees every cell without the extra tokens spacing costs.
 */
const GLYPHS: Record<string, string> = {
  "@": "★", ".": "□", "#": "■", N: "人", D: "門", '"': "草", "~": "水", S: "木", o: "●", O: "石", "/": "△", "^": "山", _: "田", v: "v", "<": "←", ">": "→",
};
function glyphCells(text: string): string {
  const lines = text.split("\n");
  const head = lines.findIndex((l) => /0123456789$/.test(l));
  if (head < 0) return text;
  const legend = lines.findIndex((l, i) => i > head && l.startsWith("Legend:"));
  if (legend < 0) return text;
  for (let i = head + 1; i < legend; i++) {
    const l = lines[i]!;
    lines[i] = `${l.slice(0, 2)}${[...l.slice(2)].map((c) => GLYPHS[c] ?? c).join("")}`;
  }
  const [intro, rest] = [lines[legend]!.slice(0, "Legend: ".length), lines[legend]!.slice("Legend: ".length)];
  const end = rest.indexOf(". You're");
  const entries = rest.slice(0, end).split(", ").map((e) => `${GLYPHS[e[0]!] ?? e[0]}${e.slice(1)}`);
  const swap = (t: string) => t.replace(/between \^ and/g, `between ${GLYPHS["^"]} and`).replace(/between _ and/g, `between ${GLYPHS["_"]} and`).replace(/stairs \/\)/g, `stairs ${GLYPHS["/"]})`);
  lines[legend] = `${intro}${swap(entries.join(", "))}${rest.slice(end)}`;
  for (let i = legend + 1; i < lines.length; i++) lines[i] = lines[i]!.replace("(D, under the @)", `(${GLYPHS["D"]}, under the ${GLYPHS["@"]})`);
  return lines.join("\n");
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
  /** Only the strips a walk revealed, in place of the full text map; "ground" adds one seen row/column. */
  clip?: "plain" | "ground";
  /** A space between the text map's cells, one token each. */
  spaced?: boolean;
  /** One-token symbols for the text map's cells. */
  glyphs?: boolean;
  /** The live player's notebook tool alongside the joystick (kept for the episode only). */
  notebook?: boolean;
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
  const base = joystick({ ...(f.description && { description: f.description }), extra });
  const spaced: VariantTool = { ...base, run: (sim, input, turn) => {
    const out = base.run(sim, input, turn);
    return { ...out, text: spaceCells(out.text) };
  } };
  const glyphs: VariantTool = { ...base, run: (sim, input, turn) => {
    const out = base.run(sim, input, turn);
    return { ...out, text: glyphCells(out.text) };
  } };
  const tool: VariantTool = f.glyphs
    ? glyphs
    : f.spaced
    ? spaced
    : !f.clip
    ? base
    : {
        ...base,
        run(sim, input, turn) {
          const out = base.run(sim, input, turn);
          const clipped = out.walk ? clippedMap(sim, out.walk, f.clip === "ground") : null;
          if (!clipped) return out;
          // Swap the full map (header, nine rows, legend) for the strips; keep everything else.
          const lines = out.text.replace(/^Turn \d+\. /, "").split("\n");
          const head = lines.findIndex((l) => /^\s*0123456789$/.test(l));
          const legend = lines.findIndex((l) => l.startsWith("Legend:"));
          if (head < 0 || legend < 0) return out;
          const prefix = lines.slice(0, head).join("\n");
          const legendLine = lines[legend]!.replace(/You're at column \d+, row \d+, facing (\w+)/, "You're facing $1");
          const text = [prefix, clipped, legendLine, ...lines.slice(legend + 1)].filter(Boolean).join("\n");
          return { ...out, text: `Turn ${turn}. ${text}` };
        },
      };
  const notes = new WeakMap<Sim, string[]>();
  const notebook: VariantTool = {
    description: TOOLS.notebook.description,
    shape: TOOLS.notebook.shape,
    run(sim, input, turn) {
      const book = notes.get(sim) ?? [];
      notes.set(sim, book);
      const value = String(input["text"] ?? "").trim();
      if (input["action"] === "append" && value) {
        book.push(value);
        return { text: `Turn ${turn}. Noted.` };
      }
      if (input["action"] === "replace") {
        book.splice(0, book.length, value);
        return { text: `Turn ${turn}. Notebook rewritten.` };
      }
      return { text: `Turn ${turn}. ${book.length ? `Your notebook:\n${book.join("\n")}` : "Your notebook is empty."}` };
    },
  };
  return {
    id,
    note,
    parent,
    features: f,
    tools: f.notebook ? { joystick: tool, notebook } : { joystick: tool },
    opening: (sim) => {
      notes.set(sim, []);
      memory.set(sim, new Explored());
      const opening = withExtra(sim.opening(), tracking(sim));
      return f.spaced ? spaceCells(opening) : f.glyphs ? glyphCells(opening) : opening;
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
  clipped: build("clipped", "Text map clipped to the strips a walk revealed (no repeats of tiles in the last view).", "from-entry", { exitNote: true, fromEntry: true, clip: "plain" }),
  "clipped-ground": build("clipped-ground", "Clipped text map plus one already-seen row or column to line the new strips up against.", "from-entry", { exitNote: true, fromEntry: true, clip: "ground" }),
  spaced: build("spaced", "A space between the text map's cells, so each cell is one token (run together, 10 cells are ~3 tokens).", "from-entry", { exitNote: true, fromEntry: true, spaced: true }),
  glyphs: build("glyphs", "Text map cells in one-token symbols (□ floor, ■ wall, ★ you…), one token a cell without spaces.", "from-entry", { exitNote: true, fromEntry: true, glyphs: true }),
  "from-entry-notebook": build("from-entry-notebook", "The position line plus the live notebook tool (for the Mt Moon experiments).", "from-entry", { exitNote: true, fromEntry: true, notebook: true }),
  // Sonnet got through Viridian Forest 2 of 2 by asking for more steps than it could see and
  // letting walls stop it (54% of its walks ended blocked, Haiku's 17%); Haiku took short, careful
  // walks. This tells Haiku the technique.
  "overshoot": build("overshoot", "Description suggests running a corridor to its end: ask for more steps than you need and let the wall stop you.", "from-entry", {
    exitNote: true,
    fromEntry: true,
    description:
      'Walk with the on-screen joystick: one arrow per step, in order, e.g. "↑↑↑→→" walks 3 up then 2 right in one go, keeping your finger on the stick. U/D/L/R work too. Stops early if something interrupts you (a wall, a door, someone talking, a battle), and says what stopped you. To explore, run a corridor to its end: ask for more steps than you can see (say 12 ↑) and the wall stops you there, then look at the new map and turn. Returns what\'s on screen afterwards.',
  }),
};
