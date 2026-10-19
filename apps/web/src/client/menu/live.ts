// The hi-fi Pokédex menu fed by the real game (/dev/menu/live): the MenuModel built from the
// game's memory (GameSnapshot), the ROM and the play journal, and MenuActions done with the
// game's own routines (EmulatorHost.act) or as answers to its questions (GameAsks). The game's
// questions become the menu's sheets (Request); the ones it has no sheet for (yes/no, a PC item
// list, a quantity nobody chose yet) stay with the small fallback sheet (Sheets.tsx).
import type { ActionResult, AskAnswer, GameAction, GameAsk, GameSnapshot, MonStatus } from "@pokehd/emu";
import { FLY_TOWNS, itemUse, outsideTileset } from "@pokehd/emu";
import {
  type Message,
  growth,
  isKeyItem,
  itemName,
  MAP_NAMES,
  monName,
  moveName,
  pokedexNumber,
  romOffset,
  SYMBOLS,
  townMapPlace,
  typeName,
  type WorldData,
} from "@pokehd/rom";
import { scriptedOutcome } from "../dex/battles.ts";
import { reportError } from "../errors.ts";
import type { Catalogue } from "../dex/catalogue.ts";
import type { LastSeen } from "../room/account.ts";
import type { Friend as RoomFriend } from "../room/client.ts";
import { bikeAllowed, escapeRopeWorks, itemLine, itemPrice, shelf } from "./items.ts";
import type { PlayJournal } from "./journal.ts";
import type { AppOptions, FieldMove, GameOptions, Item, ItemKind, Learns, MenuActions, MenuModel, Moment, Mon, Person, PersonKind, Request } from "./model.ts";

const HM01 = 0xc4;
const TM01 = 0xc9;
const BASE_DATA = 28;
const MOVE_DATA = 6;
const FIRST_INDOOR = MAP_NAMES.indexOf("REDS_HOUSE_1F");
const STATUS: Record<MonStatus, Mon["status"]> = { ok: undefined, sleep: "SLP", poison: "PSN", burn: "BRN", freeze: "FRZ", paralysis: "PAR" };
const LEADERS = new Set(["BROCK", "MISTY", "LT.SURGE", "ERIKA", "KOGA", "SABRINA", "BLAINE", "GIOVANNI", "LORELEI", "BRUNO", "AGATHA", "LANCE"]);
const HELPERS = new Set(["Prof. Oak", "Mom", "Daisy", "Nurse Joy", "Shop clerk", "Mr. Fuji", "Bill", "Gym guide", "Link Club desk"]);
const NEXT_LEADER = ["BROCK", "MISTY", "LT. SURGE", "ERIKA", "KOGA", "SABRINA", "BLAINE", "GIOVANNI"];
const FRIEND_COLOURS = ["#8e5bb5", "#2c8fd6", "#d0703a", "#4caf50", "#e0588a", "#c9a227"];

/** A move's type and PP from the ROM's Moves table (animation, effect, power, type, accuracy, PP). */
function moveData(rom: Uint8Array, move: number) {
  const at = romOffset(SYMBOLS.Moves) + (move - 1) * MOVE_DATA;
  return { type: typeName(rom, rom[at + 3]!), pp: rom[at + 5]! };
}

const baseAt = (dex: number) => (dex === 151 ? romOffset(SYMBOLS.MewBaseStats) : romOffset(SYMBOLS.BaseStats) + (dex - 1) * BASE_DATA);

/** Whether the ROM's TM/HM flags let this Pokémon learn the machine. */
export function canLearn(rom: Uint8Array, dex: number, item: number): boolean {
  if (item < HM01) return false;
  // Flag bits run TM01–TM50 then HM01–HM05.
  const bit = item >= TM01 ? item - TM01 : 50 + item - HM01;
  return ((rom[baseAt(dex) + 20 + (bit >> 3)]! >> (bit & 7)) & 1) === 1;
}

/** The move a machine teaches (TechnicalMachines lists TM01–TM50 then HM01–HM05). */
export function machineMove(rom: Uint8Array, item: number): number {
  const index = item >= TM01 ? item - TM01 : 50 + item - HM01;
  return rom[romOffset(SYMBOLS.TechnicalMachines) + index]!;
}

const nice = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** Moves by level and the evolution line, from the ROM. */
function learnsOf(rom: Uint8Array, cache: Map<number, Learns>, dex: number, speciesOf: (dex: number) => number): Learns {
  let out = cache.get(dex);
  if (out) return out;
  const species = speciesOf(dex);
  const base = baseAt(dex);
  const start = [15, 16, 17, 18].map((k) => rom[base + k]!).filter(Boolean);
  const moves: Learns["moves"] = [...start.map((m) => [nice(moveName(rom, m)), 0] as [string, number]), ...growth(rom, species).learnset.map((l) => [nice(moveName(rom, l.move)), l.level] as [string, number])];
  // Back to the first of the line, then forward along the first evolution of each.
  const prev = new Map<number, { from: number; how: string }>();
  for (let s = 1; s <= 190; s++) {
    if (!pokedexNumber(rom, s)) continue;
    for (const e of growth(rom, s).evolutions) {
      const how = e.how === "level" ? `Level ${e.level}` : e.how === "item" ? nice(itemName(rom, e.item)) : "Trade";
      if (!prev.has(e.species)) prev.set(e.species, { from: s, how });
    }
  }
  let first = species;
  for (let guard = 0; prev.has(first) && guard < 4; guard++) first = prev.get(first)!.from;
  const grows: Learns["grows"] = [pokedexNumber(rom, first)];
  for (let s = first, guard = 0; guard < 4; guard++) {
    const next = growth(rom, s).evolutions[0];
    if (!next) break;
    const how = next.how === "level" ? `Level ${next.level}` : next.how === "item" ? nice(itemName(rom, next.item)) : "Trade";
    grows.push(how, pokedexNumber(rom, next.species));
    s = next.species;
  }
  out = { moves, grows: grows.length > 1 ? grows : [] };
  cache.set(dex, out);
  return out;
}

/**
 * The Inventory's filter for an item. What's left after our shelves and is used on a Pokémon
 * (UsableItems_PartyMenu: the evolution stones, vitamins, RARE CANDY, PP UP) is a boost, not
 * medicine (QA bug 50: MOON STONE was listed under Healing).
 */
export function itemKind(rom: Uint8Array, item: number): ItemKind {
  const s = shelf(rom, item);
  if (s === "Other") return itemUse(rom, item).onMon ? "Boosts" : isKeyItem(rom, item) ? "Key" : "Travel";
  return s;
}

function toItem(rom: Uint8Array, item: number, count: number | undefined): Item {
  const price = itemPrice(rom, item);
  const teaches = item >= HM01 ? moveName(rom, machineMove(rom, item)) : undefined;
  return {
    id: item,
    name: itemName(rom, item),
    kind: itemKind(rom, item),
    count: isKeyItem(rom, item) ? undefined : count,
    ...(teaches ? { sub: teaches } : {}),
    text: teaches ? `Teaches ${nice(teaches)}. ${item >= TM01 ? "Used up once taught." : "It never runs out."}` : itemLine(rom, item),
    // Only a few TMs are on any shelf (Celadon's), but the Mart buys any of them back.
    ...(price && item < HM01 ? { buy: `₽${price.toLocaleString("en")} at a Poké Mart` } : {}),
    ...(price ? { price, sell: Math.floor(price / 2) } : {}),
  };
}

const ago = (at: number, now = Date.now()) => {
  if (!at) return "a while ago";
  const s = Math.round((now - at) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} hour${h === 1 ? "" : "s"} ago` : new Date(at).toLocaleDateString();
};

export interface LiveInput {
  rom: Uint8Array;
  world: WorldData;
  catalogue: Catalogue;
  game: GameSnapshot;
  journal: PlayJournal | null;
  /** Every friend; `online` while they're connected to the room (presence once they're playing). */
  friends: readonly LiveFriend[];
  savedAt: number;
  app: AppOptions;
}

/** A friend: online with live presence, or away with where they were last seen. */
export type LiveFriend = RoomFriend & { online: boolean; seen?: LastSeen };

/**
 * Where a place indoors sits on the outdoor map: the door that leads into it, through any floors
 * or rooms in between (interiors leave by "the last map", so only the way in names them).
 */
export function outdoorSpot(world: WorldData, map: number): { map: number; x: number; y: number } | null {
  const seen = new Set([map]);
  let frontier = [map];
  while (frontier.length) {
    const next: number[] = [];
    for (const inner of frontier) {
      for (const outer of world.maps) {
        const door = outer?.warps.find((w) => w.to === inner);
        if (!outer || !door) continue;
        if (outer.id < FIRST_INDOOR) return { map: outer.id, x: door.x, y: door.y };
        if (!seen.has(outer.id)) {
          seen.add(outer.id);
          next.push(outer.id);
        }
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * What the field items can do where the player stands, by the game's own checks. The map header's
 * tileset is the one the game loads into wCurMapTileset for it.
 */
export function fieldOf(rom: Uint8Array, world: WorldData, game: Pick<GameSnapshot, "map" | "transport"> & Partial<Pick<GameSnapshot, "townsVisited">>): MenuModel["field"] {
  const tileset = world.maps[game.map]?.tileset;
  const flyTo = Array.from({ length: FLY_TOWNS }, (_, map) => map)
    .filter((map) => ((game.townsVisited ?? 0) >> map) & 1)
    .map((map) => ({ map, name: townMapPlace(rom, map).name }));
  if (tileset === undefined) return { escapeRope: false, bike: false, outside: false, flyTo };
  return { escapeRope: escapeRopeWorks(rom, game.map, tileset), bike: game.transport !== "surf" && bikeAllowed(rom, game.map, tileset), outside: outsideTileset(tileset), flyTo };
}

/** Per ROM: how each Pokémon grows (it takes a scan of every species). */
const learnsCache = new WeakMap<Uint8Array, Map<number, Learns>>();

/** A Pokémon's moves and evolution line straight from the ROM, outside a game (the card's dev page). */
export function romLearns(rom: Uint8Array, catalogue: Catalogue): (dex: number) => Learns | undefined {
  const cache = learnsCache.get(rom) ?? new Map<number, Learns>();
  learnsCache.set(rom, cache);
  const speciesOf = (dex: number) => catalogue.entries[dex - 1]!.species;
  return (dex) => (catalogue.entries[dex - 1] ? learnsOf(rom, cache, dex, speciesOf) : undefined);
}

export function liveModel({ rom, world, catalogue, game, journal, friends, savedAt, app }: LiveInput): MenuModel {
  const placeOf = (map: number) => (MAP_NAMES[map] ? townMapPlace(rom, map).name : "");
  const speciesOf = (dex: number) => catalogue.entries[dex - 1]!.species;
  const toMon = (m: { species: number; nick: string; level: number }, key: string, rest: Partial<Mon> = {}): Mon => ({
    key,
    dex: pokedexNumber(rom, m.species),
    name: m.nick || monName(rom, m.species),
    level: m.level,
    hp: 1,
    maxHp: 1,
    moves: [],
    ...rest,
  });
  // Stable keys while the team is reordered: who they are, not where.
  const seenKeys = new Map<string, number>();
  const keyOf = (m: { species: number; nick: string; otId?: number }) => {
    const k = `${m.species}:${m.otId ?? 0}:${m.nick}`;
    const n = (seenKeys.get(k) ?? 0) + 1;
    seenKeys.set(k, n);
    return `${k}#${n}`;
  };
  const team = game.team.map((m) =>
    toMon(m, keyOf(m), {
      hp: m.hp,
      maxHp: m.maxHp,
      status: STATUS[m.status],
      moves: m.moves.map((mv) => {
        const d = moveData(rom, mv.move);
        return { name: moveName(rom, mv.move), type: d.type, pp: mv.pp, maxPp: d.pp + Math.floor(d.pp / 5) * mv.ppUps };
      }),
    }),
  );
  const box = game.box.map((m, i) => toMon(m, `box:${i}:${m.species}`));
  const bag = game.bag.map((b) => toItem(rom, b.item, b.quantity));
  const held = [...game.bag, ...game.pcItems].map((b) => b.item);
  const past = (journal?.runOutOf(held) ?? []).map((h) => ({
    ...toItem(rom, h.item, 0),
    count: 0,
    gone: h.used ? "Used up" : h.sold ? "Sold" : h.tossed ? "Thrown away" : "Handed over",
    place: placeOf(h.first.map),
  }));
  const people: Person[] = [];
  for (const met of journal?.people() ?? []) {
    const p = catalogue.person(met.map, met.npc);
    const npc = world.maps[met.map]?.npcs[met.npc];
    if (!p || !npc) continue;
    // Leaders and the rival end their battles in scripts of their own, which the journal's beat
    // hook never sees: the game's event flag says (QA bug 71).
    const scripted = scriptedOutcome(met.map, met.npc, game.events);
    const fights = !!p.trainer || scripted !== undefined;
    const beaten = !!met.beaten || scripted === "beaten";
    const kind: PersonKind = fights ? (scripted !== undefined || (p.trainer && LEADERS.has(p.trainer.name)) || p.name === "Rival" ? "Leader" : "Trainer") : HELPERS.has(p.name) ? "Helper" : "Townsfolk";
    people.push({
      key: p.key,
      name: p.name,
      kind,
      place: catalogue.placeOf(met.map)?.name ?? "",
      status: fights ? (beaten ? "Beaten" : scripted === "fought" ? "Battled" : "Not beaten yet") : `Met ${ago(met.at)}`,
      ...(beaten ? { beaten: true } : {}),
      ...(met.said ? { said: met.said.replace(/\n/g, " ") } : {}),
      picture: npc.kind === "trainer" ? { trainer: npc.trainerClass } : { sprite: npc.sprite },
    });
  }
  people.reverse();
  const visited = new Set((journal?.places() ?? []).map((p) => placeOf(p.map)).filter(Boolean));
  // Indoors, "you" stand at the building's door on the map (the map only draws outdoors).
  const lastOutdoor = (journal?.places() ?? []).findLast((p) => p.map < FIRST_INDOOR)?.map ?? 0;
  const spot = game.map < FIRST_INDOOR ? { map: game.map, x: game.x, y: game.y } : (outdoorSpot(world, game.map) ?? { map: lastOutdoor, x: world.maps[lastOutdoor]?.widthBlocks ?? 0, y: world.maps[lastOutdoor]?.heightBlocks ?? 0 });
  const here = { place: placeOf(game.map), ...spot };
  visited.add(here.place);
  const s = journal?.stats();
  const badges = Array.from({ length: 8 }, (_, i) => ((game.badges >> i) & 1) === 1);
  const badgeCount = badges.filter(Boolean).length;
  const played = `${game.playTime.hours}:${String(game.playTime.minutes).padStart(2, "0")}`;
  const money = (n: number) => `₽${n.toLocaleString("en")}`;
  const stats: MenuModel["stats"] = [
    { value: played, label: "Played" },
    ...(s ? [{ value: s.steps.toLocaleString("en"), label: "Steps", ...(s.steps >= 2000 ? { sub: `about ${Math.round(s.steps / 2000)} km` } : {}) }] : []),
    ...(s ? [{ value: String(s.battles.won), label: "Battles won", sub: `${s.battles.lost} lost · ran from ${s.battles.ran}` }] : []),
    { value: String(game.owned.size), label: "Caught", sub: `${game.seen.size} seen` },
    ...(s ? [{ value: money(s.earned), label: "Earned", sub: `${money(s.spent)} spent` }] : []),
    { value: `${badgeCount} of 8`, label: "Badges", ...(badgeCount < 8 ? { sub: `next: ${NEXT_LEADER[badges.indexOf(false)]}` } : {}) },
    ...(s?.star ? [{ value: String(s.star.wins), label: `Wins by ${monName(rom, s.star.species)}`, sub: "your star" }] : []),
    ...(s && s.gifts.sent + s.gifts.received ? [{ value: String(s.gifts.sent + s.gifts.received), label: "Gifts", sub: `${s.gifts.sent} sent · ${s.gifts.received} got` }] : []),
  ];
  const f = journal?.firsts();
  const day = (at: number) => {
    const startAt = journal?.data.places[0]?.at ?? at;
    const n = Math.floor((at - startAt) / 86_400_000) + 1;
    return new Date(at).toDateString() === new Date().toDateString() ? "Today" : `Day ${Math.max(1, n)}`;
  };
  const firsts: MenuModel["firsts"] = [];
  if (f?.pokemon) firsts.push({ title: "First Pokémon", text: monName(rom, f.pokemon.species), when: day(f.pokemon.at), place: placeOf(f.pokemon.map), dex: pokedexNumber(rom, f.pokemon.species) });
  if (f?.catch) firsts.push({ title: "First catch", text: `${monName(rom, f.catch.species)}, level ${f.catch.level}`, when: day(f.catch.at), place: placeOf(f.catch.map), dex: pokedexNumber(rom, f.catch.species) });
  if (f?.trainerBeaten) firsts.push({ title: "First trainer beaten", text: "Your first win against a trainer", when: day(f.trainerBeaten.at), place: placeOf(f.trainerBeaten.map) });
  if (f?.badge) firsts.push({ title: "First badge", text: `The ${["BOULDER", "CASCADE", "THUNDER", "RAINBOW", "SOUL", "MARSH", "VOLCANO", "EARTH"][f.badge.badge]}BADGE`, when: day(f.badge.at), place: placeOf(f.badge.map) });
  if (f?.evolution) firsts.push({ title: "First evolution", text: `${monName(rom, f.evolution.from)} grew into ${monName(rom, f.evolution.to)}`, when: day(f.evolution.at), place: placeOf(f.evolution.map), dex: pokedexNumber(rom, f.evolution.to) });
  const checkpoints = (journal?.checkpoints() ?? []).slice(-5).reverse();
  const o = game.options & 15;
  const options: GameOptions = { speed: o <= 1 ? "Fast" : o <= 3 ? "Medium" : "Slow", animations: (game.options & 0x80) === 0, style: game.options & 0x40 ? "Set" : "Shift" };
  // The map's layers from the journal: outdoor spots only (interiors aren't on the map).
  const today = new Date().setHours(0, 0, 0, 0);
  const outdoor = (map: number) => map < FIRST_INDOOR && !!MAP_NAMES[map];
  const encounters = (journal?.encounters() ?? [])
    .filter((e) => outdoor(e.map) && e.kind !== "got" && e.kind !== "bought")
    .map((e) => ({
      dex: pokedexNumber(rom, e.species),
      map: MAP_NAMES[e.map]!,
      x: e.x,
      y: e.y,
      how: e.kind === "caught" ? ("caught" as const) : e.kind === "battled" ? ("battled" as const) : ("seen" as const),
      text: e.kind === "caught" ? `Caught at level ${e.level}` : e.kind === "battled" ? `A wild one, level ${e.level}` : `A trainer's, level ${e.level}`,
      ...(e.at >= today ? { today: true } : {}),
    }));
  const finds = (journal?.finds() ?? [])
    .filter((x) => outdoor(x.map))
    .map((x) => ({ item: itemName(rom, x.item), map: MAP_NAMES[x.map]!, x: x.x, y: x.y, text: x.source === "bought" ? "Bought here" : x.source === "hidden" ? "Hidden here" : "Found here", ...(x.at >= today ? { today: true } : {}) }));
  const trailMaps = (journal?.places() ?? []).filter((p) => outdoor(p.map));
  // Friends on the map: where they are now while they play, else where they were last seen.
  // Indoors, like "you", they stand at the building's door.
  const friendsAt: MenuModel["layers"]["friendsAt"] = {};
  for (const fr of friends) {
    const at = fr.presence ?? fr.seen;
    const spot = at && (outdoor(at.mapId) ? { map: at.mapId, x: at.x, y: at.y } : outdoorSpot(world, at.mapId));
    if (spot && MAP_NAMES[spot.map]) friendsAt[fr.id] = [MAP_NAMES[spot.map]!, spot.x, spot.y];
  }
  const cache = learnsCache.get(rom) ?? new Map<number, Learns>();
  learnsCache.set(rom, cache);
  return {
    trainer: { name: game.player, id: game.playerId, money: game.money, played, badges },
    team,
    box,
    bag,
    past,
    seen: game.seen,
    owned: game.owned,
    onShow: game.onShow,
    people,
    friends: friends.map((fr, i) => ({
      id: fr.id,
      name: fr.name,
      online: fr.online,
      where: fr.presence
        ? (catalogue.placeOf(fr.presence.mapId)?.name ?? "Playing")
        : fr.online
          ? "Here, not playing yet"
          : fr.seen && catalogue.placeOf(fr.seen.mapId)
            ? `Last seen in ${catalogue.placeOf(fr.seen.mapId)!.name}`
            : "Not playing now",
      ...(!fr.presence && fr.seen ? { seen: { place: catalogue.placeOf(fr.seen.mapId)?.name ?? "", ago: ago(fr.seen.at) } } : {}),
      colour: FRIEND_COLOURS[i % FRIEND_COLOURS.length]!,
    })),
    visited,
    here,
    stats,
    firsts,
    checkpoints: checkpoints.map((c) => ({ place: catalogue.placeOf(c.map)?.name ?? "", when: ago(c.at) })),
    savedAgo: ago(savedAt),
    options,
    app,
    repel: game.repelSteps,
    biking: game.transport === "bike",
    surfing: game.transport === "surf",
    ...(typeof game.battleMon === "number" ? { battleMon: game.battleMon } : {}),
    field: fieldOf(rom, world, game),
    layers: {
      encounters,
      finds,
      checkpoints: checkpoints.filter((c) => outdoor(c.map)).map((c) => ({ place: catalogue.placeOf(c.map)?.name ?? "", map: MAP_NAMES[c.map]!, x: c.x, y: c.y, when: ago(c.at), ...(c.at >= today ? { today: true } : {}) })),
      friendsAt,
      trail: trailMaps.map((p) => MAP_NAMES[p.map]!),
      todayFrom: Math.max(0, trailMaps.findIndex((p) => p.at >= today)) || trailMaps.length,
      partly: new Set(),
    },
    learns: (dex) => (catalogue.entries[dex - 1] ? learnsOf(rom, cache, dex, speciesOf) : undefined),
    canLearn: (dex, item) => canLearn(rom, dex, item),
  };
}

/** One of the menu's reads of the game, and the question (by id) that was up when it was asked for. */
export interface GameRead {
  game: GameSnapshot;
  during: number | null;
}

/**
 * The game as the menu should show it: the newest read. The game as it was when it asked is read
 * once, the moment the question comes in; a read asked for later, under the same question, is
 * newer and wins (a Poké Mart's list stays up while the game takes the money, QA bug 24).
 * A read from before the question is older than the question's own.
 */
export function currentGame(ask: { id: number; game: GameSnapshot | null } | null, read: GameRead | null): GameSnapshot | null {
  if (!ask) return read?.game ?? null;
  if (read && read.during === ask.id) return read.game;
  return ask.game ?? read?.game ?? null;
}

/** What the game is doing, for the menu's choices. */
export function momentOf(game: GameSnapshot | null, ask: GameAsk | null): Moment {
  if (ask?.kind === "party" && ask.purpose === "next") return "fainted";
  if (ask?.kind === "mons") return "pc";
  if (ask?.kind === "mart" || (ask?.kind === "items" && ask.selling && !ask.inBattle)) return "shop";
  if (game?.inBattle) return game.battleKind === "trainer" ? "trainer" : "wild";
  return "explore";
}

/** The menu's sheet for the game's question, or null where it has none (the fallback sheet asks). */
export function requestOf(rom: Uint8Array, ask: GameAsk): Request | null {
  switch (ask.kind) {
    case "party":
      if (ask.purpose === "next") return { kind: "fainted" };
      if (ask.purpose === "switch" && ask.inBattle) return { kind: "battle-team" };
      return null;
    case "items":
      if (ask.list === "bag" && ask.inBattle) return { kind: "battle-bag" };
      if (ask.list === "bag" && ask.selling) return { kind: "sell" };
      return null;
    case "mart":
      return { kind: "buy", stock: ask.entries.map((id) => ({ id, name: itemName(rom, id), price: itemPrice(rom, id), kind: itemKind(rom, id) })) };
    case "mons":
      return { kind: ask.list === "team" ? "deposit" : "withdraw" };
    default:
      return null;
  }
}

export interface LiveHost {
  /** `waiting` hears why, if the game hasn't taken the action up after a few seconds. */
  act(action: GameAction, signal?: AbortSignal, waiting?: (reason: string) => void): Promise<ActionResult>;
  answer(id: number, answer: AskAnswer): void;
  /** The game's words after an action, or why it didn't happen. */
  notice(text: string): void;
  setApp<K extends keyof AppOptions>(key: K, value: AppOptions[K]): void;
  /** Sends a friend a gift (a team member by index, or one of an item); resolves to what happened, in words. */
  sendGift?(friend: string, what: { item: number } | { mon: number }): Promise<string>;
  /** The game as the menu last read it (bag indices, options). */
  game: GameSnapshot | null;
}

/** "PIKACHU\nrecovered by 20!" reads as one line. */
const said = (r: ActionResult) => (r.ok ? r.messages.map((m) => m.replace(/\n/g, " ")).join(" ") : r.reason === "cancelled" ? "" : (r.messages.at(-1)?.replace(/\n/g, " ") ?? `Not now: ${r.reason}.`));

/** A purchase's (or sale's) answers after the item: how many, then yes to "OK?". */
const buying = (count: number): { kind: GameAsk["kind"]; answer: AskAnswer }[] => [
  { kind: "quantity", answer: { quantity: count } },
  { kind: "yes-no", answer: { yes: true } },
];

/**
 * The menu's actions on the real game. A question the game is asking right now is answered
 * (with the answers it will ask next queued: a battle item's Pokémon, a purchase's quantity
 * and "OK?"); anything else is an action at the next idle point. Returns "" at once: the game's
 * own words follow as a notice when it has done it.
 */
export class LiveActions implements MenuActions {
  /** A ref: the page keeps it current (React's state and callbacks change under it). */
  readonly #ref: { readonly current: LiveHost };
  readonly #rom: Uint8Array;
  #asking: { id: number; ask: GameAsk } | null = null;
  /** Answers for the questions that follow the one just answered, in order. */
  #next: { kind: GameAsk["kind"]; answer: AskAnswer }[] = [];
  /** The answers in `#next` end a purchase: the game's next message is its reply ("Here you are!"). */
  #purchase = false;
  /** The game's reply to a purchase is due: the menu shows it as a notice and reads past it. */
  #replying = false;
  /**
   * The Poké Mart's sheet is up, though the game may be busy with the last purchase: taps on it
   * meanwhile (another purchase, or closing it) wait here for the game's next list.
   */
  #shop = false;
  #shopQueue: { item: number; count: number }[] | "cancel" = [];
  /** A TM or HM is being taught (its action hasn't ended). */
  #teaching = false;

  constructor(rom: Uint8Array, host: { readonly current: LiveHost }) {
    this.#rom = rom;
    this.#ref = host;
    // The screens pass the methods on unbound (onMove={actions.moveMon}).
    const self = this as unknown as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(LiveActions.prototype)) {
      const f = self[name];
      if (name !== "constructor" && typeof f === "function") self[name] = f.bind(this);
    }
  }

  get #host(): LiveHost {
    return this.#ref.current;
  }

  /** The game asks: true if a queued answer took it (no sheet needed). */
  asked(id: number, ask: GameAsk): boolean {
    this.#replying = false;
    const next = this.#next[0];
    if (next && next.kind === ask.kind) {
      this.#next.shift();
      this.#host.answer(id, next.answer);
      if (this.#next.length === 0 && this.#purchase) this.#replying = true;
      return true;
    }
    this.#next = [];
    this.#purchase = false;
    if (ask.kind === "mart" && this.#shop) {
      // The shop's list again: what the player tapped while the game was busy goes in now.
      const queued = this.#shopQueue;
      this.#shopQueue = [];
      if (queued === "cancel") {
        this.#shop = false;
        this.#host.answer(id, null);
        return true;
      }
      const buy = queued.shift();
      const index = buy ? ask.entries.indexOf(buy.item) : -1;
      if (buy && index >= 0) {
        this.#shopQueue = queued;
        this.#purchase = true;
        this.#next = buying(buy.count);
        this.#host.answer(id, { index });
        return true;
      }
    }
    this.#shop = ask.kind === "mart";
    this.#asking = { id, ask };
    return false;
  }

  /**
   * The game printed a message. `reply`: its answer to a purchase ("Here you are! Thank you!",
   * or why not), which the shop's sheet would hide: the menu shows it as a notice and the page
   * reads past it, so the game comes back to its list (QA bug 25). `away`: the game has moved on
   * from the question a sheet was showing (it isn't waiting on it, nor on answers queued), so a
   * sheet still up has gone stale and goes, leaving the game's own words in view. Null: a
   * message between queued answers (a purchase's "That will be ₽300. OK?").
   */
  heard(message: Message): "reply" | "away" | null {
    if (this.#replying) {
      this.#replying = false;
      const text = message.pages.flatMap((p) => p.lines).map((l) => l.trim()).filter(Boolean).join(" ");
      if (text) this.#host.notice(text);
      return "reply";
    }
    if (this.#next.length > 0 || this.#asking) return null;
    this.#shop = false;
    this.#shopQueue = [];
    return "away";
  }

  #answer(answer: AskAnswer, then: { kind: GameAsk["kind"]; answer: AskAnswer }[] = [], purchase = false): boolean {
    const asking = this.#asking;
    if (!asking) return false;
    this.#asking = null;
    this.#next = then;
    this.#purchase = purchase;
    this.#host.answer(asking.id, answer);
    return true;
  }

  /**
   * Runs the action at the game's next idle point. One the game is slow to take up says so, and
   * is reported with why it waits, so a tap that seems to do nothing can be traced on any device.
   */
  #act(action: GameAction): Promise<ActionResult> {
    return this.#host.act(action, undefined, (why) => {
      this.#host.notice("Waiting for a quiet moment in the game…");
      reportError("stuck", new Error(`${action.kind} waited: ${why} (${JSON.stringify(action)})`));
    });
  }

  #do(action: GameAction): string {
    void this.#act(action).then((r) => {
      const text = said(r);
      if (text) this.#host.notice(text);
    });
    return "";
  }

  #listIndex(item: number): number {
    const ask = this.#asking?.ask;
    if (ask?.kind === "items") return ask.entries.findIndex((e) => e.item === item);
    if (ask?.kind === "mart") return ask.entries.indexOf(item);
    return -1;
  }

  useItem(item: number, mon?: number): string {
    // In battle: the bag's answer, then the Pokémon it's for when the game asks.
    if (this.#asking?.ask.kind === "items") {
      const index = this.#listIndex(item);
      this.#answer({ index }, mon === undefined ? [] : [{ kind: "party", answer: { index: mon } }]);
      return "";
    }
    if (this.#asking?.ask.kind === "party" && mon !== undefined) {
      this.#answer({ index: mon });
      return "";
    }
    return this.#do({ kind: "use-item", item, ...(mon === undefined ? {} : { mon }) });
  }
  makeLeader(mon: number): string {
    this.#do({ kind: "move-mon", from: mon, to: 0 });
    return "";
  }
  moveMon(from: number, to: number): void {
    this.#do({ kind: "move-mon", from, to });
  }
  moveMove(mon: number, from: number, to: number): void {
    this.#do({ kind: "move-move", mon, from, to });
  }
  moveItem(from: number, to: number): void {
    this.#do({ kind: "move-item", from, to });
  }
  sendOut(mon: number): string {
    this.#answer({ index: mon });
    return "";
  }
  throwBall(item: number): string {
    this.#answer({ index: this.#listIndex(item) });
    return "";
  }
  teach(item: number, mon: number): string {
    // One machine at a time: a second tap while the game is still on the first (its questions
    // may be up) would queue another round of them after it (QA bug 48).
    if (this.#teaching) return "";
    this.#teaching = true;
    void this.#act({ kind: "use-item", item, mon, answers: [true] }).then((r) => {
      this.#teaching = false;
      const text = said(r);
      if (text) this.#host.notice(text);
    });
    // Something at once: the game takes a moment to boot it up before any question (QA bug 47).
    return `Booting up ${itemName(this.#rom, item)}…`;
  }
  cut(mon: number): string {
    return this.#do({ kind: "cut", mon });
  }
  fieldMove(mon: number, move: FieldMove, on: { to?: number; target?: number } = {}): string {
    return this.#do({ kind: "field-move", move, mon, ...on });
  }
  deposit(mon: number): string {
    this.#answer({ index: mon });
    return "";
  }
  withdraw(box: number): string {
    this.#answer({ index: box });
    return "";
  }
  buy(item: number, count: number): string {
    if (this.#asking?.ask.kind === "mart") this.#answer({ index: this.#listIndex(item) }, buying(count), true);
    // The game is still on the last purchase: this one waits for its list.
    else if (this.#shop && this.#shopQueue !== "cancel") this.#shopQueue.push({ item, count });
    return "";
  }
  sell(item: number, count: number): string {
    // A sale goes straight back to the bag's list, with no words in between.
    this.#answer({ index: this.#listIndex(item) }, buying(count));
    return "";
  }
  gift(friend: string, what: { item: number } | { mon: number }): string {
    const send = this.#host.sendGift;
    if (!send) return "Gifts need you to be signed in and online.";
    void send(friend, what).then((text) => this.#host.notice(text));
    return "Waiting for a quiet moment in the game…";
  }
  ask(): string {
    return "Trades and battles start at a Pokémon Center's link desk for now.";
  }
  save(): string {
    void this.#act({ kind: "save" }).then((r) => this.#host.notice(r.ok ? "Saved!" : said(r) || "Couldn't save just now."));
    return "";
  }
  setOption<K extends keyof GameOptions>(key: K, value: GameOptions[K]): void {
    const now = this.#host.game?.options ?? 0;
    let next = now;
    if (key === "speed") next = (now & ~15) | { Fast: 1, Medium: 3, Slow: 5 }[value as GameOptions["speed"]];
    if (key === "animations") next = value ? now & ~0x80 : now | 0x80;
    if (key === "style") next = value === "Set" ? now | 0x40 : now & ~0x40;
    this.#do({ kind: "options", options: next });
  }
  setApp<K extends keyof AppOptions>(key: K, value: AppOptions[K]): void {
    this.#host.setApp(key, value);
  }
  goBack(): string {
    return "Going back to a checkpoint comes soon.";
  }
  cancel(): void {
    // Closing the shop while the game finishes a purchase: its list, when it comes, is closed.
    if (!this.#asking && this.#shop) this.#shopQueue = "cancel";
    this.#answer(null);
  }
  /** The bag index of an item (for the fallback sheet). */
  bagIndex(item: number): number {
    return this.#host.game?.bag.findIndex((b) => b.item === item) ?? -1;
  }
  /** Whether this question is still waiting for the menu's answer. */
  isAsking(id: number): boolean {
    return this.#asking?.id === id;
  }
  /** Forgets a question answered elsewhere (the fallback sheet). */
  answered(): void {
    this.#asking = null;
  }
  get rom(): Uint8Array {
    return this.#rom;
  }
}
