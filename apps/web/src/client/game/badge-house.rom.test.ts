// ROM test for a list left on the screen under a message (QA bug 63), with the page's own message
// handling (scriptView, withScriptState, scriptTap) over the real game, in Cerulean City's badge
// house: the man asks "Which of the 8 BADGEs should I describe?" over a list of them
// (DisplayListMenuID, SPECIALLISTMENU, which the page leaves to the game). B on the list
// (ExitListMenu) leaves it drawn, its ▶ still there, while he says "Come visit me any time you
// wish." (CeruleanBadgeHouseMiddleAgedManText's .done). On the Game Boy that's a message waiting
// for a button, and A closes it. The page answers that wait itself, so the game's ▼ never draws,
// and the list read as the menu taking input: the message box took no taps and only the list's ×
// went on. Now the HD text has no menu taking input while a message is under way.
// Skips without the ROM.
import { existsSync, readFileSync } from "node:fs";
import {
  Button, Controls, GameBoy, OverworldDecoder, OVERWORLD_WATCHES, ScreenTextDecoder, TEXT_WATCHES,
  type OverworldWatched, type ScreenText, type TextWatched,
} from "@pokehd/emu";
import { readGlyphs, SYMBOLS, type SymbolName } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { playIntro, setParty } from "../../../../../packages/emu/src/testing.ts";
import { hdTextFits } from "./hd-text.ts";
import { inWorldTracker } from "./screen.ts";
import { newScriptView, scriptTap, scriptView, withScriptState, type ScriptView } from "./script-view.ts";

const ROM_PATH = new URL("../../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../../../../../packages/emu/src/generated/sameboy.wasm", import.meta.url);

// constants/map_constants.asm, pokemon_constants.asm.
const CERULEAN_CITY = 0x03;
const CERULEAN_BADGE_HOUSE = 0xe6;
/** The badge house's width in blocks (map_constants.asm). */
const HOUSE_WIDTH = 4;
const CHARMELEON = 0xb2;

const addr = (name: SymbolName) => SYMBOLS[name].address;

/** A fresh game in the badge house at (x, y), as a warp would put it there, and the page over it. */
async function badgeHouse(x: number, y: number) {
  const rom = new Uint8Array(readFileSync(ROM_PATH));
  const gb = await GameBoy.create({ rom, wasmBinary: readFileSync(WASM_PATH) });
  playIntro(gb);
  setParty(gb, rom, [{ species: CHARMELEON, level: 30 }]);
  let entered = false;
  const remove = gb.addHook("OverworldLoop", (g) => {
    if (entered) return;
    entered = true;
    g.write(addr("wCurMap"), CERULEAN_BADGE_HOUSE);
    g.write(addr("wLastMap"), CERULEAN_CITY);
    g.write(addr("wXCoord"), x);
    g.write(addr("wYCoord"), y);
    const view = addr("wOverworldMap") + 7 + HOUSE_WIDTH + (HOUSE_WIDTH + 6) * (y >> 1) + (x >> 1);
    g.write(addr("wCurrentTileBlockMapViewPointer"), view & 0xff);
    g.write(addr("wCurrentTileBlockMapViewPointer") + 1, view >> 8);
    g.write(addr("wYBlockCoord"), y & 1);
    g.write(addr("wXBlockCoord"), x & 1);
    g.setRegisters({ pc: addr("EnterMap") });
  });
  for (let i = 0; i < 300; i++) gb.runFrame();
  remove();
  const read = (name: SymbolName) => gb.read(addr(name));
  expect([read("wCurMap"), read("wXCoord"), read("wYCoord")]).toEqual([CERULEAN_BADGE_HOUSE, x, y]);

  const ref: { current: ScriptView | null } = { current: null };
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
        messages.push(ref.current.boxes.map((b) => b.join(" ")).join(" "));
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
  /** The HD text layer's text this frame (Game's boxText), or null where it doesn't show. */
  let hd: ScreenText | null = null;
  const step = () => {
    controls.frame();
    gb.runFrame();
    const watched = Object.fromEntries(Object.entries(watches).map(([k, [a, n]]) => [k, gb.readBytes(a, n)]));
    const state = decoder.decode(watched as unknown as OverworldWatched);
    const text = textDecoder.decode(watched as unknown as TextWatched);
    const fits = hdTextFits(text, state.mode, trackInWorld(watched as unknown as OverworldWatched));
    const script = scriptView(ref, text, fits, (id) => controls.releaseMessage(id));
    hd = fits ? (script ? withScriptState(text, ref.current) : text) : null;
  };
  const run = (frames: number) => {
    for (let i = 0; i < frames; i++) step();
  };
  const pad = (button: number) => {
    controls.setButtons(button);
    run(5);
    controls.setButtons(0);
  };
  /** TextOverlay's taps: the message box presses A (only with no menu taking input), the × B. */
  const listActive = () => !!hd?.menus.some((m) => m.active && m.kind === "list");
  const boxTappable = () => !!hd?.dialog && !hd.menus.some((m) => m.active);
  const press = (button: number) => {
    if (!readOnScript()) controls.tap(button);
  };
  const tapBox = () => {
    expect(boxTappable()).toBe(true);
    press(Button.A);
  };
  /** Runs until the HD box shows a message waiting for a tap (its ▼), or the list takes input. */
  const until = (what: "message" | "list", limit = 900) => {
    for (let i = 0; i < limit; i++) {
      step();
      if (what === "list" ? listActive() && (!ref.current || ref.current.ended) : hd?.dialog?.state === "waiting") return;
    }
    throw new Error(`No ${what} (messages: ${JSON.stringify(messages)})`);
  };
  /** Taps each message's box as its ▼ shows, until the list takes input. */
  const readToList = (limit = 3000) => {
    let ready = 0;
    for (let i = 0; i < limit; i++) {
      step();
      if (listActive() && (!ref.current || ref.current.ended)) return;
      // A player who waits for the ▼, then taps.
      if (hd?.dialog?.state === "waiting" && ++ready > 10) {
        ready = 0;
        tapBox();
      }
    }
    throw new Error(`No list (messages: ${JSON.stringify(messages)})`);
  };
  const free = () => read("hWY") >= 144 && read("wJoyIgnore") === 0 && !ref.current;
  return { read, messages, step, run, pad, press, tapBox, until, readToList, listActive, boxTappable, select: (i: number) => controls.select(i, true), hd: () => hd, free };
}

describe.skipIf(!existsSync(ROM_PATH))("the Cerulean badge house's list (ROM)", () => {
  it("cancelling the badge list says goodbye in a box one tap closes (QA bug 63)", { timeout: 120_000 }, async () => {
    // To the man's right, facing him (he sits at (5, 3) facing right).
    const t = await badgeHouse(6, 3);
    t.pad(Button.Left);
    t.run(30);
    expect(t.free()).toBe(true);
    t.pad(Button.A);
    // His opening words, then "Which of the 8 BADGEs should I describe?" and the list.
    t.readToList();
    // BOULDERBADGE once the player has looked at the list (a press as it opens goes by unseen, as
    // on the Game Boy), its description read through, and the list again.
    t.run(30);
    t.select(0);
    t.until("message");
    t.readToList();
    // The list's ×: B.
    t.run(30);
    t.press(Button.B);
    t.until("message");
    expect(t.hd()!.dialog!.lines.join(" ")).toContain("Come visit me");
    // The list is still drawn under it, but it isn't taking input: the box takes the tap.
    expect(t.listActive()).toBe(false);
    t.tapBox();
    t.run(120);
    expect(t.free()).toBe(true);
    expect(t.hd()).toBeNull();
    expect(t.messages.filter((m) => m.startsWith("Come visit me"))).toHaveLength(1);
    expect(t.messages.some((m) => m.includes("ATTACK"))).toBe(true);
  });
});
