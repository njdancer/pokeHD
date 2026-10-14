// ROM test for a fifth move (QA bugs 47, 48): a TM or a Rare Candy on a Pokémon that knows four
// moves. From the Pokédex menu (GameActions) the action answers LearnMove itself, no to "Delete an
// older move…?" and yes to "Abandon learning…?", and always ends, asking the page nothing. When
// the game teaches outside the menu's actions (a level up in battle), LearnMove's questions
// ("Delete…?", the move to forget, "Abandon…?") come to the page as GameAsks, each once.
// Skips without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { SYMBOLS, type SymbolName } from "@pokehd/rom";
import { beforeAll, describe, expect, it } from "vitest";
import { Button, GameBoy } from "../core.ts";
import { SafePoint } from "../gifts/safepoint.ts";
import { playIntro, setBag, setParty } from "../testing.ts";
import { GameActions, type ActionResult } from "./actions.ts";
import { GameAsks, type AskAnswer, type GameAsk } from "./asks.ts";

const ROM_PATH = new URL("../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../generated/sameboy.wasm", import.meta.url);

const CHARMANDER = 0xb0;
const PIDGEY = 0x24;
const TM01 = 0xc9;
const RARE_CANDY = 0x28;
const POTION = 0x14;
const MEGA_PUNCH = 0x05;
const SCRATCH = 0x0a;
const GROWL = 0x2d;
const LEER = 0x2b;
const TACKLE = 0x21;
const EMBER = 0x34;
const CUT = 0x0f;
const PARTYMON = 44;

const addr = (name: SymbolName) => SYMBOLS[name].address;
const moves = (gb: GameBoy, slot = 0) => [...gb.readBytes(addr("wPartyMons") + slot * PARTYMON + 8, 4)];
const bag = (gb: GameBoy) => Array.from({ length: gb.read(addr("wNumBagItems")) }, (_, i) => gb.read(addr("wNumBagItems") + 1 + i * 2));
const frames = (gb: GameBoy, n: number) => {
  for (let i = 0; i < n; i++) gb.runFrame();
};

describe.skipIf(!existsSync(ROM_PATH))("learning a fifth move (ROM)", () => {
  let rom: Uint8Array;
  let start: Uint8Array;
  beforeAll(async () => {
    rom = new Uint8Array(readFileSync(ROM_PATH));
    const gb = await GameBoy.create({ rom, wasmBinary: new Uint8Array(readFileSync(WASM_PATH)) });
    playIntro(gb);
    start = gb.saveState();
  }, 120_000);

  /** A Charmander at `level` knowing `known`, with GameActions and GameAsks wired as the worker does. */
  async function game(level: number, known: number[]) {
    const gb = await GameBoy.create({ rom, wasmBinary: new Uint8Array(readFileSync(WASM_PATH)) });
    gb.loadState(start);
    setParty(gb, rom, [
      { species: CHARMANDER, level },
      { species: PIDGEY, level: 8 },
    ]);
    known.forEach((m, i) => gb.write(addr("wPartyMons") + 8 + i, m));
    [20, 20, 20, 20].forEach((pp, i) => gb.write(addr("wPartyMons") + 29 + i, pp));
    setBag(gb, [[POTION, 1], [TM01, 1], [RARE_CANDY, 1]]);
    const actions = new GameActions(gb, { rom });
    const asked: { id: number; ask: GameAsk }[] = [];
    const asks = new GameAsks(gb, { rom, busy: () => actions.pending > 0 && SafePoint.of(gb).calling, onAsk: (id, ask) => asked.push({ id, ask }) });
    return { gb, actions, asks, asked };
  }

  /** The menu's action, run to its end: it must end by itself, asking the page nothing. */
  function act(g: Awaited<ReturnType<typeof game>>, item: number, answers?: boolean[]) {
    let result: ActionResult | undefined;
    g.actions.run({ kind: "use-item", item, mon: 0, ...(answers ? { answers } : {}) }, (res) => (result = res));
    for (let i = 0; i < 3000 && !result; i++) g.gb.runFrame();
    expect(result).toBeDefined();
    expect(g.asked).toEqual([]);
    expect(g.actions.pending).toBe(0);
    return result!;
  }

  it("from the menu, a TM on a Pokémon with four moves ends with \"did not learn\" and keeps the TM", async () => {
    const g = await game(12, [SCRATCH, GROWL, EMBER, LEER]);
    const result = act(g, TM01, [true]);
    expect(result.messages.join(" ")).toMatch(/did not learn/);
    expect(moves(g.gb)).toEqual([SCRATCH, GROWL, EMBER, LEER]);
    expect(bag(g.gb)).toContain(TM01);
    // And the player walks on: nothing is left queued or waiting (QA bug 48's trap).
    frames(g.gb, 30);
    const at = [g.gb.read(addr("wXCoord")), g.gb.read(addr("wYCoord"))];
    for (const b of [Button.Left, Button.Right, Button.Down, Button.Up]) {
      g.gb.setButtons(b);
      frames(g.gb, 20);
      g.gb.setButtons(0);
      frames(g.gb, 20);
    }
    expect(g.asked).toEqual([]);
    expect(g.asks.asking).toBeNull();
    void at;
  }, 60_000);

  it("from the menu, a Rare Candy levels up and skips the move it has no room for", async () => {
    // Charmander learns EMBER at level 9.
    const g = await game(8, [SCRATCH, GROWL, LEER, TACKLE]);
    act(g, RARE_CANDY);
    expect(g.gb.read(addr("wPartyMons") + 33)).toBe(9);
    expect(moves(g.gb)).toEqual([SCRATCH, GROWL, LEER, TACKLE]);
  }, 60_000);

  it("from the menu, a TM on a Pokémon with room teaches it", async () => {
    const g = await game(12, [SCRATCH, GROWL, EMBER, 0]);
    expect(act(g, TM01, [true]).ok).toBe(true);
    expect(moves(g.gb)).toEqual([SCRATCH, GROWL, EMBER, MEGA_PUNCH]);
    expect(bag(g.gb)).not.toContain(TM01);
  }, 60_000);

  /**
   * The game's own UseItem outside the menu's actions (as LearnMove runs at a level up in battle):
   * every question goes to the page. A is pressed for the message waits in between.
   */
  async function teachByGame(known: number[], answers: (ask: GameAsk) => AskAnswer) {
    const g = await game(12, known);
    const { gb, asks, asked } = g;
    let done = false;
    SafePoint.of(gb).enqueue({
      scratch: [],
      steps: [
        { routine: "Bankswitch", before: (b) => b.write(addr("hTextID"), 1), registers: () => ({ bc: SYMBOLS.DisplayTextIDInit.bank << 8, hl: SYMBOLS.DisplayTextIDInit.address }) },
        {
          routine: "UseItem",
          before: (b) => {
            b.write(addr("wCurItem"), TM01);
            b.write(addr("wWhichPokemon"), 1);
            b.write(addr("wPseudoItemID"), 0);
          },
        },
        { routine: "CloseTextDisplay", push: (b) => [b.read(addr("hLoadedROMBank")) << 8] },
      ],
      done: () => (done = true),
    });
    let answered = 0;
    for (let i = 0; i < 6000 && !done; i++) {
      if (asked.length > answered) {
        const { id, ask } = asked[answered++]!;
        asks.answer(id, answers(ask));
      }
      gb.setButtons(!asks.asking && i % 8 < 2 ? Button.A : 0);
      gb.runFrame();
    }
    gb.setButtons(0);
    expect(done).toBe(true);
    return { gb, asked: asked.map((a) => a.ask) };
  }

  it("outside the menu's actions, asks to delete, which move, and teaches it in its place", async () => {
    const { gb, asked } = await teachByGame([SCRATCH, GROWL, EMBER, LEER], (ask) =>
      ask.kind === "party" ? { index: 0 } : ask.kind === "forget-move" ? { index: 1 } : { yes: true },
    );
    expect(asked.map((a) => a.kind)).toEqual(["yes-no", "party", "yes-no", "forget-move"]);
    expect(asked[2]).toMatchObject({ kind: "yes-no", text: expect.stringMatching(/Delete an older\s+move/) });
    expect(asked[3]).toMatchObject({ kind: "forget-move", mon: "CHARMANDER", move: MEGA_PUNCH, moves: [SCRATCH, GROWL, EMBER, LEER], hm: [false, false, false, false] });
    expect(moves(gb)).toEqual([SCRATCH, MEGA_PUNCH, EMBER, LEER]);
  }, 60_000);

  it("outside the menu's actions, cancelling the list asks to abandon, with HMs locked", async () => {
    const { gb, asked } = await teachByGame([CUT, GROWL, EMBER, LEER], (ask) =>
      ask.kind === "party" ? { index: 0 } : ask.kind === "forget-move" ? null : { yes: true },
    );
    expect(asked.map((a) => a.kind)).toEqual(["yes-no", "party", "yes-no", "forget-move", "yes-no"]);
    expect(asked[3]).toMatchObject({ hm: [true, false, false, false] });
    expect(asked[4]).toMatchObject({ kind: "yes-no", text: expect.stringMatching(/Abandon learning\s+MEGA PUNCH\?/) });
    expect(moves(gb)).toEqual([CUT, GROWL, EMBER, LEER]);
  }, 60_000);
});
