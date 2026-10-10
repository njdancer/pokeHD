import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import type { JournalEvent } from "@pokehd/emu";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, run } from "../idb.ts";
import { duplicateSlot, slotKey } from "../saves/slots.ts";
import { dayOf, PlayJournal, startOfDay } from "./journal.ts";

const ROM = "d7037c83e1ae5b39bde3c30787637ba1d4c48ce2";
const PALLET = 0;
const ROUTE_1 = 12;
const OAKS_LAB = 40;
const SQUIRTLE = 0xb1;
const RATTATA = 0xa5;
const PIDGEY = 0x24;
const BULBASAUR = 0x99;
const POTION = 0x14;
const POKE_BALL = 0x04;
const DAY = 24 * 60 * 60 * 1000;

/** A journal on a clock the test moves: starts at noon on 1 October 2026, local time. */
function clocked() {
  let now = new Date(2026, 9, 1, 12).getTime();
  const journal = PlayJournal.memory(undefined, { now: () => now });
  return { journal, tick: (ms: number) => (now += ms), now: () => now };
}

const at = (map: number, x = 5, y = 5) => ({ map, x, y });

/** The opening of a game, as JournalHooks reports it. */
const opening: JournalEvent[] = [
  { type: "item-added", item: POTION, quantity: 1, inventory: "box", source: "given", ...at(PALLET, 0, 0) },
  { type: "mon-added", species: SQUIRTLE, level: 5, into: "party", how: "starter", ...at(OAKS_LAB, 7, 4) },
  { type: "battle-start", kind: "trainer", battleType: 0, trainerClass: 0x19, trainerNumber: 2, ...at(OAKS_LAB, 5, 6) },
  { type: "enemy-seen", species: BULBASAUR, level: 5, kind: "trainer", ...at(OAKS_LAB, 5, 6) },
  { type: "battle-end", kind: "trainer", outcome: "won", result: 0, lead: SQUIRTLE, ...at(OAKS_LAB, 5, 6) },
];

describe("PlayJournal", () => {
  it("records encounters, battles and firsts from the hooks' events", () => {
    const { journal, tick } = clocked();
    for (const e of opening) {
      journal.record(e);
      tick(1000);
    }
    expect(journal.encounters().map((e) => [e.species, e.kind])).toEqual([[SQUIRTLE, "got"], [BULBASAUR, "seen"]]);
    expect(journal.battles()).toEqual([
      expect.objectContaining({ kind: "trainer", outcome: "won", trainerClass: 0x19, trainerNumber: 2, enemies: [BULBASAUR], lead: SQUIRTLE, map: OAKS_LAB }),
    ]);
    const battle = journal.battles()[0]!;
    expect(battle.endedAt - battle.at).toBe(2000);
    // A wild battle with a catch.
    journal.record({ type: "battle-start", kind: "wild", battleType: 0, species: RATTATA, level: 3, ...at(ROUTE_1, 10, 30) });
    journal.record({ type: "enemy-seen", species: RATTATA, level: 3, kind: "wild", ...at(ROUTE_1, 10, 30) });
    journal.record({ type: "caught", species: RATTATA, level: 3, into: "party", ...at(ROUTE_1, 10, 30) });
    journal.record({ type: "battle-end", kind: "wild", outcome: "caught", result: 2, lead: SQUIRTLE, ...at(ROUTE_1, 10, 30) });
    journal.record({ type: "badge", badge: 0, ...at(2) });
    journal.record({ type: "badge", badge: 0, ...at(2) }); // only once
    journal.record({ type: "evolved", from: SQUIRTLE, to: 0xb3, level: 16, partyIndex: 0, ...at(ROUTE_1) });

    const firsts = journal.firsts();
    expect(firsts.pokemon).toMatchObject({ species: SQUIRTLE, how: "starter", map: OAKS_LAB, x: 7, y: 4 });
    expect(firsts.catch).toMatchObject({ species: RATTATA, level: 3, map: ROUTE_1 });
    expect(firsts.trainerBeaten).toMatchObject({ trainerClass: 0x19, map: OAKS_LAB });
    expect(firsts.badge).toMatchObject({ badge: 0, map: 2 });
    expect(firsts.evolution).toMatchObject({ from: SQUIRTLE, to: 0xb3 });
    expect(firsts.gift).toBeUndefined();
    expect(journal.badges()).toHaveLength(1);

    const stats = journal.stats();
    expect(stats.battles).toEqual({ total: 2, won: 1, lost: 0, ran: 0, fled: 0, caught: 1, draw: 0 });
    expect(stats).toMatchObject({ caught: 1, speciesCaught: 1, speciesMet: 3, badges: 1, star: { species: SQUIRTLE, wins: 1 } });
  });

  it("ignores link battles' Pokémon and records a battle it joined part way", () => {
    const { journal } = clocked();
    journal.record({ type: "enemy-seen", species: PIDGEY, level: 30, kind: "link", ...at(OAKS_LAB) });
    journal.record({ type: "battle-end", kind: "link", outcome: "draw", result: 2, lead: SQUIRTLE, ...at(OAKS_LAB) });
    expect(journal.encounters()).toEqual([]);
    expect(journal.battles()).toEqual([expect.objectContaining({ kind: "link", outcome: "draw", enemies: [] })]);
  });

  it("keeps every item ever held, where it was first found and how it went", () => {
    const { journal, tick } = clocked();
    journal.record({ type: "item-added", item: POTION, quantity: 1, inventory: "bag", source: "found", ...at(ROUTE_1, 3, 4) });
    tick(1000);
    journal.record({ type: "item-added", item: POTION, quantity: 3, inventory: "bag", source: "bought", ...at(2) });
    journal.record({ type: "item-added", item: POKE_BALL, quantity: 5, inventory: "bag", source: "page", ...at(2) });
    // Moving between the bag and the PC isn't finding or using anything.
    journal.record({ type: "item-added", item: POTION, quantity: 1, inventory: "box", source: "pc", ...at(2) });
    journal.record({ type: "item-removed", item: POTION, quantity: 1, inventory: "bag", reason: "pc", ...at(2) });
    journal.record({ type: "item-removed", item: POTION, quantity: 2, inventory: "bag", reason: "used", ...at(2) });
    journal.record({ type: "item-removed", item: POTION, quantity: 1, inventory: "bag", reason: "sold", ...at(2) });
    journal.record({ type: "item-removed", item: POKE_BALL, quantity: 1, inventory: "bag", reason: "tossed", ...at(2) });
    expect(journal.items()).toEqual([
      { item: POTION, first: expect.objectContaining({ source: "found", map: ROUTE_1, x: 3, y: 4 }), obtained: 4, used: 2, sold: 1, tossed: 0 },
      { item: POKE_BALL, first: expect.objectContaining({ source: "page" }), obtained: 5, used: 0, sold: 0, tossed: 1 },
    ]);
    expect(journal.runOutOf([POKE_BALL]).map((h) => h.item)).toEqual([POTION]);
    expect(journal.finds().map((f) => f.source)).toEqual(["found", "bought", "page"]);
    expect(journal.stats().itemsFound).toBe(1);
  });

  it("walks a trail, counting steps but not jumps", () => {
    const { journal } = clocked();
    journal.position(PALLET, 5, 6);
    journal.position(PALLET, 5, 6); // standing still
    journal.position(PALLET, 5, 5);
    journal.position(PALLET, 6, 5);
    journal.position(ROUTE_1, 6, 35); // across the connection: a new map's baseline
    journal.position(ROUTE_1, 6, 34);
    journal.position(ROUTE_1, 20, 3); // a warp or a loaded state: not a step
    journal.position(ROUTE_1, -1, 3); // off the map's edge: no cell
    expect(journal.stats().steps).toBe(3);
    expect(journal.trail(PALLET)).toEqual([[5, 5], [6, 5], [5, 6]]);
    expect(journal.visited(ROUTE_1, 6, 34)).toBe(true);
    expect(journal.visited(ROUTE_1, 6, 33)).toBe(false);
    expect(journal.trailMaps().sort()).toEqual([PALLET, ROUTE_1]);
    expect(journal.places().map((p) => p.map)).toEqual([PALLET, ROUTE_1]);
    // Chunks hold 16×16 cells; cells on either side of a chunk edge both read back.
    journal.position(ROUTE_1, 15, 16);
    journal.position(ROUTE_1, 16, 16);
    expect(journal.visited(ROUTE_1, 15, 16) && journal.visited(ROUTE_1, 16, 16)).toBe(true);
  });

  it("splits today from all time", () => {
    const { journal, tick, now } = clocked();
    journal.position(PALLET, 1, 1);
    journal.position(PALLET, 1, 2);
    journal.money(3000);
    journal.money(3500); // won a battle
    journal.record(opening[1]!);
    tick(DAY);
    journal.position(PALLET, 1, 3);
    journal.money(3300); // bought something
    journal.record({ type: "caught", species: PIDGEY, level: 4, into: "party", ...at(ROUTE_1) });
    const today = startOfDay(now());
    expect(dayOf(today)).toBe("2026-10-02");
    expect(journal.stats(today)).toMatchObject({ steps: 1, earned: 0, spent: 200, caught: 1 });
    expect(journal.stats()).toMatchObject({ steps: 2, earned: 500, spent: 200 });
    expect(journal.encounters(today).map((e) => e.species)).toEqual([PIDGEY]);
    expect(journal.trail(PALLET, true)).toEqual([[1, 3]]);
    expect(journal.trail(PALLET)).toHaveLength(3);
    expect(journal.visited(PALLET, 1, 1, true)).toBe(false);
  });

  it("starts money and position afresh after a jump", () => {
    const { journal } = clocked();
    journal.money(1000);
    journal.position(PALLET, 1, 1);
    journal.resync();
    journal.money(50_000); // another save's money
    journal.position(PALLET, 1, 2);
    expect(journal.stats()).toMatchObject({ earned: 0, spent: 0, steps: 0 });
  });

  it("calls a Pokémon given just after a payment bought", () => {
    const { journal, tick } = clocked();
    journal.money(1000);
    journal.money(500); // the Magikarp salesman takes ¥500
    tick(3000);
    journal.record({ type: "mon-added", species: 0x85, level: 5, into: "party", how: "gift", ...at(68) });
    tick(60_000);
    journal.record({ type: "mon-added", species: 0x66, level: 25, into: "party", how: "gift", ...at(0xb8) });
    expect(journal.encounters().map((e) => e.kind)).toEqual(["bought", "got"]);
  });

  it("keeps checkpoints, gifts and people", () => {
    const { journal, tick } = clocked();
    journal.checkpoint(at(PALLET, 3, 4), "resume-1", "Pallet Town");
    journal.gift("sent", { kind: "money", amount: 100 }, "SAM");
    tick(1000);
    journal.gift("received", { kind: "item", item: POTION, quantity: 1 }, "NICK", at(ROUTE_1));
    journal.met(PALLET, 1);
    journal.met(PALLET, 1);
    journal.said(PALLET, 1, ["Technology is", "incredible!"]);
    journal.beat(ROUTE_1, 0);
    expect(journal.checkpoints()).toEqual([expect.objectContaining({ id: "resume-1", label: "Pallet Town", map: PALLET, x: 3, y: 4 })]);
    expect(journal.firsts().gift).toMatchObject({ friend: "NICK", map: ROUTE_1, gift: { kind: "item", item: POTION } });
    expect(journal.stats().gifts).toEqual({ sent: 1, received: 1 });
    expect(journal.people()).toEqual([
      expect.objectContaining({ map: PALLET, npc: 1, said: "Technology is\nincredible!" }),
      expect.objectContaining({ map: ROUTE_1, npc: 0, beaten: true }),
    ]);
  });

  it("bumps its version on each change", () => {
    const { journal } = clocked();
    const v = journal.version;
    journal.position(PALLET, 1, 1);
    journal.position(PALLET, 1, 1);
    expect(journal.version).toBe(v + 1);
  });
});

describe("PlayJournal in IndexedDB", () => {
  beforeEach(() => {
    closeDb();
    globalThis.indexedDB = new IDBFactory();
  });

  it("merges the Pokédex journal's places and people, then saves a couple of seconds after a change", async () => {
    const key = slotKey(ROM, "main");
    await run("saves", "readwrite", (s) =>
      s.put({ places: [{ map: PALLET, at: 5 }], people: [{ map: PALLET, npc: 2, at: 6, said: "Hi!" }] }, `${key}#dex:42`),
    );
    const journal = await PlayJournal.open(key, 42);
    expect(journal.places()).toEqual([{ map: PALLET, at: 5 }]);
    expect(journal.people()).toEqual([{ map: PALLET, npc: 2, at: 6, said: "Hi!" }]);
    journal.position(ROUTE_1, 4, 4);
    journal.record(opening[1]!);
    expect(await run("saves", "readonly", (s) => s.get(`${key}#play:42`))).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 2200));
    const again = await PlayJournal.open(key, 42);
    expect(again.encounters().map((e) => e.species)).toEqual([SQUIRTLE]);
    expect(again.visited(ROUTE_1, 4, 4)).toBe(true);
    // People the live game met since are merged on the next open, without doubling.
    await run("saves", "readwrite", (s) =>
      s.put({ places: [{ map: PALLET, at: 5 }], people: [{ map: PALLET, npc: 2, at: 6, said: "Hi!", beaten: true }, { map: ROUTE_1, npc: 0, at: 9 }] }, `${key}#dex:42`),
    );
    const third = await PlayJournal.open(key, 42);
    expect(third.people()).toEqual([
      { map: PALLET, npc: 2, at: 6, said: "Hi!", beaten: true },
      { map: ROUTE_1, npc: 0, at: 9 },
    ]);
    expect(third.places().map((p) => p.map)).toEqual([PALLET, ROUTE_1]);
    await Promise.all([again.flush(), third.flush()]);
  });

  it("lives with its slot: a duplicate takes a copy", async () => {
    const key = slotKey(ROM, "main");
    const journal = await PlayJournal.open(key, 7);
    journal.record(opening[1]!);
    await journal.flush();
    const signedOut = (async () => new Response(null, { status: 401 })) as typeof fetch;
    const copy = await duplicateSlot(ROM, "main", "Copy", signedOut);
    const copied = await PlayJournal.open(slotKey(ROM, copy.id), 7);
    expect(copied.encounters().map((e) => e.species)).toEqual([SQUIRTLE]);
    // A different trainer in the same slot (a new game) starts afresh.
    expect((await PlayJournal.open(key, 8)).encounters()).toEqual([]);
  });
});
