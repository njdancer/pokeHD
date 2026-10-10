// ROM test for tap-first controls: the intro's name questions answered by the page land in the
// game as if typed, a null answer hands back the game's own screen, and a tapped menu choice
// moves the game's cursor and presses A. Skips without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { decodeText, encodeName, SYMBOLS } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { Controls, type NameAsk } from "./controls.ts";
import { Button, GameBoy } from "./core.ts";
import { playIntro } from "./testing.ts";

const ROM_PATH = new URL("../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("./generated/sameboy.wasm", import.meta.url);

describe.skipIf(!existsSync(ROM_PATH))("controls", () => {
  const boot = async () => {
    const rom = new Uint8Array(readFileSync(ROM_PATH));
    const gb = await GameBoy.create({ rom, wasmBinary: readFileSync(WASM_PATH) });
    const asks: NameAsk[] = [];
    let done = 0;
    const controls = new Controls(gb, { setButtons: (m) => gb.setButtons(m), names: { ask: (a) => asks.push(a), done: () => done++ } });
    const run = (frames: number) => {
      for (let i = 0; i < frames; i++) {
        controls.frame();
        gb.runFrame();
      }
    };
    return { gb, controls, asks, run, done: () => done };
  };
  const name = (gb: GameBoy, symbol: "wPlayerName" | "wRivalName") => decodeText(gb.readBytes(SYMBOLS[symbol].address, 11));

  it("answers the intro's name questions with the page's names", { timeout: 60_000 }, async () => {
    const { gb, controls, asks, run, done } = await boot();
    run(400);
    // The title screen, then NEW GAME (the only save-less choice before OPTION).
    for (let i = 0; i < 40; i++) {
      controls.tap(Button.Start);
      run(6);
    }
    controls.select(0, true);
    run(30);
    // Through Oak's speech: the player mashes A, until the page is asked.
    let frames = 0;
    while (asks.length === 0 && frames++ < 3000) {
      controls.setButtons(frames % 6 < 2 ? Button.A : 0);
      run(1);
    }
    expect(asks).toEqual([{ kind: "player", from: "intro" }]);
    // Asked as Oak starts his question, before the game's list of names.
    let listed = false;
    const removeHook = gb.addHook("ChoosePlayerName", () => (listed = true));
    expect(listed).toBe(false);
    // The player's A presses are held back meanwhile: nothing moves on.
    run(120);
    expect(done()).toBe(0);
    controls.answerName(encodeName("Nick.J"));
    run(240);
    expect(done()).toBe(1);
    expect(listed).toBe(true);
    removeHook();
    expect(name(gb, "wPlayerName")).toBe("Nick.J");
    while (asks.length === 1 && frames++ < 6000) {
      controls.setButtons(frames % 6 < 2 ? Button.A : 0);
      run(1);
    }
    expect(asks[1]).toEqual({ kind: "rival", from: "intro" });
    controls.setButtons(0);
    controls.answerName(encodeName("Gary"));
    run(240);
    expect(name(gb, "wRivalName")).toBe("Gary");
    playIntro(gb);
    expect(name(gb, "wPlayerName")).toBe("Nick.J");
  });

  it("turns the player for a direction pressed and let go between two frames", { timeout: 60_000 }, async () => {
    const { gb, controls, run } = await boot();
    playIntro(gb);
    run(60);
    // wSpritePlayerStateData1FacingDirection: down 0, up 4, left 8, right 12.
    const facing = () => gb.read(0xc109);
    for (const [button, dir] of [[Button.Up, 4], [Button.Down, 0], [Button.Left, 8], [Button.Up, 4], [Button.Down, 0]] as const) {
      controls.setButtons(button);
      controls.setButtons(0);
      run(30);
      expect(facing()).toBe(dir);
    }
  });

  it("moves the menu cursor and presses A for a tapped choice", { timeout: 60_000 }, async () => {
    const { gb, controls, run } = await boot();
    playIntro(gb);
    controls.tap(Button.Start);
    run(30);
    // POKéMON, ITEM, the player, SAVE, OPTION, EXIT: no POKéDEX yet.
    const exit = 5;
    controls.select(exit, false);
    run(60);
    expect(gb.read(SYMBOLS.wCurrentMenuItem.address)).toBe(exit);
    controls.select(0, false);
    run(60);
    expect(gb.read(SYMBOLS.wCurrentMenuItem.address)).toBe(0);
    // EXIT closes the menu.
    controls.select(exit, true);
    run(60);
    expect(controls.busy).toBe(false);
  });
});
