// ROM test for QA bug 27: a Pokémon evolving after a battle is staged in HD, never on the Game Boy
// screen. A Squirtle a few experience points short of level 16 beats a wild Rattata, grows and
// evolves; the page's BattleTracker must spot the evolution screen, show the right picture in the
// right colours (the swapping in silhouette), keep the layout off the full Game Boy screen and
// leave the text to the HD layer. Skips without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import {
  Button, GameBoy, OverworldDecoder, ScreenTextDecoder, BATTLE_WATCHES, OVERWORLD_WATCHES, TEXT_WATCHES,
  type OverworldWatched, type TextWatched, type Watch,
} from "@pokehd/emu";
import { monName, readGlyphs, SYMBOLS, type SymbolName } from "@pokehd/rom";
import { beforeAll, describe, expect, it } from "vitest";
import { playIntro, setParty } from "../../../../../packages/emu/src/testing.ts";
import { BattleTracker, battleText } from "./battle.ts";
import { battleTextFits } from "./hd-text.ts";
import { screenLayout, type ScreenLayout } from "./screen.ts";

const ROM_PATH = new URL("../../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../../../../../packages/emu/src/generated/sameboy.wasm", import.meta.url);

const SQUIRTLE = 0xb1;
const RATTATA = 0xa5;
/** wPartyMon1Exp: the party struct's experience, 3 bytes big-endian. */
const EXP = 14;
/** Medium Slow's experience for level 16: 6/5·16³ − 15·16² + 100·16 − 140. */
const LEVEL_16_EXP = 2535;

const addr = (name: SymbolName) => SYMBOLS[name].address;
const read = (gb: GameBoy, watches: Record<string, Watch>) =>
  Object.fromEntries(Object.entries(watches).map(([k, [a, n]]) => [k, gb.readBytes(a, n)]));

describe.skipIf(!existsSync(ROM_PATH))("evolution after a battle (ROM)", () => {
  let rom: Uint8Array;
  let wasm: Uint8Array;
  let start: Uint8Array;
  beforeAll(async () => {
    rom = new Uint8Array(readFileSync(ROM_PATH));
    wasm = new Uint8Array(readFileSync(WASM_PATH));
    const gb = await GameBoy.create({ rom, wasmBinary: wasm });
    playIntro(gb);
    start = gb.saveState();
  }, 120_000);

  it("stages the evolution in HD, with its text in HD boxes", async () => {
    const gb = await GameBoy.create({ rom, wasmBinary: wasm });
    gb.loadState(start);
    setParty(gb, rom, [{ species: SQUIRTLE, level: 15 }]);
    const exp = LEVEL_16_EXP - 5;
    [exp >> 16, (exp >> 8) & 255, exp & 255].forEach((v, i) => gb.write(addr("wPartyMons") + EXP + i, v));
    gb.write(addr("wCurOpponent"), RATTATA);
    gb.write(addr("wCurEnemyLevel"), 2);

    let watches: Record<string, Watch> = {};
    const tracker = new BattleTracker(rom, { ...OVERWORLD_WATCHES, ...TEXT_WATCHES, ...BATTLE_WATCHES }, (w) => (watches = w));
    const decoder = new OverworldDecoder();
    const text = new ScreenTextDecoder(readGlyphs(rom));
    const species: number[] = [];
    let silhouettes = 0;
    const layouts = new Set<ScreenLayout>();
    const unfit: string[] = [];
    let started = false;
    let evolutionFrames = 0;
    let firstWithView: { oldSpecies: number; newSpecies: number } | null = null;
    let last: { species: number; silhouette: boolean } | null = null;
    for (let i = 0; i < 6000; i++) {
      // A through the battle (FIGHT, the first move) and its messages; never B, which stops it.
      gb.setButtons(i % 16 < 2 ? Button.A : 0);
      gb.runFrame();
      const watched = read(gb, watches);
      const inBattle = gb.read(addr("wIsInBattle")) !== 0;
      started ||= inBattle;
      if (started && !inBattle) break;
      const fight = tracker.frame(watched);
      if (fight.scene !== "evolution") continue;
      evolutionFrames++;
      const state = decoder.decode(watched as OverworldWatched);
      expect(fight.screen).not.toBeNull();
      const shown = text.decode(battleText(watched as TextWatched, fight.screen!));
      const fits = battleTextFits(shown);
      if (shown.shown && shown.boxes.length && !fits) unfit.push(shown.boxes.map((b) => b.lines.map((l) => l.text).join(" ")).join(" / "));
      layouts.add(screenLayout(state.mode, true, false, fits, fight.scene));
      const evolving = fight.view?.evolving;
      const evo = fight.evolution;
      if (!evolving || !evo) continue;
      expect(fight.view!.enemy).toBeNull();
      expect(fight.view!.player).toBeNull();
      firstWithView ??= { oldSpecies: evo.oldSpecies, newSpecies: evo.newSpecies };
      // The picture is drawn: some of its pixels are the Pokémon's, not the background's colour 0.
      expect(evolving.pixels.some((p) => p > 0 && p < 4)).toBe(true);
      if (species.at(-1) !== evo.species) species.push(evo.species);
      if (evo.silhouette) silhouettes++;
      last = { species: evo.species, silhouette: evo.silhouette };
    }
    expect(started).toBe(true);
    expect(evolutionFrames).toBeGreaterThan(100);
    expect(firstWithView).not.toBeNull();
    expect(monName(rom, firstWithView!.oldSpecies)).toBe("SQUIRTLE");
    expect(monName(rom, firstWithView!.newSpecies)).toBe("WARTORTLE");
    // Old, then back and forth, ending on the new one in its own colours.
    expect(species[0]).toBe(SQUIRTLE);
    expect(species.length).toBeGreaterThan(4);
    expect(last?.species).toBe(firstWithView!.newSpecies);
    expect(last?.silhouette).toBe(false);
    expect(silhouettes).toBeGreaterThan(30);
    // Never the Game Boy screen: the battle layout masks everything but text the HD layer draws.
    expect([...layouts]).toEqual(["battle"]);
    expect(unfit).toEqual([]);
  }, 120_000);
});
