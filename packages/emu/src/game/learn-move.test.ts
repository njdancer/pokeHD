// ROM test for a fifth move (QA bugs 47, 48): a TM or a Rare Candy from the Pokédex menu on a
// Pokémon that knows four moves. The menu's action runs the game's UseItem, and LearnMove's
// questions ("Delete an older move…?", the move to forget, "Abandon learning…?") come to the page
// as GameAsks, each once, instead of being answered "no" by the action round and round.
// Skips without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { SYMBOLS, type SymbolName } from "@pokehd/rom";
import { beforeAll, describe, expect, it } from "vitest";
import { GameBoy } from "../core.ts";
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

const addr = (name: SymbolName) => SYMBOLS[name].address;
const moves = (gb: GameBoy, slot = 0) => [...gb.readBytes(addr("wPartyMons") + slot * PARTYMON + 8, 4)];
const bag = (gb: GameBoy) => Array.from({ length: gb.read(addr("wNumBagItems")) }, (_, i) => gb.read(addr("wNumBagItems") + 1 + i * 2));

describe.skipIf(!existsSync(ROM_PATH))("learning a fifth move from the menu (ROM)", () => {
  let rom: Uint8Array;
  let start: Uint8Array;
  beforeAll(async () => {
    rom = new Uint8Array(readFileSync(ROM_PATH));
    const gb = await GameBoy.create({ rom, wasmBinary: new Uint8Array(readFileSync(WASM_PATH)) });
    playIntro(gb);
    start = gb.saveState();
  }, 120_000);

  /** A Charmander at `level` knowing `known`, the worker's GameActions and GameAsks wired the same way. */
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
    /** Runs until the game asks the page something (or the action ends); the window stays the action's. */
    const next = (): GameAsk | null => {
      const before = asked.length;
      for (let i = 0; i < 3000 && asked.length === before && !result; i++) {
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
      return result!;
    };
    return { gb, run, next, answer, finish, asked };
  }

  it("asks to delete a move, which one, and teaches MEGA PUNCH in its place", async () => {
    const { gb, run, next, answer, finish } = await game(12, [SCRATCH, GROWL, EMBER, LEER]);
    run({ kind: "use-item", item: TM01, mon: 0, answers: [true] });
    const del = next();
    expect(del?.kind).toBe("yes-no");
    if (del?.kind !== "yes-no") return;
    // The player saw none of the action's words: the question carries all of the message.
    expect(del.text).toMatch(/CHARMANDER is\s+trying to learn\s+MEGA PUNCH!/);
    expect(del.text).toMatch(/Delete an older\s+move/);
    answer({ yes: true });
    const which = next();
    expect(which).toMatchObject({ kind: "forget-move", mon: "CHARMANDER", move: MEGA_PUNCH, moves: [SCRATCH, GROWL, EMBER, LEER], hm: [false, false, false, false] });
    answer({ index: 1 });
    const result = finish();
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.messages.join(" ")).toMatch(/forgot\s+GROWL/);
    expect(result.messages.join(" ")).toMatch(/learned\s+MEGA PUNCH/);
    expect(moves(gb)).toEqual([SCRATCH, MEGA_PUNCH, EMBER, LEER]);
    expect(bag(gb)).not.toContain(TM01);
  }, 60_000);

  it("asks to abandon learning after a no, and keeps the TM on a yes", async () => {
    const { gb, run, next, answer, finish } = await game(12, [SCRATCH, GROWL, EMBER, LEER]);
    run({ kind: "use-item", item: TM01, mon: 0, answers: [true] });
    expect(next()?.kind).toBe("yes-no");
    answer({ yes: false });
    const abandon = next();
    expect(abandon).toMatchObject({ kind: "yes-no" });
    expect(abandon?.kind === "yes-no" && abandon.text).toMatch(/Abandon learning\s+MEGA PUNCH\?/);
    answer({ yes: true });
    const result = finish();
    expect(result.messages.join(" ")).toMatch(/did not learn/);
    expect(moves(gb)).toEqual([SCRATCH, GROWL, EMBER, LEER]);
    expect(bag(gb)).toContain(TM01);
  }, 60_000);

  it("goes back to the delete question after cancelling the list and not abandoning", async () => {
    const { gb, run, next, answer, finish } = await game(12, [CUT, GROWL, EMBER, LEER]);
    run({ kind: "use-item", item: TM01, mon: 0, answers: [true] });
    expect(next()?.kind).toBe("yes-no");
    answer({ yes: true });
    const which = next();
    // CUT is an HM: the game won't delete it, and the page is told so.
    expect(which).toMatchObject({ kind: "forget-move", hm: [true, false, false, false] });
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

  it("asks the same at a level up from a Rare Candy", async () => {
    // Charmander learns EMBER at level 9.
    const { gb, run, next, answer, finish } = await game(8, [SCRATCH, GROWL, LEER, TACKLE]);
    run({ kind: "use-item", item: RARE_CANDY, mon: 0 });
    const del = next();
    expect(del?.kind === "yes-no" && del.text).toMatch(/trying to learn\s+EMBER!/);
    answer({ yes: true });
    expect(next()).toMatchObject({ kind: "forget-move", move: EMBER, moves: [SCRATCH, GROWL, LEER, TACKLE] });
    answer({ index: 3 });
    expect(finish().ok).toBe(true);
    expect(moves(gb)).toEqual([SCRATCH, GROWL, LEER, EMBER]);
    expect(gb.read(addr("wPartyMons") + 33)).toBe(9);
  }, 60_000);
});
