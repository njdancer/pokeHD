// ROM test for the gifts spike: a friend's game makes a Pokémon, the receiver gets money, items
// and Pokémon through the safe point, saves with the game's own routine, reboots from the
// battery save and finds everything. Skips without the dev ROM and the built disassembly.
import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { Button, GameBoy } from "../../packages/emu/src/core.ts";
import { playIntro } from "../../packages/emu/src/testing.ts";
import {
  BOXMON_STRUCT_LENGTH,
  fromBcd,
  GiftInbox,
  type GiftedMon,
  invalidMon,
  NAME_LENGTH,
  PARTYMON_STRUCT_LENGTH,
} from "./gifts.ts";
import { busyReason, loadSymbols, SafePoint, Symbols } from "./safepoint.ts";

const ROM_PATH = new URL("../../rom/pokeblue.gb", import.meta.url);
const SYM_PATH = new URL("../../vendor/pokered/pokeblue.sym", import.meta.url);
const WASM_PATH = new URL("../../packages/emu/src/generated/sameboy.wasm", import.meta.url);
const ready = existsSync(ROM_PATH) && existsSync(SYM_PATH);

const PIKACHU = 0x54;
const PIDGEY = 0x24;
const ABRA = 0x94;
const BULBASAUR = 0x99;
const SQUIRTLE = 0xb1;
const ODDISH = 0xb9;
const POTION = 0x14;
const ANTIDOTE = 0x0b;

/** Game text: A–Z are $80–$99, `@` ($50) terminates. */
const text = (s: string) => {
  const out = new Uint8Array(NAME_LENGTH).fill(0x50);
  [...s].forEach((c, i) => (out[i] = 0x80 + c.charCodeAt(0) - 65));
  return out;
};

describe.skipIf(!ready)("gifts through the overworld safe point", () => {
  let rom: Uint8Array;
  let wasm: Uint8Array;
  let s: Symbols;
  let start: Uint8Array;
  const gifts: GiftedMon[] = [];

  const boot = (sram?: Uint8Array) => GameBoy.create({ rom, wasmBinary: wasm, ...(sram ? { sram } : {}) });
  const frames = (gb: GameBoy, n: number) => {
    for (let i = 0; i < n; i++) gb.runFrame();
  };
  const settle = (gb: GameBoy, safe: SafePoint) => {
    for (let i = 0; i < 600 && safe.pending > 0; i++) gb.runFrame();
  };
  const r = (gb: GameBoy, name: string) => gb.read(s.addr(name));
  const bytes = (gb: GameBoy, name: string, offset: number, length: number) =>
    gb.readBytes(s.addr(name) + offset, length);
  const bag = (gb: GameBoy) => {
    const out: [number, number][] = [];
    for (let i = 0; i < r(gb, "wNumBagItems"); i++) out.push([...bytes(gb, "wNumBagItems", 1 + i * 2, 2)] as [number, number]);
    return out;
  };

  beforeAll(async () => {
    rom = readFileSync(ROM_PATH);
    wasm = readFileSync(WASM_PATH);
    s = new Symbols(loadSymbols(SYM_PATH.pathname));
    const gb = await boot();
    playIntro(gb);
    start = gb.saveState();

    // The friend: same start, renamed, and the game's own AddPartyMon makes six Pokémon (random
    // DVs, stats, moves, OT and ID from the friend's player). Naming the friend is test setup.
    const friend = await boot();
    friend.loadState(start);
    text("FRIEND").forEach((b, i) => friend.write(s.addr("wPlayerName") + i, b));
    friend.write(s.addr("wPlayerID"), 0x12);
    friend.write(s.addr("wPlayerID") + 1, 0x34);
    const safe = new SafePoint(friend, s);
    for (const [species, level] of [[PIKACHU, 12], [PIDGEY, 5], [ABRA, 9], [BULBASAUR, 7], [SQUIRTLE, 8], [ODDISH, 30]]) {
      safe.enqueue({
        scratch: [],
        steps: [
          {
            routine: "AddPartyMon",
            before: (g) => {
              g.write(s.addr("wCurPartySpecies"), species!);
              g.write(s.addr("wCurEnemyLevel"), level!);
              g.write(s.addr("wMonDataLocation"), 0x10); // player's party, no naming screen
            },
          },
        ],
      });
    }
    settle(friend, safe);
    expect(r(friend, "wPartyCount")).toBe(6);
    for (let i = 0; i < 6; i++) {
      gifts.push({
        data: bytes(friend, "wPartyMons", i * PARTYMON_STRUCT_LENGTH, PARTYMON_STRUCT_LENGTH),
        ot: bytes(friend, "wPartyMonOT", i * NAME_LENGTH, NAME_LENGTH),
        nick: text(["SPARKY", "PIDGE", "ABBY", "BULB", "SQUIRT", "ODD"][i]!),
      });
    }
  }, 120_000);

  it("rejects malformed Pokémon before they reach the game", () => {
    for (const mon of gifts) expect(invalidMon(rom, s, mon)).toBeUndefined();
    const glitch = { ...gifts[0]!, data: gifts[0]!.data.slice() };
    glitch.data[0] = 0x1f; // a MissingNo. slot
    expect(invalidMon(rom, s, glitch)).toBe("species");
    expect(invalidMon(rom, s, { ...gifts[0]!, ot: new Uint8Array(NAME_LENGTH) })).toBe("OT name");
  });

  it("lands money, items and Pokémon (party, then box) that survive a save and reboot", async () => {
    const gb = await boot();
    gb.loadState(start);
    const safe = new SafePoint(gb, s);
    const inbox = new GiftInbox(safe, s);
    const money = fromBcd(bytes(gb, "wPlayerMoney", 0, 3));

    // Waits while a menu is open: the overworld loop isn't even reached.
    gb.setButtons(Button.Start);
    frames(gb, 4);
    gb.setButtons(0);
    frames(gb, 30);
    inbox.give({ kind: "money", amount: 1500 });
    frames(gb, 120);
    expect(inbox.delivered).toHaveLength(0);
    gb.setButtons(Button.B);
    frames(gb, 4);
    gb.setButtons(0);
    settle(gb, safe);
    expect(inbox.delivered.map((d) => d.where)).toEqual(["money"]);
    expect(fromBcd(bytes(gb, "wPlayerMoney", 0, 3))).toBe(money + 1500);

    // Waits while walking: queued mid-step, it lands once the step is finished.
    gb.setButtons(Button.Right);
    for (let i = 0; i < 30 && r(gb, "wWalkCounter") === 0; i++) gb.runFrame();
    expect(r(gb, "wWalkCounter")).toBeGreaterThan(0);
    gb.setButtons(0);
    let walkingAtDelivery = -1;
    inbox.give({ kind: "item", item: POTION, quantity: 98 });
    const removeProbe = gb.addHook(s.get("AddItemToInventory"), (g) => (walkingAtDelivery = g.read(s.addr("wWalkCounter"))));
    expect(r(gb, "wWalkCounter")).toBeGreaterThan(0);
    settle(gb, safe);
    removeProbe();
    expect(safe.lastHold).toBe("walking");
    expect(walkingAtDelivery).toBe(0);

    // A stack past 99 spills into a new slot, as the game does with any gain.
    inbox.give({ kind: "item", item: POTION, quantity: 5 });
    inbox.give({ kind: "item", item: ANTIDOTE, quantity: 2 });
    settle(gb, safe);
    expect(bag(gb)).toEqual([[POTION, 99], [POTION, 4], [ANTIDOTE, 2]]);

    // Six Pokémon fill the party; the seventh goes to the box. The scratch the trade routine
    // reads from (wLoadedMon, the enemy OT and nickname slots) is put back afterwards.
    const scratch = () => [...bytes(gb, "wLoadedMon", 0, 44), ...bytes(gb, "wEnemyMon1OT", 0, 11), ...bytes(gb, "wEnemyMon1Nick", 0, 11)];
    const scratchBefore = scratch();
    for (const mon of gifts) inbox.give({ kind: "mon", mon });
    inbox.give({ kind: "mon", mon: gifts[0]! });
    settle(gb, safe);
    expect(inbox.delivered.map((d) => d.where)).toEqual(["money", "bag", "bag", "bag", ...Array(6).fill("party"), "box"]);

    expect(scratch()).toEqual(scratchBefore);
    expect(busyReason(gb, s)).toBeUndefined();

    // Save with the game's own routine (what the start menu's SAVE calls), at the safe point.
    gb.clearSramDirty();
    const saveGame = s.get("SaveGameData");
    safe.enqueue({ scratch: [], steps: [{ routine: "Bankswitch", registers: () => ({ bc: saveGame.bank << 8, hl: saveGame.address }) }] });
    settle(gb, safe);
    expect(gb.sramDirty).toBe(true);
    frames(gb, 60);

    // Reboot from the battery save and continue.
    const after = await boot(gb.saveSram());
    let inOverworld = false;
    const remove = after.addHook(s.get("OverworldLoop"), () => (inOverworld = true));
    for (let f = 0; !inOverworld && f < 5000; f++) {
      after.setButtons(f % 16 < 2 ? (f % 64 < 16 ? Button.Start : Button.A) : 0);
      after.runFrame();
    }
    remove();
    after.setButtons(0);
    expect(inOverworld).toBe(true);

    expect(fromBcd(bytes(after, "wPlayerMoney", 0, 3))).toBe(money + 1500);
    expect(bag(after)).toEqual([[POTION, 99], [POTION, 4], [ANTIDOTE, 2]]);
    expect(r(after, "wPartyCount")).toBe(6);
    gifts.forEach((mon, i) => {
      expect(bytes(after, "wPartySpecies", i, 1)[0]).toBe(mon.data[0]);
      expect(bytes(after, "wPartyMons", i * PARTYMON_STRUCT_LENGTH, PARTYMON_STRUCT_LENGTH)).toEqual(mon.data);
      expect(bytes(after, "wPartyMonOT", i * NAME_LENGTH, NAME_LENGTH)).toEqual(mon.ot);
      expect(bytes(after, "wPartyMonNicks", i * NAME_LENGTH, NAME_LENGTH)).toEqual(mon.nick);
    });
    expect(r(after, "wBoxCount")).toBe(1);
    const boxed = gifts[0]!.data.slice(0, BOXMON_STRUCT_LENGTH);
    boxed[3] = gifts[0]!.data[33]!; // the box-level byte, as Bill's PC sets it
    expect(bytes(after, "wBoxMons", 0, BOXMON_STRUCT_LENGTH)).toEqual(boxed);
    expect(bytes(after, "wBoxMonOT", 0, NAME_LENGTH)).toEqual(gifts[0]!.ot);
    expect(bytes(after, "wBoxMonNicks", 0, NAME_LENGTH)).toEqual(gifts[0]!.nick);
    // Owned in the Pokédex: six species.
    const owned = bytes(after, "wPokedexOwned", 0, 19).reduce((n, b) => n + popcount(b), 0);
    expect(owned).toBe(6);
  }, 120_000);

  it("holds gifts that don't fit (full bag, full party and box, money cap) without touching the game", async () => {
    const gb = await boot();
    gb.loadState(start);
    const safe = new SafePoint(gb, s);
    const inbox = new GiftInbox(safe, s);
    // Setup: a full bag (20 kinds), full party and box, and 999,000 money.
    const bagAddr = s.addr("wNumBagItems");
    gb.write(bagAddr, 20);
    for (let i = 0; i < 20; i++) {
      gb.write(bagAddr + 1 + i * 2, 0x20 + i);
      gb.write(bagAddr + 2 + i * 2, i === 0 ? 97 : 1);
    }
    gb.write(bagAddr + 41, 0xff);
    gb.write(s.addr("wPartyCount"), 6);
    gb.write(s.addr("wBoxCount"), 20);
    [0x99, 0x90, 0x00].forEach((b, i) => gb.write(s.addr("wPlayerMoney") + i, b));
    frames(gb, 10);
    const before = gb.readBytes(0xc000, 0x2000);

    inbox.give({ kind: "item", item: POTION, quantity: 1 });
    inbox.give({ kind: "item", item: 0x20, quantity: 3 }); // 97 + 3 = 100: no slot for the 1 over
    inbox.give({ kind: "mon", mon: gifts[1]! });
    inbox.give({ kind: "money", amount: 1000 });
    frames(gb, 120);
    expect(inbox.delivered).toHaveLength(0);
    expect(safe.pending).toBe(4);
    // Nothing in WRAM moved apart from the game's own per-frame state (timers, sprites, RNG,
    // audio): none of the bag, party, box or money.
    const now = gb.readBytes(0xc000, 0x2000);
    for (const name of ["wNumBagItems", "wPartyCount", "wBoxCount", "wPlayerMoney"]) {
      const a = s.addr(name) - 0xc000;
      expect(now.slice(a, a + 42)).toEqual(before.slice(a, a + 42));
    }

    // Room appears (the player uses an item, deposits a mon, spends money): they all land.
    gb.write(bagAddr + 2, 96);
    gb.write(s.addr("wNumBagItems"), 19);
    gb.write(bagAddr + 1 + 19 * 2, 0xff);
    gb.write(s.addr("wBoxCount"), 19);
    gb.write(s.addr("wPlayerMoney") + 1, 0x00);
    settle(gb, safe);
    expect(inbox.delivered.map((d) => d.where).sort()).toEqual(["bag", "bag", "box", "money"]);
  }, 120_000);
});

function popcount(b: number): number {
  let n = 0;
  for (; b; b &= b - 1) n++;
  return n;
}
