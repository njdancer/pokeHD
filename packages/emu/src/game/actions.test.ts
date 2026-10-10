// ROM test for the Pokédex menu's game actions: each runs the game's own routine at the idle
// point with no button pressed, and the game carries on walking afterwards. Skips without the
// dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { encodeText, decodeText, monName, pokedexNumber, romOffset, SYMBOLS, type SymbolName } from "@pokehd/rom";
import { beforeAll, describe, expect, it } from "vitest";
import { Button, GameBoy } from "../core.ts";
import { playIntro } from "../testing.ts";
import { GameActions, itemUse, type ActionResult, type GameAction } from "./actions.ts";
import { decodeSnapshot, SNAPSHOT_RANGES } from "./snapshot.ts";

const ROM_PATH = new URL("../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../generated/sameboy.wasm", import.meta.url);

const PIKACHU = 0x54;
const PIDGEY = 0x24;
const SQUIRTLE = 0xb1;
const POTION = 0x14;
const ANTIDOTE = 0x0b;
const REPEL = 0x1e;
const BICYCLE = 0x06;
const PARTYMON = 44;

const addr = (name: SymbolName) => SYMBOLS[name].address;
const r = (gb: GameBoy, name: SymbolName, offset = 0) => gb.read(addr(name) + offset);
const hp = (gb: GameBoy, slot: number) => (r(gb, "wPartyMons", slot * PARTYMON + 1) << 8) | r(gb, "wPartyMons", slot * PARTYMON + 2);
const maxHp = (gb: GameBoy, slot: number) => (r(gb, "wPartyMons", slot * PARTYMON + 34) << 8) | r(gb, "wPartyMons", slot * PARTYMON + 35);
const species = (gb: GameBoy) => [...gb.readBytes(addr("wPartySpecies"), r(gb, "wPartyCount"))];
const bag = (gb: GameBoy) => Array.from({ length: r(gb, "wNumBagItems") }, (_, i) => [r(gb, "wNumBagItems", 1 + i * 2), r(gb, "wNumBagItems", 2 + i * 2)]);
const frames = (gb: GameBoy, n: number) => {
  for (let i = 0; i < n; i++) gb.runFrame();
};

/** A party of level-`level` Pokémon with the ROM's base stats and starting moves (enough for these tests). */
function setParty(gb: GameBoy, rom: Uint8Array, mons: { species: number; level: number }[]) {
  gb.write(addr("wPartyCount"), mons.length);
  mons.forEach(({ species: sp, level }, n) => {
    const base = romOffset(SYMBOLS.BaseStats) + (pokedexNumber(rom, sp) - 1) * 28;
    const hpMax = Math.floor((rom[base + 1]! * 2 * level) / 100) + level + 10;
    const s = new Uint8Array(PARTYMON);
    s.set([sp, hpMax >> 8, hpMax & 255, level, 0, rom[base + 6]!, rom[base + 7]!, 0]);
    s.set(rom.subarray(base + 15, base + 19), 8);
    s.set([20, 20, 20, 20].map((pp, i) => (s[8 + i] ? pp + i : 0)), 29);
    s.set([level, hpMax >> 8, hpMax & 255], 33);
    gb.write(addr("wPartySpecies") + n, sp);
    s.forEach((v, k) => gb.write(addr("wPartyMons") + n * PARTYMON + k, v));
    encodeText("RED").forEach((v, k) => gb.write(addr("wPartyMonOT") + n * 11 + k, v));
    encodeText(monName(rom, sp)).forEach((v, k) => gb.write(addr("wPartyMonNicks") + n * 11 + k, v));
  });
  gb.write(addr("wPartySpecies") + mons.length, 0xff);
}

function setBag(gb: GameBoy, items: [number, number][]) {
  gb.write(addr("wNumBagItems"), items.length);
  items.flat().forEach((v, i) => gb.write(addr("wNumBagItems") + 1 + i, v));
  gb.write(addr("wNumBagItems") + 1 + items.length * 2, 0xff);
}

describe.skipIf(!existsSync(ROM_PATH))("game actions (ROM)", () => {
  let rom: Uint8Array;
  let start: Uint8Array;
  beforeAll(async () => {
    rom = new Uint8Array(readFileSync(ROM_PATH));
    const gb = await GameBoy.create({ rom, wasmBinary: new Uint8Array(readFileSync(WASM_PATH)) });
    playIntro(gb);
    start = gb.saveState();
  }, 120_000);

  async function game() {
    const gb = await GameBoy.create({ rom, wasmBinary: new Uint8Array(readFileSync(WASM_PATH)) });
    gb.loadState(start);
    setParty(gb, rom, [
      { species: SQUIRTLE, level: 12 },
      { species: PIKACHU, level: 10 },
      { species: PIDGEY, level: 8 },
    ]);
    setBag(gb, [[ANTIDOTE, 1], [POTION, 3], [REPEL, 2], [BICYCLE, 1]]);
    const actions = new GameActions(gb, { rom });
    const run = (action: GameAction) => {
      let result: ActionResult | undefined;
      actions.run(action, (res) => (result = res));
      for (let i = 0; i < 1200 && !result; i++) gb.runFrame();
      expect(result, JSON.stringify(action)).toBeDefined();
      return result!;
    };
    return { gb, run };
  }

  /** Back in the overworld loop, taking the player's steps. */
  function walksAfter(gb: GameBoy) {
    frames(gb, 30);
    // The text window is off the screen again, as after any message.
    expect(gb.read(0xffb0)).toBe(0x90);
    const seen: string[] = [];
    for (const b of [Button.Left, Button.Right, Button.Down, Button.Up]) {
      gb.setButtons(b);
      frames(gb, 20);
      gb.setButtons(0);
      frames(gb, 20);
      seen.push(`${r(gb, "wXCoord")},${r(gb, "wYCoord")}`);
    }
    expect(new Set(seen).size).toBeGreaterThan(1);
  }

  it("knows which items go on a Pokémon from the game's own list", () => {
    expect(itemUse(rom, POTION).onMon).toBe(true);
    expect(itemUse(rom, REPEL).onMon).toBe(false);
  });

  it("uses a Potion on the chosen Pokémon through UseItem", async () => {
    const { gb, run } = await game();
    const slot = 1;
    const base = addr("wPartyMons") + slot * PARTYMON;
    gb.write(base + 1, 0);
    gb.write(base + 2, 5);
    const result = run({ kind: "use-item", item: POTION, mon: slot });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(hp(gb, slot)).toBe(Math.min(25, maxHp(gb, slot)));
    expect(bag(gb)[1]).toEqual([POTION, 2]);
    expect(result.messages.join(" ")).toMatch(/recovered/i);
    walksAfter(gb);
  });

  it("says why when the Potion would do nothing, and keeps it", async () => {
    const { gb, run } = await game();
    const result = run({ kind: "use-item", item: POTION, mon: 0 });
    expect(result.ok).toBe(false);
    expect(bag(gb)[1]).toEqual([POTION, 3]);
    walksAfter(gb);
  });

  it("uses a Repel", async () => {
    const { gb, run } = await game();
    const result = run({ kind: "use-item", item: REPEL });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(r(gb, "wRepelRemainingSteps")).toBe(100);
    expect(bag(gb)[2]).toEqual([REPEL, 1]);
    walksAfter(gb);
  });

  it("refuses the bicycle indoors, as the game does", async () => {
    const { gb, run } = await game();
    const result = run({ kind: "use-item", item: BICYCLE });
    expect(result.ok).toBe(false);
    expect(r(gb, "wWalkBikeSurfState")).toBe(0);
    walksAfter(gb);
  });

  it("reorders the team with the party menu's own swap", async () => {
    const { gb, run } = await game();
    expect(run({ kind: "move-mon", from: 2, to: 0 }).ok).toBe(true);
    expect(species(gb)).toEqual([PIDGEY, SQUIRTLE, PIKACHU]);
    expect(r(gb, "wPartyMons")).toBe(PIDGEY);
    expect(decodeText(gb.readBytes(addr("wPartyMonNicks"), 11))).toBe("PIDGEY");
    walksAfter(gb);
  });

  it("reads the team and bag for the menu", async () => {
    const { gb } = await game();
    const snap = decodeSnapshot(SNAPSHOT_RANGES.map(([a, n]) => gb.readBytes(a, n)));
    expect(snap.team.map((m) => [m.species, m.nick, m.level])).toEqual([[SQUIRTLE, "SQUIRTLE", 12], [PIKACHU, "PIKACHU", 10], [PIDGEY, "PIDGEY", 8]]);
    expect(snap.team[0]!.hp).toBe(snap.team[0]!.maxHp);
    expect(snap.team[0]!.moves.length).toBeGreaterThan(0);
    expect(snap.bag).toEqual([{ item: ANTIDOTE, quantity: 1 }, { item: POTION, quantity: 3 }, { item: REPEL, quantity: 2 }, { item: BICYCLE, quantity: 1 }]);
    expect(snap.inBattle).toBe(false);
    expect(snap.player.length).toBeGreaterThan(0);
  });

  it("reorders moves with their PP", async () => {
    const { gb, run } = await game();
    const base = addr("wPartyMons");
    const before = [...gb.readBytes(base + 8, 2)];
    const pp = [...gb.readBytes(base + 29, 2)];
    expect(run({ kind: "move-move", mon: 0, from: 0, to: 1 }).ok).toBe(true);
    expect([...gb.readBytes(base + 8, 2)]).toEqual([before[1], before[0]]);
    expect([...gb.readBytes(base + 29, 2)]).toEqual([pp[1], pp[0]]);
  });

  it("reorders the bag and tosses", async () => {
    const { gb, run } = await game();
    expect(run({ kind: "move-item", from: 3, to: 0 }).ok).toBe(true);
    expect(bag(gb).map(([i]) => i)).toEqual([BICYCLE, ANTIDOTE, POTION, REPEL]);
    expect(run({ kind: "toss-item", item: POTION, quantity: 2 }).ok).toBe(true);
    expect(bag(gb)[2]).toEqual([POTION, 1]);
    expect(run({ kind: "toss-item", item: BICYCLE, quantity: 1 }).ok).toBe(false);
  });

  it("waits for a message to end", async () => {
    const { gb, run } = await game();
    // Talk to nothing: open a sign-like message by setting the joypad-ignore flag a script uses.
    gb.write(addr("wJoyIgnore"), 0xff);
    let result: ActionResult | undefined;
    const actions = new GameActions(gb, { rom });
    actions.run({ kind: "options", options: 0x41 }, (res) => (result = res));
    frames(gb, 60);
    expect(result).toBeUndefined();
    gb.write(addr("wJoyIgnore"), 0);
    frames(gb, 10);
    expect(result?.ok).toBe(true);
    expect(r(gb, "wOptions")).toBe(0x41);
    void run;
  });
});
