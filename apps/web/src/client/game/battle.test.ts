import { describe, expect, it } from "vitest";
import { CELL_HUD, CELL_SCENE, CELL_UI, TEXT_WATCHES, type BattleScreen, type ScreenText, type TextWatched } from "@pokehd/emu";
import { barColour, BattleMenuCover, battleCovered, battleMenuShown, battleText, battleTextShown, maskBattleScreen } from "./battle.ts";

describe("maskBattleScreen", () => {
  const screen = (origin = { x: 0, y: 0 }): BattleScreen => {
    const cells = new Uint8Array(360).fill(CELL_SCENE);
    cells.fill(CELL_UI, 12 * 20); // the text box
    return {
      battle: true, enemy: null, player: null, objects: [], cells, huds: { enemy: false, player: false },
      palettes: [0xe4, 0xe4, 0xe4], origin,
    };
  };
  const alpha = (data: Uint8ClampedArray, x: number, y: number) => data[(y * 160 + x) * 4 + 3];

  it("keeps only text and menu cells", () => {
    const data = new Uint8ClampedArray(160 * 144 * 4).fill(255);
    maskBattleScreen(data, screen());
    expect(alpha(data, 10, 10)).toBe(0);
    expect(alpha(data, 10, 12 * 8)).toBe(255);
  });

  it("clears the boxes the HD text layer draws", () => {
    const data = new Uint8ClampedArray(160 * 144 * 4).fill(255);
    maskBattleScreen(data, screen(), [{ x: 0, y: 12, width: 20, height: 6, lines: [] }]);
    expect(alpha(data, 10, 12 * 8)).toBe(0);
    expect(alpha(data, 159, 143)).toBe(0);
  });

  it("shows nothing of the game's menu or the message box under it while the HD menu asks (QA bug 41)", () => {
    // FIGHT / PKMN / ITEM / RUN drawn over the message box's right side: the menu is the only
    // box the decoder finds, and the message box's left eight columns are left over.
    const menu = { x: 8, y: 12, width: 12, height: 6, lines: [] };
    const text = { shown: true, boxes: [menu], dialog: null, menus: [], quantity: null, loose: [], pictures: false } as unknown as ScreenText;
    const data = new Uint8ClampedArray(160 * 144 * 4).fill(255);
    maskBattleScreen(data, screen(), battleCovered(text, false, true));
    for (let y = 0; y < 144; y++) for (let x = 0; x < 160; x++) expect(alpha(data, x, y)).toBe(0);
    // A message the HD text layer draws: its boxes go; nothing else is asked.
    expect(battleCovered(text, true, false)).toEqual([menu]);
    expect(battleCovered(text, false, false)).toEqual([]);
  });

  it("moves the mask with the screen when the game shakes it", () => {
    const data = new Uint8ClampedArray(160 * 144 * 4).fill(255);
    maskBattleScreen(data, screen({ x: 0, y: 4 }));
    expect(alpha(data, 10, 12 * 8 + 2)).toBe(0);
    expect(alpha(data, 10, 12 * 8 + 4)).toBe(255);
  });
});

describe("battleText", () => {
  it("reads only the text and menu cells, as on screen", () => {
    const watched = Object.fromEntries(Object.entries(TEXT_WATCHES).map(([k, [, n]]) => [k, new Uint8Array(n)])) as TextWatched;
    watched.tileMap.fill(0x80); // "A" everywhere
    watched.windowY[0] = 144;
    const cells = new Uint8Array(360).fill(CELL_SCENE);
    cells.fill(CELL_HUD, 0, 12);
    cells.fill(CELL_UI, 12 * 20);
    const screen: BattleScreen = {
      battle: true, enemy: null, player: null, objects: [], cells, huds: { enemy: true, player: false },
      palettes: [0xe4, 0xe4, 0xe4], origin: { x: 0, y: 0 },
    };
    const text = battleText(watched, screen);
    expect(text.tileMap[5]).toBe(0x7f); // a HUD's name
    expect(text.tileMap[100]).toBe(0x7f); // the scene
    expect(text.tileMap[12 * 20 + 3]).toBe(0x80);
    expect(text.windowY[0]).toBe(0);
    expect(watched.tileMap[5]).toBe(0x80);
  });
});

describe("barColour", () => {
  it("turns yellow and red where the game's bar does", () => {
    expect(barColour(20, 20)).toBe("green");
    expect(barColour(11, 20)).toBe("yellow"); // 26 of 48 pixels
    expect(barColour(4, 20)).toBe("red"); // 9 pixels
    expect(barColour(0, 0)).toBe("red");
  });
});

describe("battleMenuShown", () => {
  const text = (over: Partial<ScreenText>): ScreenText => ({
    shown: true, boxes: [], dialog: null, menus: [], quantity: null, loose: [], pictures: false, ...over,
  } as ScreenText);
  const box = (x: number, y: number, width: number, height: number, lines: { row: number; col: number; text: string }[] = []) => ({ x, y, width, height, lines });

  it("sees the battle menu, the Safari Zone's and the move lists", () => {
    const fight = box(8, 12, 12, 6);
    expect(battleMenuShown(text({ boxes: [fight], menus: [{ kind: "battle", box: fight, items: [], cursor: 0, active: true }] }))).toBe(true);
    expect(battleMenuShown(text({ boxes: [box(0, 12, 20, 6, [{ row: 16, col: 1, text: "THROW ROCK  RUN" }])] }))).toBe(true);
    expect(battleMenuShown(text({ boxes: [box(4, 12, 16, 6)] }))).toBe(true);
    expect(battleMenuShown(text({ boxes: [box(0, 7, 16, 6)] }))).toBe(true);
  });

  it("leaves messages and other menus alone", () => {
    expect(battleMenuShown(text({ boxes: [box(0, 12, 20, 6, [{ row: 14, col: 1, text: "Wild PIDGEY" }])] }))).toBe(false);
    expect(battleMenuShown(text({ boxes: [box(4, 2, 16, 11)] }))).toBe(false);
  });

  // The turn's move list as the game draws it: its box's corner drawn over, so its moves are
  // loose text, with the TYPE box beside it (QA bug 46).
  const typeBox = (height: number) => box(0, 8, 11, height, [{ row: 9, col: 1, text: "TYPE/" }, { row: 10, col: 2, text: "NORMAL" }, { row: 11, col: 6, text: "0/35" }]);
  const moves = [{ row: 13, col: 6, text: "TACKLE" }, { row: 14, col: 6, text: "TAIL WHIP" }];
  const noPp = box(0, 12, 20, 6, [{ row: 14, col: 1, text: "No PP left for" }, { row: 16, col: 1, text: "this move!" }]);
  const noPpDialog = { box: noPp, lines: ["No PP left for", "this move!"], state: "waiting" } as ScreenText["dialog"];

  it("sees the turn's move list while the game draws it", () => {
    expect(battleMenuShown(text({ loose: moves }))).toBe(true);
    expect(battleMenuShown(text({ boxes: [typeBox(5)], loose: moves }))).toBe(true);
    expect(battleMenuShown(text({ boxes: [box(0, 8, 11, 5, [{ row: 10, col: 1, text: "disabled!" }])] }))).toBe(true);
  });

  it("lets the game's message under the TYPE box through", () => {
    expect(battleMenuShown(text({ boxes: [typeBox(10), noPp], dialog: noPpDialog }))).toBe(false);
  });
});

describe("battleTextShown", () => {
  const box = (x: number, y: number, width: number, height: number, lines: { row: number; col: number; text: string }[]) => ({ x, y, width, height, lines });
  it("drops the TYPE box from the HD text, and battleCovered still masks it", () => {
    const type = box(0, 8, 11, 10, [{ row: 9, col: 1, text: "TYPE/" }]);
    const message = box(0, 12, 20, 6, [{ row: 14, col: 1, text: "No PP left for" }]);
    const onScreen = { shown: true, boxes: [type, message], dialog: null, menus: [], quantity: null, loose: [], pictures: false } as unknown as ScreenText;
    expect(battleTextShown(onScreen).boxes).toEqual([message]);
    expect(battleCovered(onScreen, true, false)).toEqual([type, message]);
    const other = { ...onScreen, boxes: [message] };
    expect(battleTextShown(other)).toBe(other);
  });
});

describe("BattleMenuCover", () => {
  const text = (over: Partial<ScreenText> = {}): ScreenText => ({
    shown: true, boxes: [], dialog: null, menus: [], quantity: null, loose: [], pictures: false, ...over,
  } as ScreenText);
  const message = (lines: string[]) => text({ dialog: { box: { x: 0, y: 12, width: 20, height: 6, lines: [] }, lines, state: "printing" } as unknown as ScreenText["dialog"] });

  it("covers while asked, and from an answer to the next question whenever there's nothing to read (QA bug 51)", () => {
    const cover = new BattleMenuCover();
    expect(cover.covering(text(), false)).toBe(false);
    expect(cover.covering(text(), true)).toBe(true);
    cover.answered();
    // The game clears the menu's area: a blank box, nothing to read.
    expect(cover.covering(text(), false)).toBe(true);
    expect(cover.covering(message(["", ""]), false)).toBe(true);
    // "No PP left for this move!" shows…
    expect(cover.covering(message(["No PP left for", "this move!"]), false)).toBe(false);
    // …and the screen the game puts back after it, before its move list, doesn't.
    expect(cover.covering(text(), false)).toBe(true);
    // The next question ends it.
    expect(cover.covering(text(), true)).toBe(true);
    expect(cover.covering(text(), false)).toBe(false);
  });

  it("lets go off the battle screen, and in the end", () => {
    const cover = new BattleMenuCover();
    cover.answered();
    expect(cover.covering(null, false)).toBe(false);
    expect(cover.covering(text(), false)).toBe(false);
    cover.answered();
    let frames = 0;
    while (cover.covering(text(), false)) frames++;
    expect(frames).toBe(120);
  });

  it("sees the battle menu before its cursor is up (the question still on its way to the page)", () => {
    const fight = { x: 8, y: 12, width: 12, height: 6, lines: [{ row: 14, col: 10, text: "FIGHT PKMN" }, { row: 16, col: 10, text: "ITEM  RUN" }] };
    expect(battleMenuShown(text({ boxes: [fight] }))).toBe(true);
    expect(new BattleMenuCover().covering(text({ boxes: [fight] }), false)).toBe(true);
  });
});
