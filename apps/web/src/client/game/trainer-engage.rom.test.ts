// ROM test for trainers on the field (QA bug 39), with the page's own message handling
// (scriptView, scriptTap, the pad's A reading on) over the real game, on Route 3:
// - walking into a Lass's line of sight: she walks up, "You looked at me, didn't you?" shows once,
//   one tap on the box reads past it, and the battle starts (DisplayEnemyTrainerTextAndStartBattle);
// - talking to one who hasn't seen the player (TalkToTrainer, then StartTrainerBattle): the same;
// - talking to one already beaten: her after-battle line, "Quit staring if you don't want to
//   fight!", once per talk, closed by one tap, and no battle. That's the original game: QA bug 39
//   was this Lass, beaten earlier in the same run (the save has EVENT_BEAT_ROUTE_3_TRAINER_2 set),
//   with each A on the pad talking to her again.
// Skips without the ROM.
import { existsSync, readFileSync } from "node:fs";
import {
  Button, Controls, GameBoy, OverworldDecoder, OVERWORLD_WATCHES, ScreenTextDecoder, TEXT_WATCHES,
  type OverworldWatched, type TextWatched,
} from "@pokehd/emu";
import { readGlyphs, SYMBOLS, type SymbolName } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { playIntro, setParty } from "../../../../../packages/emu/src/testing.ts";
import { hdTextFits } from "./hd-text.ts";
import { inWorldTracker } from "./screen.ts";
import { newScriptView, scriptTap, scriptView, type ScriptView } from "./script-view.ts";

const ROM_PATH = new URL("../../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../../../../../packages/emu/src/generated/sameboy.wasm", import.meta.url);

// constants/map_constants.asm, pokemon_constants.asm.
const PEWTER_CITY = 0x02;
const ROUTE_3 = 0x0e;
/** Route 3's width in blocks (map_constants.asm). */
const ROUTE_3_WIDTH = 35;
const CHARMELEON = 0xb2;
/** EVENT_BEAT_ROUTE_3_TRAINER_2 (the Lass at 16, 9): its byte in wEventFlags, and its bit. */
const BEAT_LASS = { byte: 0x7c, bit: 4 };
/** wIsInBattle in a trainer battle. */
const TRAINER_BATTLE = 2;

const addr = (name: SymbolName) => SYMBOLS[name].address;

/** A fresh game on Route 3 at (x, y), as a warp would put it there, and the page over it. */
async function route3(x: number, y: number, beaten = false) {
  const rom = new Uint8Array(readFileSync(ROM_PATH));
  const gb = await GameBoy.create({ rom, wasmBinary: readFileSync(WASM_PATH) });
  playIntro(gb);
  setParty(gb, rom, [{ species: CHARMELEON, level: 30 }]);
  const flag = addr("wEventFlags") + BEAT_LASS.byte;
  if (beaten) gb.write(flag, gb.read(flag) | (1 << BEAT_LASS.bit));
  // At the top of the overworld loop, so the old map's script never runs with the new map's number.
  let entered = false;
  const remove = gb.addHook("OverworldLoop", (g) => {
    if (entered) return;
    entered = true;
    g.write(addr("wCurMap"), ROUTE_3);
    g.write(addr("wLastMap"), PEWTER_CITY);
    g.write(addr("wXCoord"), x);
    g.write(addr("wYCoord"), y);
    // The block map view a warp to (x, y) sets (event_displacement): EnterMap draws from it.
    const view = addr("wOverworldMap") + 7 + ROUTE_3_WIDTH + (ROUTE_3_WIDTH + 6) * (y >> 1) + (x >> 1);
    g.write(addr("wCurrentTileBlockMapViewPointer"), view & 0xff);
    g.write(addr("wCurrentTileBlockMapViewPointer") + 1, view >> 8);
    g.write(addr("wYBlockCoord"), y & 1);
    g.write(addr("wXBlockCoord"), x & 1);
    g.setRegisters({ pc: addr("EnterMap") });
  });
  for (let i = 0; i < 300; i++) gb.runFrame();
  remove();
  const read = (name: SymbolName) => gb.read(addr(name));
  expect([read("wCurMap"), read("wXCoord"), read("wYCoord")]).toEqual([ROUTE_3, x, y]);

  // The page, as Game runs it: whole messages from the script, read on by taps on the box or A.
  const ref: { current: ScriptView | null } = { current: null };
  /** Every message the page was handed, by its first box. */
  const messages: string[] = [];
  const readOnScript = () => {
    const script = ref.current;
    const tap = scriptTap(script);
    if (tap === "next" && script!.index === script!.boxes.length - 1) controls.readOn(script!.id);
    if (tap === "close") controls.closeMessage(script!.id);
    return tap !== "none";
  };
  const controls: Controls = new Controls(gb, {
    setButtons: (m) => gb.setButtons(m),
    script: {
      message: ({ id, message, letterFrames }) => {
        ref.current = newScriptView(id, message, letterFrames);
        messages.push(ref.current.boxes[0]!.join(" "));
        if (ref.current.boxes.length <= 1) controls.readOn(id);
      },
      end: (id) => {
        if (ref.current?.id === id) ref.current.ended = true;
      },
      press: () => readOnScript(),
    },
  });
  controls.setScriptText(rom);
  const decoder = new OverworldDecoder();
  const textDecoder = new ScreenTextDecoder(readGlyphs(rom));
  const trackInWorld = inWorldTracker(true);
  const watches = { ...OVERWORLD_WATCHES, ...TEXT_WATCHES };
  /** The lines the HD box shows this frame. */
  let shown: string[] | null = null;
  const step = () => {
    controls.frame();
    gb.runFrame();
    const watched = Object.fromEntries(Object.entries(watches).map(([k, [a, n]]) => [k, gb.readBytes(a, n)]));
    const state = decoder.decode(watched as unknown as OverworldWatched);
    const text = textDecoder.decode(watched as unknown as TextWatched);
    const fits = hdTextFits(text, state.mode, trackInWorld(watched as unknown as OverworldWatched));
    shown = scriptView(ref, text, fits, (id) => controls.releaseMessage(id))?.lines ?? null;
  };
  const run = (frames: number) => {
    for (let i = 0; i < frames; i++) step();
  };
  /** A tap on the pad: the player's own button, down for about 80 ms. */
  const pad = (button: number) => {
    controls.setButtons(button);
    run(5);
    controls.setButtons(0);
  };
  /** A tap on the HD message box (TextOverlay's press: the message, or the game's A). */
  const box = () => {
    if (!readOnScript()) controls.tap(Button.A);
  };
  /** Holds a direction until the player stands at x (or `frames` run out). */
  const walk = (button: number, x: number, frames = 300) => {
    controls.setButtons(button);
    for (let i = 0; i < frames && !(read("wXCoord") === x && read("wWalkCounter") === 0); i++) step();
    controls.setButtons(0);
  };
  /** Runs until the HD box shows a message the player has had time to read. */
  const untilReadable = (limit = 600) => {
    for (let i = 0; i < limit; i++) {
      step();
      const script = ref.current;
      if (shown && script && !script.closed && !script.ended && script.shown > script.readyAt + 10) return script;
    }
    throw new Error(`No message to read (messages: ${JSON.stringify(messages)})`);
  };
  /** The field is the player's again: no window, no buttons ignored, no message. */
  const free = () => read("hWY") >= 144 && read("wJoyIgnore") === 0 && read("wIsInBattle") === 0 && !ref.current;
  return { gb, read, messages, step, run, pad, box, walk, untilReadable, free, shown: () => shown };
}

describe.skipIf(!existsSync(ROM_PATH))("trainers on Route 3 (ROM)", () => {
  it("a Lass who sees the player walks up, speaks once, and the battle starts", { timeout: 120_000 }, async () => {
    const t = await route3(12, 9);
    // Into her line of sight (she faces left from (16, 9) and sees two tiles).
    t.walk(Button.Right, 14);
    const script = t.untilReadable();
    expect(t.shown()).toEqual(["You looked at me,", "didn't you?"]);
    t.box();
    expect(script.closed).toBe(true);
    for (let i = 0; i < 600 && t.read("wIsInBattle") === 0; i++) t.step();
    expect(t.read("wIsInBattle")).toBe(TRAINER_BATTLE);
    expect(t.messages).toEqual(["You looked at me, didn't you?"]);
  });

  it("a Lass talked to before she sees the player speaks once, and the battle starts", { timeout: 120_000 }, async () => {
    // The Lass at (33, 10) faces up: from her left, she hasn't seen the player.
    const t = await route3(30, 10);
    t.walk(Button.Right, 32);
    t.run(20);
    expect(t.free()).toBe(true);
    t.pad(Button.A);
    t.untilReadable();
    expect(t.shown()).toEqual(["Eek! Did you", "touch me?"]);
    // Read past with the pad's A, this time.
    t.pad(Button.A);
    for (let i = 0; i < 600 && t.read("wIsInBattle") === 0; i++) t.step();
    expect(t.read("wIsInBattle")).toBe(TRAINER_BATTLE);
    expect(t.messages).toEqual(["Eek! Did you touch me?"]);
  });

  it("a Lass already beaten says her after-battle line once per talk, and one tap closes it (QA bug 39)", { timeout: 120_000 }, async () => {
    const t = await route3(12, 9, true);
    // Her line of sight is no matter now: up to her, facing her.
    t.walk(Button.Right, 15);
    t.run(30);
    expect(t.free()).toBe(true);
    for (const close of [() => t.box(), () => t.pad(Button.A)]) {
      t.pad(Button.A);
      t.untilReadable();
      expect(t.shown()).toEqual(["Quit staring if", "you don't want to", "fight!"]);
      close();
      t.run(120);
      expect(t.free()).toBe(true);
      expect(t.shown()).toBeNull();
    }
    // Each A on the pad was one talk, and none of them a battle.
    expect(t.messages).toEqual(["Quit staring if you don't want to fight!", "Quit staring if you don't want to fight!"]);
    expect(t.read("wXCoord")).toBe(15);
  });
});
