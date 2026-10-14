// ROM test for a fifth move (QA bugs 47, 48): a TM or a Rare Candy on a Pokémon that knows four
// moves, from the Pokédex menu (GameActions) and from the game's own UseItem (as LearnMove runs at
// a level up in battle). LearnMove's questions ("Delete an older move…?", the move to forget,
// "Abandon learning…?") come to the page as GameAsks, each once, and promptly: the menu's action
// prints with no letter delay, since nobody sees it. Skips without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { SYMBOLS, type SymbolName } from "@pokehd/rom";
import { beforeAll, describe, expect, it } from "vitest";
import { Button, GameBoy } from "../core.ts";
import { SafePoint } from "../gifts/safepoint.ts";
import { playIntro, setBag, setParty } from "../testing.ts";
import { GameActions, type ActionResult, type GameAction } from "./actions.ts";
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
/** wStatusFlags5's BIT_NO_TEXT_DELAY. */
const NO_TEXT_DELAY = 1 << 6;
/** The menu's question comes up within this many frames of the action starting (QA bug 47). */
const PROMPT_FRAMES = 150;

const addr = (name: SymbolName) => SYMBOLS[name].address;
const moves = (gb: GameBoy, slot = 0) => [...gb.readBytes(addr("wPartyMons") + slot * PARTYMON + 8, 4)];
const bag = (gb: GameBoy) => Array.from({ length: gb.read(addr("wNumBagItems")) }, (_, i) => gb.read(addr("wNumBagItems") + 1 + i * 2));

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
    let result: ActionResult | undefined;
    const run = (action: GameAction) => actions.run(action, (res) => (result = res));
    /** Runs until the game asks the page something (or the action ends). */
    const next = (limit = 3000): GameAsk | null => {
      const before = asked.length;
      for (let i = 0; i < limit && asked.length === before && !result; i++) {
        gb.runFrame();
        // Nothing the Game Boy draws shows while the action runs (QA bug 28): the page keeps
        // its screen down only while it says so.
        if (gb.read(0xffb0) < 0x90) expect(actions.running).toBe(true);
      }
      return asked.length > before ? asked.at(-1)!.ask : null;
    };
    const answer = (a: AskAnswer) => asks.answer(asked.at(-1)!.id, a);
    const finish = () => {
      for (let i = 0; i < 3000 && !result; i++) gb.runFrame();
      expect(result).toBeDefined();
      // The game's letter delay is back as it was.
      expect(gb.read(addr("wStatusFlags5")) & NO_TEXT_DELAY).toBe(0);
      return result!;
    };
    return { gb, run, next, answer, finish, asked, asks, actions };
  }

  it("from the menu, asks to delete a move at once, then which one, and teaches MEGA PUNCH in its place", async () => {
    const { gb, run, next, answer, finish } = await game(12, [SCRATCH, GROWL, EMBER, LEER]);
    run({ kind: "use-item", item: TM01, mon: 0, answers: [true] });
    const del = next(PROMPT_FRAMES);
    expect(del?.kind).toBe("yes-no");
    if (del?.kind !== "yes-no") return;
    // The player saw none of the action's words: the question carries all of the message.
    expect(del.text).toMatch(/CHARMANDER is\s+trying to learn\s+MEGA PUNCH!/);
    expect(del.text).toMatch(/Delete an older\s+move/);
    answer({ yes: true });
    const which = next(PROMPT_FRAMES);
    expect(which).toMatchObject({ kind: "forget-move", mon: "CHARMANDER", move: MEGA_PUNCH, moves: [SCRATCH, GROWL, EMBER, LEER], hm: [false, false, false, false] });
    answer({ index: 1 });
    const result = finish();
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.messages.join(" ")).toMatch(/forgot\s+GROWL/);
    expect(result.messages.join(" ")).toMatch(/learned\s+MEGA PUNCH/);
    expect(moves(gb)).toEqual([SCRATCH, MEGA_PUNCH, EMBER, LEER]);
    expect(bag(gb)).not.toContain(TM01);
  }, 60_000);

  it("from the menu, asks to abandon learning after a no, and keeps the TM on a yes, then lets the player walk", async () => {
    const g = await game(12, [SCRATCH, GROWL, EMBER, LEER]);
    const { gb, run, next, answer, finish, asked, asks, actions } = g;
    run({ kind: "use-item", item: TM01, mon: 0, answers: [true] });
    expect(next()?.kind).toBe("yes-no");
    answer({ yes: false });
    const abandon = next();
    expect(abandon?.kind === "yes-no" && abandon.text).toMatch(/Abandon learning\s+MEGA PUNCH\?/);
    answer({ yes: true });
    const result = finish();
    expect(result.messages.join(" ")).toMatch(/did not learn/);
    expect(moves(gb)).toEqual([SCRATCH, GROWL, EMBER, LEER]);
    expect(bag(gb)).toContain(TM01);
    // Nothing left queued or asking: walking asks nothing more (QA bug 48's trap).
    const count = asked.length;
    for (const b of [Button.Left, Button.Right, Button.Down, Button.Up]) {
      gb.setButtons(b);
      for (let i = 0; i < 20; i++) gb.runFrame();
      gb.setButtons(0);
      for (let i = 0; i < 20; i++) gb.runFrame();
    }
    expect(asked.length).toBe(count);
    expect(asks.asking).toBeNull();
    expect(actions.pending).toBe(0);
  }, 60_000);

  it("from the menu, goes back to the delete question after cancelling the list and not abandoning", async () => {
    const { gb, run, next, answer, finish } = await game(12, [CUT, GROWL, EMBER, LEER]);
    run({ kind: "use-item", item: TM01, mon: 0, answers: [true] });
    expect(next()?.kind).toBe("yes-no");
    answer({ yes: true });
    // CUT is an HM: the game won't delete it, and the page is told so.
    expect(next()).toMatchObject({ kind: "forget-move", hm: [true, false, false, false] });
    answer(null);
    expect(next()).toMatchObject({ kind: "yes-no", text: expect.stringMatching(/Abandon/) });
    answer({ yes: false });
    expect(next()).toMatchObject({ kind: "yes-no", text: expect.stringMatching(/Delete an older\s+move/) });
    answer({ yes: true });
    expect(next()?.kind).toBe("forget-move");
    answer({ index: 3 });
    expect(finish().ok).toBe(true);
    expect(moves(gb)).toEqual([CUT, GROWL, EMBER, MEGA_PUNCH]);
  }, 60_000);

  it("from the menu, asks the same at a level up from a Rare Candy", async () => {
    // Charmander learns EMBER at level 9.
    const { gb, run, next, answer, finish } = await game(8, [SCRATCH, GROWL, LEER, TACKLE]);
    run({ kind: "use-item", item: RARE_CANDY, mon: 0 });
    const del = next(PROMPT_FRAMES * 2);
    expect(del?.kind === "yes-no" && del.text).toMatch(/trying to learn\s+EMBER!/);
    answer({ yes: true });
    expect(next()).toMatchObject({ kind: "forget-move", move: EMBER, moves: [SCRATCH, GROWL, LEER, TACKLE] });
    answer({ index: 3 });
    expect(finish().ok).toBe(true);
    expect(moves(gb)).toEqual([SCRATCH, GROWL, LEER, EMBER]);
    expect(gb.read(addr("wPartyMons") + 33)).toBe(9);
  }, 60_000);

  /**
   * The game's own UseItem outside the menu's actions (as LearnMove runs at a level up in battle):
   * every question goes to the page. A is pressed for the message waits in between.
   */
  async function teachByGame(known: number[], answers: (ask: GameAsk) => AskAnswer) {
    const { gb, asks, asked } = await game(12, known);
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
    expect(asked[3]).toMatchObject({ kind: "forget-move", mon: "CHARMANDER", move: MEGA_PUNCH, moves: [SCRATCH, GROWL, EMBER, LEER] });
    expect(moves(gb)).toEqual([SCRATCH, MEGA_PUNCH, EMBER, LEER]);
  }, 60_000);
});
