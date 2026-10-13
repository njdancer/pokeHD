import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseWorld, SPRITE_NAMES, type MapData, type Tileset, type WorldData } from "@pokehd/rom";
import { GlitchWatcher, type GlitchSample } from "./glitches.ts";
import { describeLayouts } from "./layout-log.ts";
import { continueButton, describeButtons, describeGameBoyText, mapName, startingUp } from "./outcome.ts";
import { pickFrames } from "./recorder.ts";
import type { Panel, ScreenButton, StateLite } from "./screen-read.ts";
import { buildTextMap } from "./textmap.ts";

// A tiny world: blocks are one tile throughout (0 floor, 1 wall, 2 grass, 3 water).
const FLOOR = 0x01;
const WALL = 0x02;
const GRASS = 0x03;
const WATER = 0x14;
const blockTiles = [FLOOR, WALL, GRASS, WATER];
const tileset = {
  id: 0,
  name: "TEST",
  blocks: new Uint8Array(blockTiles.flatMap((t) => Array<number>(16).fill(t))),
  blockCount: 4,
  tiles: new Uint8Array(0),
  animation: "none",
  semantics: {
    walkable: [FLOOR, GRASS],
    grass: GRASS,
    counters: [],
    doors: [],
    warps: [],
    warpCarpets: [],
    bookshelves: [],
    pairCollisions: [],
    ledges: [],
    warpPads: [],
    holes: [],
    spinners: [],
    cutTrees: [],
    hasWater: true,
  },
} as Tileset;
// 3×3 blocks = 6×6 steps: walls round the top row, grass bottom-left, water bottom-right.
const map = {
  id: 0,
  name: "TEST_MAP",
  tileset: 0,
  widthBlocks: 3,
  heightBlocks: 3,
  blocks: new Uint8Array([1, 1, 1, 0, 0, 0, 2, 0, 3]),
  borderBlock: 0,
  connections: [],
  warps: [{ x: 2, y: 1, to: 1, toWarp: 0 }],
  signs: [{ x: 5, y: 2, textId: 1 }],
  npcs: [],
} as MapData;
const world = { maps: [map], tilesets: [tileset], sprites: [], bikeSprite: null, sgbPalettes: [] } as unknown as WorldData;

const state = (x: number, y: number, npcs: StateLite["npcs"] = []): StateLite => ({
  mode: "overworld",
  mapId: 0,
  fade: 0,
  player: { x, y, facing: "down", step: null },
  npcs,
});

describe("buildTextMap", () => {
  it("draws the steps around the player, the edge of the map as blocked", () => {
    const text = buildTextMap(world, null, state(2, 3, [{ x: 3, y: 3, facing: "up", step: null, visible: true, pictureId: 1 }]), { left: 3, right: 4, up: 3, down: 3 });
    const [rows, legend] = [text.split("\n").slice(0, 7), text.split("\n")[7]];
    expect(rows).toEqual([
      "########",
      "###D####",
      "#.....S#",
      "#..@N..#",
      '#""..~~#',
      '#""..~~#',
      "########",
    ]);
    expect(legend).toBe('Legend: @ you, . walkable, # blocked, " tall grass, ~ water, D door/stairs/exit, N person, S sign. You face down; north is up.');
  });

  it("leaves out people who aren't there and marks balls", () => {
    const ball = SPRITE_NAMES.indexOf("POKE_BALL");
    const text = buildTextMap(
      world,
      null,
      state(1, 2, [
        { x: 2, y: 2, facing: "down", step: null, visible: false, pictureId: 1 },
        { x: 0, y: 2, facing: "down", step: null, visible: true, pictureId: ball },
      ]),
      { left: 1, right: 1, up: 0, down: 0 },
    );
    expect(text.split("\n")[0]).toBe("o@.");
    expect(text).toContain("o ball on the ground");
  });
});

const ROM_PATH = new URL("../../../../rom/pokeblue.gb", import.meta.url);

describe.skipIf(!existsSync(ROM_PATH))("buildTextMap on the ROM's caves", () => {
  const rom = existsSync(ROM_PATH) ? parseWorld(new Uint8Array(readFileSync(ROM_PATH))) : null;
  const at = (name: string, x: number, y: number): StateLite => ({ ...state(x, y), mapId: rom!.maps.findIndex((m) => m?.name === name) });

  it("marks raised floor the ROM's pair collisions keep apart from the low floor (Mt Moon 1F)", () => {
    // 1F's west strip is light floor (0x05) beside dark floor (0x20): CAVERN $20,$05 in
    // TilePairCollisionsLand, so stepping west from (2,3) doesn't move you.
    const text = buildTextMap(rom!, null, at("MT_MOON_1F", 2, 3), { left: 1, right: 1, up: 1, down: 1 });
    expect(text.split("\n").slice(0, 3)).toEqual(["^..", "^@.", "^.."]);
    expect(text).toContain("^ raised floor (no step straight between ^ and the lower floor");
  });

  it("marks the stone steps that join the two heights (Mt Moon B2F)", () => {
    const text = buildTextMap(rom!, null, at("MT_MOON_B2F", 28, 8), { left: 1, right: 1, up: 2, down: 0 });
    expect(text.split("\n").slice(0, 3)).toEqual(["^^^", "#//", ".@."]);
    expect(text).toContain("/ stairs between floor heights");
  });
});

describe("pickFrames", () => {
  const frames = [0, 100, 250, 400, 900, 1000].map((t) => ({ t }));

  it("takes the newest frame at or before each moment, never the same one twice", () => {
    const picked = pickFrames(frames, 0, 1000, 4); // moments 0, 250, 500, 750, 1000
    expect(picked.map((p) => [p.frame.t, p.at])).toEqual([
      [0, 0],
      [250, 250],
      [400, 500],
      [1000, 1000],
    ]);
  });

  it("skips moments before the first frame", () => {
    expect(pickFrames(frames, -500, 0, 4).map((p) => p.frame.t)).toEqual([0]);
  });

  it("spreads a long span over at most `cap` moments", () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ t: i * 10 }));
    const picked = pickFrames(many, 0, 9990, 30, 24);
    expect(picked).toHaveLength(24);
    expect(picked[0]!.frame.t).toBe(0);
    expect(picked.at(-1)!.frame.t).toBe(9990);
  });

  it("has nothing for an empty or backwards span", () => {
    expect(pickFrames([], 0, 1000, 4)).toEqual([]);
    expect(pickFrames(frames, 1000, 0, 4)).toEqual([]);
  });
});

describe("GlitchWatcher", () => {
  const base: GlitchSample = { at: 0, hooked: true, inWorld: true, mode: "overworld", layout: "hidden", loading: false, frames: 0, visible: true, held: false, busy: false, slow: [] };
  const run = (samples: Partial<GlitchSample>[]) => {
    const w = new GlitchWatcher();
    let frames = 0;
    samples.forEach((s, i) => w.sample({ ...base, at: i * 200, frames: (frames += 3), ...s }));
    return w.take();
  };

  it("notices a quick flip to the Game Boy screen and back, once", () => {
    const g = run([{}, { layout: "full" }, { layout: "full" }, {}, {}]);
    expect(g).toEqual([{ at: 600, kind: "screen-flip", text: "The screen flipped to the Game Boy view for 0.4 s and back." }]);
  });

  it("lets the Game Boy screen stay up in battles and for long screens", () => {
    expect(run([{}, { layout: "full", mode: "battle" }, { mode: "battle" }])).toEqual([]);
    expect(run([{}, ...Array<Partial<GlitchSample>>(20).fill({ layout: "full" }), {}])).toEqual([]);
  });

  it("notices the game freezing, but not while a menu holds it", () => {
    const frozen = (held: boolean) => {
      const w = new GlitchWatcher();
      for (let i = 0; i < 20; i++) w.sample({ ...base, at: i * 200, frames: i < 3 ? i : 3, held });
      return w.take();
    };
    expect(frozen(false).map((g) => g.kind)).toEqual(["freeze"]);
    expect(frozen(true)).toEqual([]);
  });

  it("notices the loading screen coming back and the world flickering", () => {
    expect(run([{}, { loading: true, inWorld: false }, { loading: true, inWorld: false }, {}]).map((g) => g.kind)).toEqual(["reload", "world-flicker"]);
  });

  it("reports long frames once, then counts them until it's been quiet a while", () => {
    const w = new GlitchWatcher();
    w.sample({ ...base, at: 0, frames: 1, slow: [{ ms: 300 }, { ms: 100 }] });
    w.sample({ ...base, at: 1000, frames: 2, slow: [{ ms: 400 }] });
    w.sample({ ...base, at: 40_000, frames: 3, slow: [{ ms: 500 }] });
    expect(w.take().map((g) => g.text)).toEqual([
      "The picture stuck for 300 ms.",
      "The picture stuck for 500 ms (1 more long frames since the last report).",
    ]);
  });

  it("ignores what the harness does on purpose", () => {
    expect(run([{}, { busy: true, loading: true, inWorld: false }, { busy: true }, {}])).toEqual([]);
  });
});

describe("outcome text", () => {
  it("names maps the way a sign would", () => {
    expect(mapName(0x00)).toBe("Pallet Town");
    expect(mapName(0x26)).toBe("Red's House 2F");
    expect(mapName(0x28)).toBe("Oak's Lab");
    expect(mapName(0x29)).toBe("Viridian Pokémon Center");
    expect(mapName(0x0b)).toBe("map 0xb");
  });

  it("lists buttons at their centres, the pad on its own line", () => {
    expect(
      describeButtons({
        buttons: [
          { label: "YES", x: 100, y: 600, w: 40, h: 20, pad: false },
          { label: "A", x: 450, y: 870, w: 54, h: 40, pad: true },
        ],
        joystick: { x: 0, y: 630, w: 264, h: 370 },
      }),
    ).toBe("Buttons: [YES] at (120,610)\nPad: joystick in the area (0,630)–(264,1000), [A] at (477,890)");
  });

  it("reads Game Boy text boxes without the ▼", () => {
    expect(describeGameBoyText([{ lines: [{ text: "Right! So your" }, { text: "name is RED! ▼" }] }, { lines: [] }])).toBe(
      'Game Boy screen text:\n"Right! So your / name is RED!"',
    );
  });
});

describe("describeLayouts", () => {
  const log = [
    { t: 0, layout: "hidden" },
    { t: 1000, layout: "full" },
    { t: 1040, layout: "hidden" },
    { t: 2000, layout: "dialog" },
  ];
  it("times each flash of the Game Boy screen and says what's in front now", () => {
    expect(describeLayouts(log, 500, 2500)).toBe("Screen: the original Game Boy screen showed once (0.04 s full screen) and is in front now (along the bottom).");
  });
  it("says nothing when the screen didn't change", () => {
    expect(describeLayouts(log, 1100, 1900)).toBeNull();
    expect(describeLayouts([{ t: 0, layout: "full" }], 10, 20)).toBeNull();
  });
  it("says nothing when the Game Boy screen only went away", () => {
    expect(describeLayouts([{ t: 0, layout: "full" }, { t: 50, layout: "hidden" }], 10, 100)).toBeNull();
  });
});

describe("start screen", () => {
  const button = (label: string, pad = false): ScreenButton => ({ label, pad, x: 10, y: 10, w: 100, h: 40 });
  const start: Panel = { kind: "start", text: "Welcome back, CLAUDE!\n0 badges\n1 caught\n1:16 played\nContinue\nNew game" };
  const welcome = { panels: [start], buttons: [button("Continue"), button("New game"), button("A", true)] };

  it("finds Continue beside New game only when asked to carry on regardless", () => {
    expect(continueButton(welcome, true)).toBeNull();
    expect(continueButton(welcome, false)?.label).toBe("Continue");
  });

  it("taps Continue when it's the only choice, and never anything else", () => {
    expect(continueButton({ panels: [start], buttons: [button("Continue")] }, true)?.label).toBe("Continue");
    expect(continueButton({ panels: [start], buttons: [button("New game")] }, false)).toBeNull();
    expect(continueButton({ panels: [], buttons: [button("Continue")] }, false)).toBeNull();
  });

  it("reads \"Off we go…\" as the game still starting, not a screen to report", () => {
    const going = { panels: [{ kind: "start", text: "Off we go…" }], buttons: [button("B", true), button("Menu")] };
    expect(startingUp(going)).toBe(true);
    expect(startingUp(welcome)).toBe(false);
    expect(startingUp({ panels: [], buttons: [] })).toBe(false);
  });
});
