// ROM test for QA bug 36: an Escape Rope used from the HD bag in Mt. Moon never brings the Game
// Boy screen up. ItemUseEscapeRope prints nothing: it sets the fly and escape warp bits, redraws the
// map (ItemUseReloadOverworldData) inside the text frame GameActions opens, waits 30 frames and
// takes the rope; the overworld loop then plays the warp (HandleFlyWarpOrDungeonWarp: the player
// spins up, a white fade, the new map). Frame by frame, the page's layout rules see the HD view
// alone from the tap to Pewter City. (What the QA player saw was the HD Pokédex shutting: it's a
// red handheld with a screen and a d-pad.) Skips without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import {
  GameActions, GameBoy, OverworldDecoder, ScreenTextDecoder, BATTLE_WATCHES, OVERWORLD_WATCHES, TEXT_WATCHES,
  type ActionResult, type OverworldWatched, type TextWatched, type Watch,
} from "@pokehd/emu";
import { readGlyphs, SYMBOLS, type SymbolName } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { playIntro, setBag, setParty } from "../../../../../packages/emu/src/testing.ts";
import { BattleTracker } from "./battle.ts";
import { hdTextFits } from "./hd-text.ts";
import { inWorldTracker, mapOnlyTracker, screenLayout, type ScreenLayout } from "./screen.ts";

const ROM_PATH = new URL("../../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../../../../../packages/emu/src/generated/sameboy.wasm", import.meta.url);

// Item, species, map and tileset IDs (constants/*.asm).
const ESCAPE_ROPE = 0x1d;
const POTION = 0x14;
const CHARMELEON = 0xb2;
const PEWTER_CITY = 0x02;
const ROUTE_4 = 0x0f;
const MT_MOON_1F = 0x3b;
const CAVERN = 17;

const addr = (name: SymbolName) => SYMBOLS[name].address;
const read = (gb: GameBoy, name: SymbolName) => gb.read(addr(name));

describe.skipIf(!existsSync(ROM_PATH))("an Escape Rope from the HD bag (ROM)", () => {
  it("keeps the HD view up from the tap to the Pokémon Center outside (QA bug 36)", { timeout: 120_000 }, async () => {
    const rom = new Uint8Array(readFileSync(ROM_PATH));
    const gb = await GameBoy.create({ rom, wasmBinary: readFileSync(WASM_PATH) });
    playIntro(gb);
    setParty(gb, rom, [{ species: CHARMELEON, level: 22 }]);
    setBag(gb, [[ESCAPE_ROPE, 2], [POTION, 3]]);
    // Into Mt. Moon 1F by the Route 4 entrance, as a warp would: EnterMap loads the map from wCurMap.
    gb.write(addr("wCurMap"), MT_MOON_1F);
    gb.write(addr("wLastMap"), ROUTE_4);
    gb.write(addr("wLastBlackoutMap"), PEWTER_CITY);
    gb.write(addr("wXCoord"), 14);
    gb.write(addr("wYCoord"), 33);
    let entered = false;
    const remove = gb.addHook("OverworldLoop", (g) => {
      if (entered) return;
      entered = true;
      g.setRegisters({ pc: addr("EnterMap") });
    });
    for (let i = 0; i < 300; i++) gb.runFrame();
    remove();
    expect([read(gb, "wCurMap"), read(gb, "wCurMapTileset")]).toEqual([MT_MOON_1F, CAVERN]);

    // The page's frame loop (Game.tsx onFrame), without the battle and onboarding parts it doesn't need.
    let watches: Record<string, Watch> = {};
    const battles = new BattleTracker(rom, { ...OVERWORLD_WATCHES, ...TEXT_WATCHES, ...BATTLE_WATCHES }, (w) => (watches = w));
    const decoder = new OverworldDecoder();
    const textDecoder = new ScreenTextDecoder(readGlyphs(rom));
    const trackInWorld = inWorldTracker(true);
    const trackMapOnly = mapOnlyTracker();
    const actions = new GameActions(gb, { rom });
    let result: ActionResult | undefined;
    actions.run({ kind: "use-item", item: ESCAPE_ROPE }, (r) => (result = r));

    const layouts = new Map<ScreenLayout, number>();
    let windowUp = 0;
    let fadedOut = false;
    for (let i = 0; i < 900; i++) {
      gb.runFrame();
      const watched = Object.fromEntries(Object.entries(watches).map(([k, [a, n]]) => [k, gb.readBytes(a, n)]));
      const bytes = watched as unknown as OverworldWatched;
      const state = decoder.decode(bytes);
      const inWorld = trackInWorld(bytes);
      const battle = battles.frame(watched).scene;
      const acting = actions.running;
      const text = textDecoder.decode(watched as unknown as TextWatched);
      const fits = acting ? false : hdTextFits(text, state.mode, inWorld);
      const mapOnly = trackMapOnly((watched as unknown as TextWatched).tileMap, state.mode, inWorld);
      const layout = screenLayout(state.mode, inWorld, false, fits || mapOnly || acting, battle);
      layouts.set(layout, (layouts.get(layout) ?? 0) + 1);
      if (state.mode === "dialog") windowUp++;
      if (state.fade === -1) fadedOut = true;
      if (fadedOut && state.mapId === PEWTER_CITY && state.fade === 0 && result) break;
    }

    expect(result).toEqual({ ok: true, messages: [] });
    // The rope is gone, and the player stands outside Pewter City's Pokémon Center.
    expect([...gb.readBytes(addr("wNumBagItems"), 5)]).toEqual([2, ESCAPE_ROPE, 1, POTION, 3]);
    expect(read(gb, "wCurMap")).toBe(PEWTER_CITY);
    expect(fadedOut).toBe(true);
    // The window was up (the text frame the map is redrawn in), but nothing ever showed the Game Boy screen.
    expect(windowUp).toBeGreaterThan(20);
    expect([...layouts.keys()]).toEqual(["hidden"]);
  });
});
