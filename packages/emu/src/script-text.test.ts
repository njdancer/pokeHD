// ROM test for whole messages from the script: the page gets Oak's messages whole, the game waits
// on each until the page has read it, then runs through the rest by itself. Skips without the ROM.
import { existsSync, readFileSync } from "node:fs";
import { messageBoxes, SYMBOLS } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { Controls } from "./controls.ts";
import { Button, GameBoy } from "./core.ts";
import type { ScriptMessage } from "./script-text.ts";
import { playIntro } from "./testing.ts";

const ROM_PATH = new URL("../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("./generated/sameboy.wasm", import.meta.url);

describe.skipIf(!existsSync(ROM_PATH))("script text", () => {
  it("holds each of Oak's messages for the page, then runs through it", { timeout: 60_000 }, async () => {
    const rom = new Uint8Array(readFileSync(ROM_PATH));
    const gb = await GameBoy.create({ rom, wasmBinary: readFileSync(WASM_PATH) });
    const messages: ScriptMessage[] = [];
    const ended: number[] = [];
    let presses = 0;
    const controls = new Controls(gb, {
      setButtons: (m) => gb.setButtons(m),
      script: { message: (m) => messages.push(m), end: (id) => ended.push(id), press: () => presses++ },
    });
    controls.setScriptText(rom);
    const run = (frames: number) => {
      for (let i = 0; i < frames; i++) {
        controls.frame();
        gb.runFrame();
      }
    };
    run(400);
    for (let i = 0; i < 40 && messages.length === 0; i++) {
      controls.tap(Button.Start);
      run(6);
    }
    controls.select(0, true);
    // NEW GAME, then on into Oak's speech.
    for (let f = 0; f < 3000 && messages.length === 0; f++) {
      controls.setButtons(f % 6 < 2 ? Button.A : 0);
      run(1);
    }
    controls.setButtons(0);
    presses = 0;
    expect(messages).toHaveLength(1);
    const first = messages[0]!;
    // Oak's welcome, whole, before the game has printed past its first page.
    const boxes = messageBoxes(first.message);
    expect(boxes.flat().join(" ")).toMatch(/^Hello there!/);
    expect(first.message.pages.length).toBeGreaterThan(2);
    // The player's A goes to the page; the game stays put.
    for (let i = 0; i < 10; i++) {
      controls.setButtons(Button.A);
      run(3);
      controls.setButtons(0);
      run(3);
    }
    expect(presses).toBe(10);
    run(120);
    expect(messages).toHaveLength(1);
    expect(gb.read(SYMBOLS.wStatusFlags5.address) & 0x40).toBe(0x40);
    // Read: the game runs through the rest, on to Oak's next message.
    controls.readOn(first.id);
    controls.closeMessage(first.id);
    for (let i = 0; i < 900 && messages.length === 1; i++) run(1);
    expect(ended).toContain(first.id);
    expect(messages.length).toBe(2);
    expect(messageBoxes(messages[1]!.message).flat().join(" ")).not.toMatch(/^Hello there!/);
    // Read straight through: each message follows the last until Oak asks the player's name.
    const texts = () => messages.map((m) => messageBoxes(m.message).flat().join(" "));
    let handled = 1;
    for (let f = 0; f < 6000 && !texts().some((t) => /your name\?/.test(t)); f++) {
      while (handled < messages.length) {
        const m = messages[handled++]!;
        controls.readOn(m.id);
        controls.closeMessage(m.id);
      }
      run(1);
    }
    expect(texts().some((t) => /your name\?/.test(t))).toBe(true);
    expect(new Set(texts()).size).toBe(messages.length);
    // Off again: the game's own text delay is back.
    controls.setScriptText(null);
    expect(gb.read(SYMBOLS.wStatusFlags5.address) & 0x40).toBe(0);
  });

  it("holds a message in the world until the page closes it, then the box closes", { timeout: 60_000 }, async () => {
    const rom = new Uint8Array(readFileSync(ROM_PATH));
    const gb = await GameBoy.create({ rom, wasmBinary: readFileSync(WASM_PATH) });
    const messages: ScriptMessage[] = [];
    const ended: number[] = [];
    const controls = new Controls(gb, {
      setButtons: (m) => gb.setButtons(m),
      script: { message: (m) => messages.push(m), end: (id) => ended.push(id), press: () => {} },
    });
    playIntro(gb);
    controls.setScriptText(rom);
    const run = (frames: number) => {
      for (let i = 0; i < frames; i++) {
        controls.frame();
        gb.runFrame();
      }
    };
    // In the bedroom, facing the SNES just above.
    controls.tap(Button.Up);
    run(20);
    controls.tap(Button.A);
    for (let i = 0; i < 300 && messages.length === 0; i++) run(1);
    expect(messages).toHaveLength(1);
    const { id, message } = messages[0]!;
    expect(message.ending).toBe("done");
    expect(messageBoxes(message).flat().join(" ")).toMatch(/is playing the SNES!.*It's time to go!/);
    // Nothing moves on while the page shows it.
    run(300);
    expect(ended).toEqual([]);
    controls.readOn(id);
    run(120);
    expect(ended).toEqual([]);
    // Closed: the game runs through it and closes the box itself.
    let closed = false;
    gb.addHook("CloseTextDisplay", () => (closed = true));
    controls.closeMessage(id);
    for (let i = 0; i < 300 && !closed; i++) run(1);
    expect(closed).toBe(true);
    expect(ended).toEqual([id]);
    expect(gb.read(SYMBOLS.wStatusFlags5.address) & 0x40).toBe(0);
  });
});
