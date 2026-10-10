// The play journal (the Pokédex menu's Map, People, Inventory and Me tabs): what happened in this
// save that the game itself doesn't keep. Pokémon met and where, people met, every item ever
// held and where it was first found, the trail walked (for the map's fog), steps, battles, money
// earned and spent, checkpoints, gifts, badges and evolutions; the Firsts and stats derive from
// those. Fed by JournalHooks' events (read-only hooks in the emulator), the page's per-frame
// position and money, and the page's own calls (checkpoints, friends' gifts).
//
// One journal per save slot and trainer, stored next to the slot's battery save in IndexedDB
// (`<slot key>#play:<trainer ID>`), so duplicating a slot copies it (D39) and a new game in a slot
// starts a new one. The Pokédex's journal (`#dex:`, DexJournal) is merged in on open, so places
// and people the live game recorded are here too.
//
// `PlayJournal` itself is pure: `PlayJournal.memory()` makes one without IndexedDB for tests.
// Every record has a timestamp (`at`, ms), so "Today" is a `since` filter.
import type { BattleEnding, BattleKind, ItemSource, JournalEvent, MonArrival } from "@pokehd/emu";
import type { Gift } from "@pokehd/protocol";
import type { PersonMet } from "../dex/catalogue.ts";
import { run } from "../idb.ts";

/** Where on a map, in steps. */
export interface Spot {
  map: number;
  x: number;
  y: number;
}

/** How the player met a Pokémon: on the other side (seen: a trainer's; battled: wild), or theirs. */
export type EncounterKind = "seen" | "battled" | "caught" | "got" | "bought";

export interface Encounter extends Spot {
  /** Internal species index (as the game stores it). */
  species: number;
  level: number;
  kind: EncounterKind;
  at: number;
  /** For "got": how it arrived. */
  how?: MonArrival;
}

export interface BattleRecord extends Spot {
  /** When it started (when it ended for a battle the journal joined part way). */
  at: number;
  endedAt: number;
  kind: BattleKind;
  outcome: BattleEnding;
  trainerClass?: number;
  trainerNumber?: number;
  /** Species the other side put out, in order. */
  enemies: number[];
  /** The player's Pokémon out at the end. */
  lead: number;
}

/** An item reaching the bag or PC from outside (not moved between them). */
export interface ItemFind extends Spot {
  item: number;
  quantity: number;
  source: Exclude<ItemSource, "pc">;
  at: number;
}

/** Everything known about one item: for "Show things you've run out of" and the item page. */
export interface ItemHistory {
  item: number;
  first: ItemFind;
  /** Totals over all time. */
  obtained: number;
  used: number;
  sold: number;
  tossed: number;
}

export interface Checkpoint extends Spot {
  at: number;
  /** The page's own reference (a resume point or earlier save). */
  id?: string;
  label?: string;
}

export interface GiftRecord {
  at: number;
  direction: "sent" | "received";
  gift: Gift;
  /** The friend's name. */
  friend?: string;
  where?: Spot;
}

export interface BadgeRecord extends Spot {
  /** 0 Boulder … 7 Earth. */
  badge: number;
  at: number;
}

export interface EvolutionRecord extends Spot {
  from: number;
  to: number;
  level: number;
  at: number;
}

/** Visited step cells of one map, as 16×16-step chunks of bits (32 bytes each), by chunk index. */
type TrailMap = Record<string, Uint8Array>;

interface DayCounts {
  steps: number;
  earned: number;
  spent: number;
}

/** What's stored. Plain data (structured-clonable). */
export interface PlayJournalData {
  v: 1;
  places: { map: number; at: number }[];
  people: PersonMet[];
  encounters: Encounter[];
  battles: BattleRecord[];
  items: ItemHistory[];
  finds: ItemFind[];
  /** Every cell ever stepped on, by map. */
  trail: Record<string, TrailMap>;
  /** The cells stepped on during `trailToday.day` (local date, YYYY-MM-DD). */
  trailToday: { day: string; maps: Record<string, TrailMap> };
  /** Steps and money by local day. */
  days: Record<string, DayCounts>;
  checkpoints: Checkpoint[];
  gifts: GiftRecord[];
  badges: BadgeRecord[];
  evolutions: EvolutionRecord[];
}

export interface PlayStats {
  steps: number;
  battles: { total: number; won: number; lost: number; ran: number; fled: number; caught: number; draw: number };
  /** Catches, and distinct species caught. */
  caught: number;
  speciesCaught: number;
  /** Distinct species met in any way. */
  speciesMet: number;
  earned: number;
  spent: number;
  badges: number;
  /** The species out at the end of the most won battles. */
  star?: { species: number; wins: number };
  gifts: { sent: number; received: number };
  itemsFound: number;
}

export interface First extends Spot {
  at: number;
}

export interface Firsts {
  /** The first Pokémon of the player's own (the starter). */
  pokemon?: First & { species: number; how?: MonArrival };
  catch?: First & { species: number; level: number };
  trainerBeaten?: First & { trainerClass?: number; trainerNumber?: number };
  badge?: First & { badge: number };
  evolution?: First & { from: number; to: number };
  gift?: First & { gift: Gift; friend?: string };
}

export interface PlayJournalOptions {
  /** The clock, for tests. */
  now?: () => number;
}

/** Lines kept of what someone said: the first few, as the text box showed them (as DexJournal). */
const SAID_LINES = 6;
const CHUNK = 16;
/** Coordinates beyond this are outside any map (the game's are a byte). */
const MAX_STEP = 255;
const SAVE_AFTER_MS = 2000;
/** A Pokémon given this soon after the player paid was bought. */
const BOUGHT_WITHIN_MS = 15_000;

/** The local day of a time, as YYYY-MM-DD. */
export function dayOf(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The start of the local day holding `now`: the `since` for "Today". */
export function startOfDay(now: number = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function emptyJournal(): PlayJournalData {
  return {
    v: 1,
    places: [],
    people: [],
    encounters: [],
    battles: [],
    items: [],
    finds: [],
    trail: {},
    trailToday: { day: "", maps: {} },
    days: {},
    checkpoints: [],
    gifts: [],
    badges: [],
    evolutions: [],
  };
}

/** Sets a step's bit; true if it wasn't set. */
function mark(trail: Record<string, TrailMap>, map: number, x: number, y: number): boolean {
  const chunks = (trail[map] ??= {});
  const key = ((y >> 4) << 4) | (x >> 4);
  const chunk = (chunks[key] ??= new Uint8Array((CHUNK * CHUNK) / 8));
  const bit = (y & 15) * CHUNK + (x & 15);
  if (chunk[bit >> 3]! & (1 << (bit & 7))) return false;
  chunk[bit >> 3]! |= 1 << (bit & 7);
  return true;
}

function cells(chunks: TrailMap | undefined): [x: number, y: number][] {
  const out: [number, number][] = [];
  for (const [key, chunk] of Object.entries(chunks ?? {})) {
    const k = Number(key);
    const [cx, cy] = [(k & 15) * CHUNK, (k >> 4) * CHUNK];
    for (let bit = 0; bit < CHUNK * CHUNK; bit++) {
      if (chunk[bit >> 3]! & (1 << (bit & 7))) out.push([cx + (bit & 15), cy + (bit >> 4)]);
    }
  }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

const after = <T extends { at: number }>(list: readonly T[], since: number) => (since > 0 ? list.filter((r) => r.at >= since) : list);

export class PlayJournal {
  readonly #data: PlayJournalData;
  readonly #now: () => number;
  readonly #save: ((data: PlayJournalData) => Promise<void>) | undefined;
  #saving: ReturnType<typeof setTimeout> | undefined;
  /** The battle in progress, recorded when it ends. */
  #battle: BattleRecord | undefined;
  /** Where the player was last frame, and their money: deltas count, the first reading doesn't. */
  #last: Spot | undefined;
  #money: number | undefined;
  /** When money last fell: a Pokémon given just after was bought (the Magikarp salesman). */
  #spentAt = -Infinity;
  /** Bumped on every change, so React can tell. */
  version = 0;

  private constructor(data: PlayJournalData, options: PlayJournalOptions, save?: (data: PlayJournalData) => Promise<void>) {
    this.#data = data;
    this.#now = options.now ?? Date.now;
    this.#save = save;
  }

  /** A journal that lives only in memory (tests, the /dev/menu page). */
  static memory(data: PlayJournalData = emptyJournal(), options: PlayJournalOptions = {}): PlayJournal {
    return new PlayJournal(data, options);
  }

  /**
   * The journal of one slot's trainer (`slotKey` from saves/slots.ts, the trainer's ID from
   * wPlayerID). The Pokédex journal's places and people are merged in.
   */
  static async open(slotKey: string, trainerId: number, options: PlayJournalOptions = {}): Promise<PlayJournal> {
    const key = `${slotKey}#play:${trainerId}`;
    const get = <T>(k: string) => run<T | undefined>("saves", "readonly", (s) => s.get(k) as IDBRequest<T | undefined>).catch(() => undefined);
    const [stored, dex] = await Promise.all([get<PlayJournalData>(key), get<{ places: PlayJournalData["places"]; people: PersonMet[] }>(`${slotKey}#dex:${trainerId}`)]);
    const journal = new PlayJournal(stored ?? emptyJournal(), options, (data) => run("saves", "readwrite", (s) => s.put(data, key)).then(() => {}));
    if (dex) journal.importDex(dex);
    return journal;
  }

  /** The stored data (for export, or a test's next `memory()`). */
  get data(): Readonly<PlayJournalData> {
    return this.#data;
  }

  // ---------------------------------------------------------------- recording

  /** Places and people from the Pokédex's journal (DexJournal): adds any not here yet. */
  importDex(dex: { places?: readonly { map: number; at: number }[]; people?: readonly PersonMet[] }): void {
    let changed = false;
    for (const place of dex.places ?? []) {
      const have = this.#data.places.find((p) => p.map === place.map);
      if (!have) this.#data.places.push({ ...place });
      else if (place.at < have.at) have.at = place.at;
      else continue;
      changed = true;
    }
    for (const person of dex.people ?? []) {
      const have = this.#person(person.map, person.npc);
      if (!have) this.#data.people.push({ ...person });
      else if ((person.beaten && !have.beaten) || (person.said && !have.said)) Object.assign(have, { beaten: have.beaten || person.beaten, said: have.said ?? person.said });
      else continue;
      changed = true;
    }
    if (changed) this.#changed();
  }

  /** An event from JournalHooks (the emulator's "journal" message). */
  record(event: JournalEvent): void {
    const at = this.#now();
    const spot: Spot = { map: event.map, x: event.x, y: event.y };
    switch (event.type) {
      case "battle-start":
        this.#battle = {
          ...spot,
          at,
          endedAt: at,
          kind: event.kind,
          outcome: "ran",
          enemies: [],
          lead: 0,
          ...(event.trainerClass !== undefined ? { trainerClass: event.trainerClass, trainerNumber: event.trainerNumber } : {}),
        };
        return;
      case "enemy-seen":
        if (event.kind === "link") return; // a friend's Pokémon, not the game's
        this.#battle?.enemies.push(event.species);
        this.#encounter({ ...spot, species: event.species, level: event.level, kind: event.kind === "wild" ? "battled" : "seen", at });
        return;
      case "caught":
        this.#encounter({ ...spot, species: event.species, level: event.level, kind: "caught", at });
        return;
      case "battle-end": {
        const battle = this.#battle ?? { ...spot, at, endedAt: at, kind: event.kind, outcome: event.outcome, enemies: [], lead: 0 };
        this.#battle = undefined;
        this.#data.battles.push({ ...battle, endedAt: at, outcome: event.outcome, lead: event.lead });
        this.#changed();
        return;
      }
      case "item-added": {
        if (event.source === "pc") return;
        const find: ItemFind = { ...spot, item: event.item, quantity: event.quantity, source: event.source, at };
        this.#data.finds.push(find);
        const history = this.#item(find);
        history.obtained += event.quantity;
        this.#changed();
        return;
      }
      case "item-removed": {
        const history = this.#data.items.find((h) => h.item === event.item);
        if (!history || event.reason === "pc" || event.reason === "page") return;
        if (event.reason === "sold") history.sold += event.quantity;
        else if (event.reason === "tossed") history.tossed += event.quantity;
        else history.used += event.quantity;
        this.#changed();
        return;
      }
      case "mon-added": {
        const bought = event.how === "gift" && at - this.#spentAt < BOUGHT_WITHIN_MS;
        this.#encounter({ ...spot, species: event.species, level: event.level, kind: bought ? "bought" : "got", how: event.how, at });
        return;
      }
      case "badge":
        if (this.#data.badges.some((b) => b.badge === event.badge)) return;
        this.#data.badges.push({ ...spot, badge: event.badge, at });
        this.#changed();
        return;
      case "evolved":
        this.#data.evolutions.push({ ...spot, from: event.from, to: event.to, level: event.level, at });
        this.#changed();
        return;
    }
  }

  /**
   * The player's position this frame (from the page's OverworldState: mapId, player.x/y).
   * Records the place, the trail cell and a step when they moved one cell on the same map.
   */
  position(map: number, x: number, y: number): void {
    const last = this.#last;
    if (last && last.map === map && last.x === x && last.y === y) return;
    this.#last = { map, x, y };
    let changed = false;
    if (!this.#data.places.some((p) => p.map === map)) {
      this.#data.places.push({ map, at: this.#now() });
      changed = true;
    }
    if (last && last.map === map && Math.abs(last.x - x) + Math.abs(last.y - y) === 1) {
      this.#day().steps++;
      changed = true;
    }
    if (x >= 0 && y >= 0 && x <= MAX_STEP && y <= MAX_STEP) {
      const today = dayOf(this.#now());
      if (this.#data.trailToday.day !== today) this.#data.trailToday = { day: today, maps: {} };
      if (mark(this.#data.trail, map, x, y)) changed = true;
      if (mark(this.#data.trailToday.maps, map, x, y)) changed = true;
    }
    if (changed) this.#changed();
  }

  /** The player's money (wPlayerMoney) this frame: rises count as earned, falls as spent. */
  money(amount: number): void {
    const last = this.#money;
    this.#money = amount;
    if (last === undefined || last === amount) return;
    const day = this.#day();
    if (amount > last) day.earned += amount - last;
    else {
      day.spent += last - amount;
      this.#spentAt = this.#now();
    }
    this.#changed();
  }

  /**
   * The game jumped (a save state or another save loaded): the next position and money are new
   * baselines rather than a step or a payment, and a battle in progress is forgotten.
   */
  resync(): void {
    this.#last = undefined;
    this.#money = undefined;
    this.#battle = undefined;
  }

  /** The page took a checkpoint (a resume point, an earlier save) here. */
  checkpoint(spot: Spot, id?: string, label?: string): Checkpoint {
    const point: Checkpoint = { ...spot, at: this.#now(), ...(id ? { id } : {}), ...(label ? { label } : {}) };
    this.#data.checkpoints.push(point);
    this.#changed();
    return point;
  }

  /** A gift to or from a friend (D20), once it's settled. */
  gift(direction: "sent" | "received", gift: Gift, friend?: string, where?: Spot): void {
    this.#data.gifts.push({ at: this.#now(), direction, gift, ...(friend ? { friend } : {}), ...(where ? { where } : {}) });
    this.#changed();
  }

  /** The player is on this map (also recorded by `position`). */
  visit(map: number): void {
    if (this.#data.places.some((p) => p.map === map)) return;
    this.#data.places.push({ map, at: this.#now() });
    this.#changed();
  }

  /** Someone on the map spoke to the player (DexGuard's onTalk). */
  met(map: number, npc: number): void {
    if (this.#person(map, npc)) return;
    this.#data.people.push({ map, npc, at: this.#now() });
    this.#changed();
  }

  /** The player beat this trainer (DexGuard's onBeat). */
  beat(map: number, npc: number): void {
    let person = this.#person(map, npc);
    if (!person) this.#data.people.push((person = { map, npc, at: this.#now() }));
    if (person.beaten) return;
    person.beaten = true;
    this.#changed();
  }

  /** What they said, the first time. */
  said(map: number, npc: number, lines: readonly string[]): void {
    const person = this.#person(map, npc);
    if (!person || person.said || !lines.length) return;
    person.said = lines.slice(0, SAID_LINES).join("\n");
    this.#changed();
  }

  // ---------------------------------------------------------------- reading
  // Every list takes `since` (ms): 0 for all time, `startOfDay()` for today.

  places(since = 0): readonly { map: number; at: number }[] {
    return after(this.#data.places, since);
  }
  people(since = 0): readonly PersonMet[] {
    return after(this.#data.people, since);
  }
  encounters(since = 0): readonly Encounter[] {
    return after(this.#data.encounters, since);
  }
  battles(since = 0): readonly BattleRecord[] {
    return after(this.#data.battles, since);
  }
  finds(since = 0): readonly ItemFind[] {
    return after(this.#data.finds, since);
  }
  checkpoints(since = 0): readonly Checkpoint[] {
    return after(this.#data.checkpoints, since);
  }
  gifts(since = 0): readonly GiftRecord[] {
    return after(this.#data.gifts, since);
  }
  badges(since = 0): readonly BadgeRecord[] {
    return after(this.#data.badges, since);
  }
  evolutions(since = 0): readonly EvolutionRecord[] {
    return after(this.#data.evolutions, since);
  }

  /** Every item ever held (by first find), for "Show things you've run out of". */
  items(): readonly ItemHistory[] {
    return this.#data.items;
  }

  /** Items once held that aren't in `held` now (item IDs in the bag and PC). */
  runOutOf(held: Iterable<number>): readonly ItemHistory[] {
    const have = new Set(held);
    return this.#data.items.filter((h) => !have.has(h.item));
  }

  /** Whether the player has stepped on this cell (ever, or today with `today`). */
  visited(map: number, x: number, y: number, today = false): boolean {
    const trail = today ? this.#trailToday() : this.#data.trail;
    if (x < 0 || y < 0 || x > MAX_STEP || y > MAX_STEP) return false;
    const chunk = trail[map]?.[((y >> 4) << 4) | (x >> 4)];
    const bit = (y & 15) * CHUNK + (x & 15);
    return !!chunk && !!(chunk[bit >> 3]! & (1 << (bit & 7)));
  }

  /** The cells walked on a map, row by row: the fog lifts on these (`today` for today's). */
  trail(map: number, today = false): [x: number, y: number][] {
    return cells((today ? this.#trailToday() : this.#data.trail)[map]);
  }

  /** Maps with any trail. */
  trailMaps(today = false): number[] {
    return Object.keys(today ? this.#trailToday() : this.#data.trail).map(Number);
  }

  stats(since = 0): PlayStats {
    const battles = this.battles(since);
    const count = (outcome: BattleEnding) => battles.filter((b) => b.outcome === outcome).length;
    const encounters = this.encounters(since);
    const catches = encounters.filter((e) => e.kind === "caught");
    const wins = new Map<number, number>();
    for (const b of battles) if (b.outcome === "won" && b.lead) wins.set(b.lead, (wins.get(b.lead) ?? 0) + 1);
    let star: PlayStats["star"];
    for (const [species, n] of wins) if (!star || n > star.wins) star = { species, wins: n };
    const sinceDay = since > 0 ? dayOf(since) : "";
    let steps = 0;
    let earned = 0;
    let spent = 0;
    for (const [day, counts] of Object.entries(this.#data.days)) {
      if (day < sinceDay) continue;
      steps += counts.steps;
      earned += counts.earned;
      spent += counts.spent;
    }
    const gifts = this.gifts(since);
    return {
      steps,
      battles: { total: battles.length, won: count("won"), lost: count("lost"), ran: count("ran"), fled: count("fled"), caught: count("caught"), draw: count("draw") },
      caught: catches.length,
      speciesCaught: new Set(catches.map((e) => e.species)).size,
      speciesMet: new Set(encounters.map((e) => e.species)).size,
      earned,
      spent,
      badges: this.badges(since).length,
      ...(star ? { star } : {}),
      gifts: { sent: gifts.filter((g) => g.direction === "sent").length, received: gifts.filter((g) => g.direction === "received").length },
      itemsFound: this.finds(since).filter((f) => f.source === "found" || f.source === "hidden").length,
    };
  }

  firsts(): Firsts {
    const d = this.#data;
    const where = (s: Spot & { at: number }): First => ({ map: s.map, x: s.x, y: s.y, at: s.at });
    const firstOf = <T extends { at: number }>(list: readonly T[], keep: (t: T) => boolean) =>
      list.filter(keep).reduce<T | undefined>((a, b) => (!a || b.at < a.at ? b : a), undefined);
    const pokemon = firstOf(d.encounters, (e) => e.kind === "got" || e.kind === "caught" || e.kind === "bought");
    const caught = firstOf(d.encounters, (e) => e.kind === "caught");
    const trainer = firstOf(d.battles, (b) => b.kind === "trainer" && b.outcome === "won");
    const badge = firstOf(d.badges, () => true);
    const evolution = firstOf(d.evolutions, () => true);
    const gift = firstOf(d.gifts, (g) => g.direction === "received");
    const out: Firsts = {};
    if (pokemon) out.pokemon = { ...where(pokemon), species: pokemon.species, ...(pokemon.how ? { how: pokemon.how } : {}) };
    if (caught) out.catch = { ...where(caught), species: caught.species, level: caught.level };
    if (trainer) out.trainerBeaten = { ...where(trainer), ...(trainer.trainerClass !== undefined ? { trainerClass: trainer.trainerClass, trainerNumber: trainer.trainerNumber } : {}) };
    if (badge) out.badge = { ...where(badge), badge: badge.badge };
    if (evolution) out.evolution = { ...where(evolution), from: evolution.from, to: evolution.to };
    if (gift) out.gift = { map: gift.where?.map ?? -1, x: gift.where?.x ?? 0, y: gift.where?.y ?? 0, at: gift.at, gift: gift.gift, ...(gift.friend ? { friend: gift.friend } : {}) };
    return out;
  }

  // ---------------------------------------------------------------- storage

  /** Writes it now (also done a couple of seconds after a change; at most that often). */
  async flush(): Promise<void> {
    clearTimeout(this.#saving);
    this.#saving = undefined;
    await this.#save?.(this.#data).catch(() => {});
  }

  #trailToday(): Record<string, TrailMap> {
    return this.#data.trailToday.day === dayOf(this.#now()) ? this.#data.trailToday.maps : {};
  }

  #day(): DayCounts {
    return (this.#data.days[dayOf(this.#now())] ??= { steps: 0, earned: 0, spent: 0 });
  }

  #person(map: number, npc: number): PersonMet | undefined {
    return this.#data.people.find((p) => p.map === map && p.npc === npc);
  }

  #item(find: ItemFind): ItemHistory {
    let history = this.#data.items.find((h) => h.item === find.item);
    if (!history) this.#data.items.push((history = { item: find.item, first: find, obtained: 0, used: 0, sold: 0, tossed: 0 }));
    return history;
  }

  #encounter(encounter: Encounter): void {
    this.#data.encounters.push(encounter);
    this.#changed();
  }

  /** Bumps the version; saves within SAVE_AFTER_MS (not pushed back by later changes, so a walk saves too). */
  #changed(): void {
    this.version++;
    if (!this.#save || this.#saving) return;
    this.#saving = setTimeout(() => void this.flush(), SAVE_AFTER_MS);
  }
}
