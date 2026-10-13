import { existsSync, readFileSync } from "node:fs";
import { readGlyphs, SYMBOLS, type Glyph } from "@pokehd/rom";
import { beforeAll, describe, expect, it } from "vitest";
import { Button, GameBoy } from "../core.ts";
import { playIntro } from "../testing.ts";
import { ScreenTextDecoder } from "./text-decode.ts";
import { SCREEN_COLS, TEXT_WATCHES, type ScreenText, type TextWatched } from "./text.ts";

const ROM_PATH = new URL("../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../generated/sameboy.wasm", import.meta.url);
const hasRom = existsSync(ROM_PATH);

describe("ScreenTextDecoder", () => {
  // Made-up glyphs: tile `code` holds a pattern unique to it, and the screen buffer is drawn in
  // the same codes, so tests can write screens as strings.
  const CHARS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789×▶▷▼┌─┐│└┘"];
  const codeOf = (char: string) => 0x80 + CHARS.indexOf(char);
  const tileFor = (code: number) => new Uint8Array(16).fill(code);
  const glyphs: Glyph[] = CHARS.map((char) => ({ code: codeOf(char), char, tile: tileFor(codeOf(char)) }));

  function screen(rows: string[], extra: Partial<TextWatched> = {}): TextWatched {
    const watched = {} as TextWatched;
    for (const [name, [, length]] of Object.entries(TEXT_WATCHES)) {
      watched[name as keyof TextWatched] = new Uint8Array(length);
    }
    for (let code = 0x80; code < 0x100; code++) watched.tiles80.set(tileFor(code), (code - 0x80) * 16);
    watched.windowY[0] = 0;
    watched.options[0] = 3;
    rows.forEach((row, y) =>
      [...row.padEnd(SCREEN_COLS)].forEach((ch, x) => {
        // Spaces are blank tiles: $60 has an all-zero tile here.
        watched.tileMap[y * SCREEN_COLS + x] = ch === " " ? 0x60 : ch === "." ? 0x01 : codeOf(ch);
      }),
    );
    return Object.assign(watched, extra);
  }

  it("shows nothing while the screen buffer isn't on screen", () => {
    const decoder = new ScreenTextDecoder(glyphs);
    const text = decoder.decode(screen(["┌─┐", "│A│", "└─┘"], { windowY: new Uint8Array([144]) }));
    expect(text).toMatchObject({ shown: false, boxes: [] });
  });

  it("reads a menu partly drawn over by another box", () => {
    const decoder = new ScreenTextDecoder(glyphs);
    const text = decoder.decode(
      screen([
        "....┌──────────┐",
        "....│ POTION   │",
        "....│      × 3 │",
        "....│▷BALL     │",
        "....│      ┌───┐",
        "....│ CANCE│×01│",
        "....└──────└───┘",
      ]),
    );
    expect(text.boxes.map((b) => [b.x, b.y, b.width, b.height])).toEqual([
      [4, 0, 12, 7],
      [11, 4, 5, 3],
    ]);
    expect(text.menus).toHaveLength(1);
    expect(text.menus[0]).toMatchObject({
      active: false,
      cursor: 1,
      items: [{ text: "POTION", detail: "× 3" }, { text: "BALL" }, { text: "CANCE" }],
    });
    expect(text.quantity?.value).toBe(1);
  });

  it("keeps a menu whose bottom is under the message box", () => {
    const decoder = new ScreenTextDecoder(glyphs);
    const text = decoder.decode(
      screen([
        "",
        "",
        "....┌──────────────┐",
        "....│▷POTION       │",
        "....│        × 3   │",
        "....│ CANCEL       │",
        "....│              │",
        "....│              │",
        "....│              │",
        "....│              │",
        "....│              │",
        "....│              │",
        "┌──────────────────┐",
        "│                  │",
        "│HELLO             │",
        "│                  │",
        "│THERE            ▼│",
        "└──────────────────┘",
      ]),
    );
    expect(text.loose).toEqual([]);
    expect(text.boxes.map((b) => [b.x, b.y, b.width, b.height])).toEqual([
      [4, 2, 16, 16],
      [0, 12, 20, 6],
    ]);
    expect(text.menus[0]).toMatchObject({ kind: "list", active: false, items: [{ text: "POTION" }, { text: "CANCEL" }] });
    expect(text.dialog?.lines).toEqual(["HELLO", "THERE"]);
  });

  it("follows the message box from printing to waiting", () => {
    const decoder = new ScreenTextDecoder(glyphs);
    const box = (first: string, second: string, arrow = false) =>
      screen([
        ...Array<string>(12).fill(""),
        "┌──────────────────┐",
        "│                  │",
        `│${first.padEnd(18)}│`,
        "│                  │",
        `│${second.padEnd(17)}${arrow ? "▼" : " "}│`,
        "└──────────────────┘",
      ]);
    expect(decoder.decode(box("HE", "")).dialog).toMatchObject({ lines: ["HE", ""], state: "printing" });
    expect(decoder.decode(box("HELLO", "THERE", true)).dialog?.state).toBe("waiting");
    // The arrow blinks off, but the text still waits.
    for (let i = 0; i < 20; i++) expect(decoder.decode(box("HELLO", "THERE")).dialog?.state).toBe("waiting");
    decoder.decode(box("THERE", ""));
    for (let i = 0; i < 20; i++) decoder.decode(box("THERE", "A"));
    expect(decoder.decode(box("THERE", "A")).dialog?.state).toBe("idle");
  });

  it("reads lines that fill the box to its border, leaving out only the ▼", () => {
    const decoder = new ScreenTextDecoder(glyphs);
    const box = (first: string, second: string, arrow = false) =>
      screen([
        ...Array<string>(12).fill(""),
        "┌──────────────────┐",
        "│                  │",
        `│${first.padEnd(18)}│`,
        "│                  │",
        arrow ? `│${second.slice(0, 17).padEnd(17)}▼│` : `│${second.padEnd(18)}│`,
        "└──────────────────┘",
      ]);
    expect(decoder.decode(box("TOMAKEACOMPLETEXYZ", "GUIDEONALLTHE", true)).dialog?.lines).toEqual(["TOMAKEACOMPLETEXYZ", "GUIDEONALLTHE"]);
    expect(decoder.decode(box("A", "THATWASMYDREAMXYZW")).dialog?.lines).toEqual(["A", "THATWASMYDREAMXYZW"]);
    expect(decoder.decode(box("A", "THATWASMYDREAMXYZW", true)).dialog?.lines).toEqual(["A", "THATWASMYDREAMXYZ"]);
  });

  it("takes a ▼ under a menu still showing its ▶ as the game waiting at the text, not the menu", () => {
    const decoder = new ScreenTextDecoder(glyphs);
    // The PC's menu just chosen, and "Accessed my PC." waiting below it; the arrow blinks.
    const pc = (arrow: boolean, blink: number) =>
      screen(
        [
          "┌──────────┐",
          "│▶SOMEONE  │",
          "│          │",
          "│ LOG OFF  │",
          "└──────────┘",
          ...Array<string>(7).fill(""),
          "┌──────────────────┐",
          "│                  │",
          "│ACCESSED MY PC    │",
          "│                  │",
          `│${" ".repeat(17)}${arrow ? "▼" : " "}│`,
          "└──────────────────┘",
        ],
        { arrowBlink: new Uint8Array([blink, 6]) },
      );
    let text = decoder.decode(pc(true, 200));
    expect(text.dialog?.state).toBe("waiting");
    expect(text.menus[0]).toMatchObject({ cursor: 0, active: false });
    // Off between blinks: the counters still move while the game waits.
    for (let i = 0; i < 20; i++) {
      text = decoder.decode(pc(false, 199 - i));
      expect(text.dialog?.state).toBe("waiting");
      expect(text.menus[0]?.active).toBe(false);
    }
    // A, and the game takes the menu again: the counters stop and the arrow is gone.
    decoder.decode(pc(false, 7));
    text = decoder.decode(pc(false, 7));
    expect(text.menus[0]?.active).toBe(true);
    expect(text.dialog?.state).toBe("idle");
  });
});

describe.skipIf(!hasRom)("decoding the game's text", () => {
  let gb: GameBoy;
  let decoder: ScreenTextDecoder;
  let text: ScreenText;

  const frame = (buttons = 0) => {
    gb.setButtons(buttons);
    gb.runFrame();
    const watched = {} as TextWatched;
    for (const [name, [address, length]] of Object.entries(TEXT_WATCHES)) {
      watched[name as keyof TextWatched] = gb.readBytes(address, length);
    }
    text = decoder.decode(watched);
    return text;
  };
  /** Taps a button, then waits until the screen settles or `done` holds. */
  const press = (button: number, done: (t: ScreenText) => boolean = () => false) => {
    for (let i = 0; i < 4; i++) frame(button);
    for (let i = 0; i < 120 && !done(text); i++) frame();
    return text;
  };
  const items = (t: ScreenText) => t.menus[0]?.items.map((i) => i.text);
  const cursor = () => gb.readSymbol("wCurrentMenuItem");

  beforeAll(async () => {
    const rom = readFileSync(ROM_PATH);
    gb = await GameBoy.create({ rom, wasmBinary: readFileSync(WASM_PATH) });
    decoder = new ScreenTextDecoder(readGlyphs(rom));
  });

  it("reads the main menu and Oak's first words letter by letter", () => {
    const seen: ScreenText[] = [];
    for (let f = 0; f < 3000 && !(text?.dialog?.state === "waiting"); f++) {
      seen.push(frame(f > 600 && f % 16 < 2 ? Button.A : 0));
    }
    const menu = seen.find((t) => t.menus.length)!.menus[0]!;
    expect(menu).toMatchObject({ kind: "other", active: true, cursor: 0 });
    expect(menu.items.map((i) => i.text)).toEqual(["NEW GAME", "OPTION"]);

    const dialogs = seen.flatMap((t) => (t.dialog ? [t.dialog] : []));
    expect(dialogs.at(-1)).toMatchObject({ lines: ["Hello there!", "Welcome to the"], state: "waiting" });
    // Every printed frame is a prefix of the finished text, revealed in order.
    const printed = dialogs.filter((d) => d.state === "printing").map((d) => d.lines.join("\n"));
    expect(new Set(printed).size).toBeGreaterThan(20);
    for (const p of printed) expect("Hello there!\nWelcome to the".startsWith(p.replace(/\n$/, ""))).toBe(true);
  });

  it("reads the start menu and follows its cursor", () => {
    playIntro(gb);
    expect(frame().shown).toBe(false);
    press(Button.Start, (t) => t.menus.length > 0);
    expect(text.menus[0]).toMatchObject({ kind: "start", active: true, cursor: 0 });
    // No Pokédex yet; the player's name (mashed in by playIntro) is the fourth entry.
    expect(items(text)).toEqual(["POKéMON", "ITEM", expect.any(String), "SAVE", "OPTION", "EXIT"]);
    press(Button.Down);
    expect(text.menus[0]?.cursor).toBe(1);
    expect(cursor()).toBe(1);
  }, 60_000);

  it("reads the bag as a list with quantities", () => {
    // 3 Potions and 5 Poké Balls, written into the bag (wNumBagItems, then item/count pairs).
    [2, 0x14, 3, 0x04, 5, 0xff].forEach((v, i) => gb.write(SYMBOLS.wNumBagItems.address + i, v));
    press(Button.A, (t) => t.menus[0]?.kind === "list");
    expect(text.menus[0]).toMatchObject({
      kind: "list",
      listId: 3, // ITEMLISTMENU
      scroll: 0,
      cursor: 0,
      active: true,
      items: [
        { text: "POTION", detail: "× 3" },
        { text: "POKé BALL", detail: "× 5" },
        { text: "CANCEL" },
      ],
    });
    press(Button.Down);
    expect(text.menus[0]?.cursor).toBe(1);
    expect(cursor()).toBe(1);
  });

  it("reads the toss quantity and the yes/no prompt", () => {
    press(Button.A, (t) => t.menus[0]?.kind === "twoOption");
    expect(text.menus.map((m) => [m.kind, m.active])).toEqual([["twoOption", true], ["list", false]]);
    expect(items(text)).toEqual(["USE", "TOSS"]);
    press(Button.Down);
    press(Button.A, (t) => t.quantity !== null);
    expect(text.quantity?.value).toBe(1);
    press(Button.Up);
    expect(text.quantity?.value).toBe(2);

    press(Button.A, (t) => t.dialog?.state === "waiting");
    expect(text.dialog?.lines).toEqual(["Is it OK to toss", "POKé BALL?"]);
    press(Button.A, (t) => t.menus[0]?.kind === "yesNo");
    // The question stays up, finished, while the prompt takes input.
    expect(text.dialog).toMatchObject({ lines: ["Is it OK to toss", "POKé BALL?"], state: "idle" });
    expect(text.menus[0]).toMatchObject({ kind: "yesNo", active: true, cursor: 0 });
    expect(items(text)).toEqual(["YES", "NO"]);
    press(Button.Down);
    expect(text.menus[0]?.cursor).toBe(1);
    expect(cursor()).toBe(1);
  });
});
