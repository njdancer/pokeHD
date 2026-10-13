// ROM test for gifts (D20): a friend's game takes a Pokémon, an item and money out and saves;
// the receiver's game gets them at the overworld idle point, waits while busy or full, and
// finds everything after its own save and a reboot. Skips without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import type { Gift } from "@pokehd/protocol";
import { encodeText, SYMBOLS, type SymbolName } from "@pokehd/rom";
import { beforeAll, describe, expect, it } from "vitest";
import { Button, GameBoy } from "../core.ts";
import { playIntro } from "../testing.ts";
import { GiftDesk, type GiftEvent } from "./desk.ts";
import { BOXMON_STRUCT_LENGTH, fromBcd, NAME_LENGTH, PARTYMON_STRUCT_LENGTH, type GiftSpec, type TakeResult } from "./gifts.ts";
import { busyReason, SafePoint } from "./safepoint.ts";

const ROM_PATH = new URL("../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../generated/sameboy.wasm", import.meta.url);

const PIKACHU = 0x54;
const PIDGEY = 0x24;
const ABRA = 0x94;
const BULBASAUR = 0x99;
const SQUIRTLE = 0xb1;
const ODDISH = 0xb9;
const POTION = 0x14;
const ANTIDOTE = 0x0b;
const BICYCLE = 0x06;

const addr = (name: SymbolName) => SYMBOLS[name].address;
const r = (gb: GameBoy, name: SymbolName, offset = 0) => gb.read(addr(name) + offset);
const bytes = (gb: GameBoy, name: SymbolName, offset: number, length: number) => gb.readBytes(addr(name) + offset, length);
const money = (gb: GameBoy) => fromBcd(bytes(gb, "wPlayerMoney", 0, 3));
const bag = (gb: GameBoy) => {
  const out: [number, number][] = [];
  for (let i = 0; i < r(gb, "wNumBagItems"); i++) out.push([...bytes(gb, "wNumBagItems", 1 + i * 2, 2)] as [number, number]);
  return out;
};
const frames = (gb: GameBoy, n: number) => {
  for (let i = 0; i < n; i++) gb.runFrame();
};
const press = (gb: GameBoy, button: number) => {
  gb.setButtons(button);
  frames(gb, 4);
  gb.setButtons(0);
};
const popcount = (b: number) => {
  let n = 0;
  for (; b; b &= b - 1) n++;
  return n;
};

function desk(gb: GameBoy, rom: Uint8Array) {
  const events: GiftEvent[] = [];
  const d = new GiftDesk(gb, { rom, emit: (e) => events.push(e) });
  const settle = () => {
    for (let i = 0; i < 600 && d.pending > 0; i++) gb.runFrame();
  };
  const take = (spec: GiftSpec) => {
    let result: TakeResult | undefined;
    d.take(spec, (res) => (result = res));
    settle();
    expect(result).toBeDefined();
    return result!;
  };
  return { desk: d, events, settle, take };
}

/** The game's own save, at the idle point, as the start menu's SAVE does it. */
function save(gb: GameBoy) {
  const safe = SafePoint.of(gb);
  const sym = SYMBOLS.SaveGameData;
  safe.enqueue({ scratch: [], steps: [{ routine: "Bankswitch", registers: () => ({ bc: sym.bank << 8, hl: sym.address }) }] });
  for (let i = 0; i < 600 && safe.pending > 0; i++) gb.runFrame();
}

describe.skipIf(!existsSync(ROM_PATH))("gifts through the overworld idle point (D20)", () => {
  let rom: Uint8Array;
  let wasm: Uint8Array;
  let start: Uint8Array;
  const boot = async (sram?: Uint8Array) => GameBoy.create({ rom, wasmBinary: wasm, ...(sram ? { sram } : {}) });
  const fromStart = async () => {
    const gb = await boot();
    gb.loadState(start);
    return gb;
  };
  /** Reboots from the battery save and presses through CONTINUE into the overworld. */
  const reboot = async (gb: GameBoy) => {
    const after = await boot(gb.saveSram());
    let inOverworld = false;
    const remove = after.addHook("OverworldLoop", () => (inOverworld = true));
    for (let f = 0; !inOverworld && f < 5000; f++) {
      after.setButtons(f % 16 < 2 ? (f % 64 < 16 ? Button.Start : Button.A) : 0);
      after.runFrame();
    }
    remove();
    after.setButtons(0);
    expect(inOverworld).toBe(true);
    return after;
  };

  beforeAll(async () => {
    rom = new Uint8Array(readFileSync(ROM_PATH));
    wasm = readFileSync(WASM_PATH);
    const gb = await boot();
    playIntro(gb);
    start = gb.saveState();
  }, 60_000);

  it("takes a gift out of the sender's game and saves straight after", async () => {
    const friend = await fromStart();
    const { desk: d, take } = desk(friend, rom);
    // Setup: a party made by the game's own AddPartyMon, and two kinds of item.
    const safe = SafePoint.of(friend);
    for (const [species, level] of [[PIKACHU, 12], [PIDGEY, 5]] as const) {
      safe.enqueue({
        scratch: [],
        steps: [
          {
            routine: "AddPartyMon",
            before: (g) => {
              g.write(addr("wCurPartySpecies"), species);
              g.write(addr("wCurEnemyLevel"), level);
              g.write(addr("wMonDataLocation"), 0x10); // the player's party, no naming screen
            },
          },
        ],
      });
    }
    d.give("setup-1", { kind: "item", item: POTION, quantity: 5 });
    d.give("setup-2", { kind: "item", item: BICYCLE, quantity: 1 }); // rejected: a key item
    frames(friend, 30);
    friend.write(addr("wNumBagItems"), 2); // the bike, as if Cycle Shop gave it
    friend.write(addr("wNumBagItems") + 3, BICYCLE);
    friend.write(addr("wNumBagItems") + 4, 1);
    friend.write(addr("wNumBagItems") + 5, 0xff);
    // AddPartyMon without the naming screen leaves the nicknames blank; name them as a player would.
    encodeText("SPARKY").forEach((b, i) => friend.write(addr("wPartyMonNicks") + i, b));
    encodeText("PIDGE").forEach((b, i) => friend.write(addr("wPartyMonNicks") + NAME_LENGTH + i, b));
    const startMoney = money(friend);
    const pikachu = bytes(friend, "wPartyMons", 0, PARTYMON_STRUCT_LENGTH);

    friend.clearSramDirty();
    const mon = take({ kind: "mon", slot: 0, species: PIKACHU });
    expect(mon).toMatchObject({ ok: true });
    expect(mon.ok && mon.gift.kind === "mon" && mon.gift.mon.data).toEqual([...pikachu]);
    expect(friend.sramDirty).toBe(true); // it saved
    expect(r(friend, "wPartyCount")).toBe(1);
    expect(take({ kind: "item", slot: 0, item: POTION, quantity: 2 })).toEqual({ ok: true, gift: { kind: "item", item: POTION, quantity: 2 } });
    expect(take({ kind: "money", amount: 500 })).toEqual({ ok: true, gift: { kind: "money", amount: 500 } });
    // Refused: the last Pokémon, a key item, a stale slot, more money than there is.
    expect(take({ kind: "mon", slot: 0, species: PIDGEY })).toEqual({ ok: false, reason: "last Pokémon" });
    expect(take({ kind: "item", slot: 1, item: BICYCLE, quantity: 1 })).toEqual({ ok: false, reason: "key item" });
    expect(take({ kind: "item", slot: 0, item: ANTIDOTE, quantity: 1 })).toEqual({ ok: false, reason: "item moved" });
    expect(take({ kind: "money", amount: 999_999 })).toEqual({ ok: false, reason: "not enough money" });

    // The save holds all of it: reloading can't bring the gifts back.
    const after = await reboot(friend);
    expect(r(after, "wPartyCount")).toBe(1);
    expect(r(after, "wPartySpecies")).toBe(PIDGEY);
    expect(bag(after)).toEqual([[POTION, 3], [BICYCLE, 1]]);
    expect(money(after)).toBe(startMoney - 500);
  }, 120_000);

  it("lands money, items and Pokémon (party, then box) and settles them once saved", async () => {
    // Six Pokémon from a friend's game, as the sender's take would send them.
    const friend = await fromStart();
    encodeText("FRIEND").forEach((b, i) => friend.write(addr("wPlayerName") + i, b));
    friend.write(addr("wPlayerID"), 0x12);
    const safe = SafePoint.of(friend);
    for (const [species, level] of [[PIKACHU, 12], [PIDGEY, 5], [ABRA, 9], [BULBASAUR, 7], [SQUIRTLE, 8], [ODDISH, 30]] as const) {
      safe.enqueue({
        scratch: [],
        steps: [
          {
            routine: "AddPartyMon",
            before: (g) => {
              g.write(addr("wCurPartySpecies"), species);
              g.write(addr("wCurEnemyLevel"), level);
              g.write(addr("wMonDataLocation"), 0x10);
            },
          },
        ],
      });
    }
    for (let i = 0; i < 600 && safe.pending > 0; i++) friend.runFrame();
    const mons = [0, 1, 2, 3, 4, 5].map((i) => ({
      data: [...bytes(friend, "wPartyMons", i * PARTYMON_STRUCT_LENGTH, PARTYMON_STRUCT_LENGTH)],
      ot: [...bytes(friend, "wPartyMonOT", i * NAME_LENGTH, NAME_LENGTH)],
      nick: [...encodeText(["SPARKY", "PIDGE", "ABBY", "BULB", "SQUIRT", "ODD"][i]!)],
    }));

    const gb = await fromStart();
    const { desk: d, events, settle } = desk(gb, rom);
    const before = money(gb);
    const landed = () => events.flatMap((e) => (e.type === "landed" ? [e.where] : []));

    // Waits while a menu is open: the overworld loop isn't even reached.
    press(gb, Button.Start);
    frames(gb, 30);
    d.give("m1", { kind: "money", amount: 1500 });
    frames(gb, 120);
    expect(landed()).toEqual([]);
    press(gb, Button.B);
    settle();
    expect(landed()).toEqual(["money"]);
    expect(money(gb)).toBe(before + 1500);

    // Waits while walking: queued mid-step, it lands once the step is done.
    gb.setButtons(Button.Right);
    for (let i = 0; i < 30 && r(gb, "wWalkCounter") === 0; i++) gb.runFrame();
    gb.setButtons(0);
    expect(r(gb, "wWalkCounter")).toBeGreaterThan(0);
    let walking = -1;
    const probe = gb.addHook("AddItemToInventory", (g) => (walking = g.read(addr("wWalkCounter"))));
    d.give("i1", { kind: "item", item: POTION, quantity: 98 });
    settle();
    probe();
    expect(walking).toBe(0);

    // Stacks past 99 spill into a new slot, as any gain does. A repeat ID is ignored.
    d.give("i2", { kind: "item", item: POTION, quantity: 5 });
    d.give("i2", { kind: "item", item: POTION, quantity: 5 });
    d.give("i3", { kind: "item", item: ANTIDOTE, quantity: 2 });
    settle();
    expect(bag(gb)).toEqual([[POTION, 99], [POTION, 4], [ANTIDOTE, 2]]);

    // Six fill the party, a seventh goes to the box; the trade routine's scratch is put back.
    const scratch = () => [...bytes(gb, "wLoadedMon", 0, 44), ...bytes(gb, "wEnemyMon1OT", 0, 11), ...bytes(gb, "wEnemyMon1Nick", 0, 11)];
    const scratchBefore = scratch();
    mons.forEach((mon, i) => d.give(`p${i}`, { kind: "mon", mon }));
    d.give("p6", { kind: "mon", mon: mons[0]! });
    settle();
    expect(scratch()).toEqual(scratchBefore);
    expect(landed()).toEqual(["money", "bag", "bag", "bag", ...Array(6).fill("party"), "box"]);
    expect(busyReason(gb)).toBeUndefined();

    // Rejected outright: a key item, a glitch species.
    d.give("k1", { kind: "item", item: BICYCLE, quantity: 1 });
    d.give("g1", { kind: "mon", mon: { ...mons[0]!, data: [0x1f, ...mons[0]!.data.slice(1)] } });
    expect(events.filter((e) => e.type === "rejected")).toEqual([
      { type: "rejected", id: "k1", reason: "key item" },
      { type: "rejected", id: "g1", reason: "species" },
    ]);

    // Nothing is settled until the game saves: handing over battery RAM alone (the game also
    // decompresses pictures into it) doesn't count.
    d.saved();
    expect(events.some((e) => e.type === "settled")).toBe(false);
    save(gb);
    d.saved(); // the worker does this when it hands the save over
    const settled = events.find((e) => e.type === "settled");
    // SaveMainData (money, bag, box) runs before SavePartyAndDexData.
    expect(settled).toEqual({ type: "settled", ids: ["m1", "i1", "i2", "i3", "p6", "p0", "p1", "p2", "p3", "p4", "p5"] });

    const after = await reboot(gb);
    expect(money(after)).toBe(before + 1500);
    expect(bag(after)).toEqual([[POTION, 99], [POTION, 4], [ANTIDOTE, 2]]);
    expect(r(after, "wPartyCount")).toBe(6);
    mons.forEach((mon, i) => {
      expect(r(after, "wPartySpecies", i)).toBe(mon.data[0]);
      expect([...bytes(after, "wPartyMons", i * PARTYMON_STRUCT_LENGTH, PARTYMON_STRUCT_LENGTH)]).toEqual(mon.data);
      expect([...bytes(after, "wPartyMonOT", i * NAME_LENGTH, NAME_LENGTH)]).toEqual(mon.ot);
      expect([...bytes(after, "wPartyMonNicks", i * NAME_LENGTH, NAME_LENGTH)]).toEqual(mon.nick);
    });
    expect(r(after, "wBoxCount")).toBe(1);
    const boxed = mons[0]!.data.slice(0, BOXMON_STRUCT_LENGTH);
    boxed[3] = mons[0]!.data[33]!; // the box-level byte, as Bill's PC sets it
    expect([...bytes(after, "wBoxMons", 0, BOXMON_STRUCT_LENGTH)]).toEqual(boxed);
    expect([...bytes(after, "wBoxMonOT", 0, NAME_LENGTH)]).toEqual(mons[0]!.ot);
    expect([...bytes(after, "wBoxMonNicks", 0, NAME_LENGTH)]).toEqual(mons[0]!.nick);
    expect(bytes(after, "wPokedexOwned", 0, 19).reduce((n, b) => n + popcount(b), 0)).toBe(6);
  }, 120_000);

  it("holds gifts that don't fit without touching the game, and lands them once there's room", async () => {
    const gb = await fromStart();
    const { desk: d, events, settle } = desk(gb, rom);
    const bagAddr = addr("wNumBagItems");
    gb.write(bagAddr, 20);
    for (let i = 0; i < 20; i++) {
      gb.write(bagAddr + 1 + i * 2, 0x20 + i);
      gb.write(bagAddr + 2 + i * 2, i === 0 ? 97 : 1);
    }
    gb.write(bagAddr + 41, 0xff);
    gb.write(addr("wPartyCount"), 6);
    gb.write(addr("wBoxCount"), 20);
    [0x99, 0x90, 0x00].forEach((b, i) => gb.write(addr("wPlayerMoney") + i, b));
    frames(gb, 10);
    const snapshot = () => ["wNumBagItems", "wPartyCount", "wBoxCount", "wPlayerMoney"].map((n) => [...bytes(gb, n as SymbolName, 0, 42)]);
    const before = snapshot();

    const mon: Gift = {
      kind: "mon",
      mon: { data: [PIDGEY, ...Array(32).fill(0), 5, ...Array(10).fill(0)], ot: [...encodeText("FRIEND")], nick: [...encodeText("PIDGE")] },
    };
    d.give("a", { kind: "item", item: POTION, quantity: 1 });
    d.give("b", { kind: "item", item: 0x20, quantity: 3 }); // 97 + 3 = 100: no slot for the one over
    d.give("c", mon);
    d.give("d", { kind: "money", amount: 1000 });
    frames(gb, 120);
    expect(d.pending).toBe(4);
    expect(snapshot()).toEqual(before);
    expect(events.filter((e) => e.type === "held").map((e) => e.type === "held" && e.reason)).toEqual([
      "bag full",
      "bag full",
      "party and box full",
      "money would pass ₽999,999",
    ]);

    // Room appears (an item used, a mon withdrawn, money spent): all four land.
    gb.write(bagAddr + 2, 96);
    gb.write(bagAddr, 19);
    gb.write(bagAddr + 1 + 19 * 2, 0xff);
    gb.write(addr("wBoxCount"), 19);
    gb.write(addr("wPlayerMoney") + 1, 0x00);
    settle();
    expect(events.flatMap((e) => (e.type === "landed" ? [e.where] : [])).sort()).toEqual(["bag", "bag", "box", "money"]);
  }, 120_000);
});
