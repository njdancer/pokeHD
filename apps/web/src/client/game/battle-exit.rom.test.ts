// ROM test for the way out of a battle (QA bug 11): from the battle's last message to the map
// back on screen, the Game Boy screen never comes up. EndOfBattle clears wIsInBattle, then waits
// for the sound effect to finish (WaitForSoundToFinish) with the battle's last frame on screen,
// then whites it out; the overworld loop then sets BIT_BATTLE_OVER_OR_BLACKOUT while it reloads
// the map. Here no sound is playing at that moment, so the wait is shorter than a frame; on the
// live game it can last a few, so the page is also asked what it would show if a frame ended
// right there. Skips without the ROM.
import { existsSync, readFileSync } from "node:fs";
import { BATTLE_WATCHES, Button, GameBoy, OVERWORLD_WATCHES, OverworldDecoder, TEXT_WATCHES, type OverworldWatched, type Watch } from "@pokehd/emu";
import { SYMBOLS } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { playToRivalBattle } from "../../../../../packages/emu/src/testing.ts";
import { BattleTracker } from "./battle.ts";
import { screenLayout } from "./screen.ts";

const ROM_PATH = new URL("../../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../../../../../packages/emu/src/generated/sameboy.wasm", import.meta.url);

describe.skipIf(!existsSync(ROM_PATH))("the way out of a battle", () => {
  it("keeps the Game Boy screen down from the last message to the map (QA bug 11)", { timeout: 120_000 }, async () => {
    const rom = new Uint8Array(readFileSync(ROM_PATH));
    const gb = await GameBoy.create({ rom, wasmBinary: readFileSync(WASM_PATH) });
    playToRivalBattle(gb);
    let watches: Record<string, Watch> = {};
    const battles = new BattleTracker(rom, { ...OVERWORLD_WATCHES, ...TEXT_WATCHES, ...BATTLE_WATCHES }, (w) => (watches = w));
    const decoder = new OverworldDecoder();
    const read = (name: keyof typeof SYMBOLS) => gb.read(SYMBOLS[name].address);
    /** What the page lays out for the game's memory as it is now. */
    const look = () => {
      const watched = Object.fromEntries(Object.entries(watches).map(([k, [a, n]]) => [k, gb.readBytes(a, n)]));
      const state = decoder.decode(watched as unknown as OverworldWatched);
      const fight = battles.frame(watched);
      return { layout: screenLayout(state.mode, true, false, false, fight.scene), scene: fight.scene, view: !!fight.view, fade: state.fade };
    };
    // The moment the battle's over and the game waits on the sound, with the battle still up.
    let waiting: ReturnType<typeof look> | null = null;
    let fought = false;
    const remove = gb.addHook("WaitForSoundToFinish", () => {
      if (fought && !waiting && read("wIsInBattle") === 0) waiting = look();
    });
    // Every frame once the battle is over; during it, now and then (the page sees every frame,
    // but the tracker only needs to have seen the battle, and reading it all is slow).
    const out: ReturnType<typeof look>[] = [];
    for (let i = 0; i < 20_000; i++) {
      if (fought && read("wIsInBattle") === 0 && read("hWY") >= 144 && out.at(-1)?.fade === 0) break;
      gb.setButtons(read("wIsInBattle") && i % 8 < 2 ? Button.A : 0);
      gb.runFrame();
      if (read("wIsInBattle") !== 0) {
        if (i % 30 === 0 && look().scene === "scene") fought = true;
      } else if (fought) out.push(look());
    }
    remove();

    expect(waiting).toMatchObject({ layout: "hidden", scene: "transition", view: false, fade: 0 });
    // From the battle's end on: the HD view, never the Game Boy screen.
    expect(out.length).toBeGreaterThan(20);
    expect(new Set(out.map((f) => f.layout))).toEqual(new Set(["hidden"]));
    // White straight away, held while the map reloads, then the game's fade back in.
    expect(out[0]!.fade).toBe(-1);
    expect(out.at(-1)!.fade).toBe(0);
  });
});
