// ROM test for the page's own start (Starter) against the real title screen and main menu:
// continuing from a save always ends in the world as that save's trainer, however late the page
// lets go of the title (the held /dev/saves game passes it on Resume), however late the page's
// taps reach the worker, and whatever the player presses meanwhile. Skips without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { Button, Controls, GameBoy, OVERWORLD_WATCHES, ScreenTextDecoder, TEXT_WATCHES, type OverworldWatched, type TextWatched, type Watch } from "@pokehd/emu";
import { readGlyphs, SYMBOLS } from "@pokehd/rom";
import { beforeAll, describe, expect, it } from "vitest";
import { fuzzSeeds, rng } from "../../../../../packages/emu/src/fuzz.ts";
import { saveGame } from "../../../../../packages/emu/src/gifts/gifts.ts";
import { SafePoint } from "../../../../../packages/emu/src/gifts/safepoint.ts";
import { playIntro } from "../../../../../packages/emu/src/testing.ts";
import { Starter } from "./onboarding.ts";
import { inWorldTracker } from "./screen.ts";

const ROM_PATH = new URL("../../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../../../../../packages/emu/src/generated/sameboy.wasm", import.meta.url);

const read = (gb: GameBoy, watches: Record<string, Watch>) =>
  Object.fromEntries(Object.entries(watches).map(([k, [a, n]]) => [k, gb.readBytes(a, n)]));
const trainer = (gb: GameBoy) => [...gb.readBytes(SYMBOLS.wPlayerID.address, 2), ...gb.readBytes(SYMBOLS.wPlayerName.address, 11)].join(",");

describe.skipIf(!existsSync(ROM_PATH))("Starter on the real title screen", () => {
  let rom: Uint8Array;
  let wasm: Uint8Array;
  let sram: Uint8Array;
  let saved: string;

  beforeAll(async () => {
    rom = new Uint8Array(readFileSync(ROM_PATH));
    wasm = readFileSync(WASM_PATH);
    const gb = await GameBoy.create({ rom, wasmBinary: wasm });
    playIntro(gb);
    const safe = SafePoint.of(gb);
    safe.enqueue({ scratch: [], steps: [saveGame] });
    for (let i = 0; i < 600 && safe.pending > 0; i++) gb.runFrame();
    for (let i = 0; i < 60; i++) gb.runFrame();
    sram = gb.saveSram();
    saved = trainer(gb);
  }, 60_000);

  /**
   * Boots on the save and runs the page's start as Game does: the worker's Controls take the
   * page's taps `latency` frames after the page sends them; the player's own buttons go in too.
   */
  const run = async (seed: number, options: { startAt: number; latency: number; mash: number; scriptText: boolean }) => {
    const r = rng(seed);
    const gb = await GameBoy.create({ rom, sram, wasmBinary: wasm });
    const controls = new Controls(gb, { setButtons: (m) => gb.setButtons(m), script: { message: () => {}, end: () => {}, press: () => {} } });
    if (options.scriptText) controls.setScriptText(rom);
    const decoder = new ScreenTextDecoder(readGlyphs(rom));
    const inWorld = inWorldTracker();
    const inbox: { at: number; send: () => void }[] = [];
    let frame = 0;
    const later = (send: () => void) => inbox.push({ at: frame + options.latency, send });
    const starter = new Starter("continue", { tap: (m) => later(() => controls.tap(m)), select: (i, p) => later(() => controls.select(i, p)) });
    let world = false;
    for (; frame < 8000; frame++) {
      while (inbox[0] && inbox[0].at <= frame) inbox.shift()!.send();
      if (frame >= options.startAt && options.mash && r.chance(options.mash)) {
        controls.setButtons(r.chance(0.5) ? 0 : r.pick([Button.A, Button.B, Button.Down, Button.Up, Button.Start]));
      }
      controls.frame();
      gb.runFrame();
      const text = decoder.decode(read(gb, TEXT_WATCHES) as TextWatched);
      world = inWorld(read(gb, OVERWORLD_WATCHES) as OverworldWatched);
      if (frame >= options.startAt) starter.frame(text, world, frame);
      if (starter.done && world) break;
    }
    // Let a NEW GAME show itself: its intro clears the trainer.
    controls.setButtons(0);
    for (let i = 0; i < 120; i++) {
      controls.frame();
      gb.runFrame();
    }
    return { world, starterDone: starter.done, trainer: trainer(gb), frame };
  };

  it("continues as the saved trainer", async () => {
    const out = await run(1, { startAt: 0, latency: 1, mash: 0, scriptText: true });
    expect(out).toMatchObject({ world: true, starterDone: true, trainer: saved });
  }, 60_000);

  // Without the player's buttons: the page alone must always get there.
  it.each(fuzzSeeds(4))("continues as the saved trainer whenever it starts and however slow taps are (seed %i)", async (seed) => {
    const r = rng(seed);
    const options = { startAt: r.int(1500), latency: r.int(6), mash: 0, scriptText: r.chance(0.5) };
    const out = await run(seed, options);
    expect(out, JSON.stringify(options)).toMatchObject({ world: true, starterDone: true, trainer: saved });
  }, 60_000);
});
