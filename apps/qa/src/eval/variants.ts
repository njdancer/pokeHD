// The movement tool under test, as variants: what the player is told about it (description and
// input shape) and what it gets back. "baseline" is the live joystick exactly (toolbox.ts and the
// driver's result text). Each other variant changes one thing; the eval keeps a change only when
// it beats the variant it was built on by more than the noise.
import { z } from "zod";
import { parseMoves, TOOLS } from "../toolbox.ts";
import { DIRS } from "../game/walk.ts";
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
  /** The screen description that opens an episode. */
  opening(sim: Sim): string;
}

/** The live joystick, with an optional extra line put in before the buttons. */
function joystick(opts: { description?: string; extra?: (sim: Sim, walk: WalkResult) => string | null } = {}): VariantTool {
  return {
    description: opts.description ?? TOOLS.joystick.description,
    shape: TOOLS.joystick.shape,
    run(sim, input, turn) {
      const moves = parseMoves(String(input["moves"] ?? ""));
      if (typeof moves === "string") return { text: `Turn ${turn}. ${moves}`, isError: true };
      const walk = sim.joystick(moves);
      return { text: `Turn ${turn}. ${withExtra(walk.text, opts.extra?.(sim, walk) ?? null)}`, walk };
    },
  };
}

function withExtra(text: string, extra: string | null): string {
  if (!extra) return text;
  const at = text.indexOf("\nButtons:");
  return at < 0 ? `${text}\n${extra}` : `${text.slice(0, at)}\n${extra}${text.slice(at)}`;
}

/**
 * Standing on an exit mat (a warp that isn't a door you walk into) the text map shows only "@",
 * so the D under you disappears and nothing says the exit still needs a push off the map's edge.
 * A person sees the mat under their feet. This says so, and which way leads out.
 */
function exitUnderfoot(sim: Sim): string | null {
  const s = sim.state();
  const map = sim.rom.world.maps[s.mapId];
  if (!map || !map.warps.some((w) => w.x === s.player.x && w.y === s.player.y)) return null;
  const w = map.widthBlocks * 2;
  const h = map.heightBlocks * 2;
  const out = (["down", "up", "left", "right"] as const).filter((d) => {
    const { dx, dy } = DIRS[d];
    const x = s.player.x + dx;
    const y = s.player.y + dy;
    return x < 0 || y < 0 || x >= w || y >= h;
  });
  return `You're standing on an exit (D) under the @. To go through it, walk ${out.length ? out.join(" or ") : "off it toward the wall it's set in"} once more.`;
}

export const VARIANTS: Record<string, Variant> = {
  baseline: {
    id: "baseline",
    note: "The live joystick: arrows string, step note, 10×9 text map, buttons.",
    parent: null,
    tools: { joystick: joystick() },
    opening: (sim) => sim.opening(),
  },
  "exit-note": {
    id: "exit-note",
    note: "When you stop on an exit mat (D under the @), the result says so and which way walks out.",
    parent: "baseline",
    tools: { joystick: joystick({ extra: (sim) => exitUnderfoot(sim) }) },
    opening: (sim) => withExtra(sim.opening(), exitUnderfoot(sim)),
  },
};
