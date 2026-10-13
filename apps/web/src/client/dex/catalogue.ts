// What the Pokédex knows: the game's own Pokédex (species seen and caught, from wPokedexSeen and
// wPokedexOwned) plus a journal of our own, kept beside the save, of the places visited and the
// people met. Species, places and people are described from the ROM (packages/rom dex.ts).
import {
  dexEntries,
  MAP_NAMES,
  SPRITE_NAMES,
  townMapPlace,
  trainerClasses,
  wildAreas,
  type DexEntry,
  type TrainerClass,
  type WorldData,
} from "@pokehd/rom";

/** The Pokédex's state: what the game knows, and our journal. */
export interface DexProgress {
  /** Pokédex numbers. */
  seen: ReadonlySet<number>;
  owned: ReadonlySet<number>;
  /** Not caught, but the game is showing their full page (Oak's starters). */
  onShow?: ReadonlySet<number>;
  /** Maps visited, oldest first, with when (ms since 1970). */
  places: readonly { map: number; at: number }[];
  people: readonly PersonMet[];
  /** The rival's name, as the player chose it. */
  rival?: string;
}

/** Someone the player talked to or battled. */
export interface PersonMet {
  map: number;
  /** Index into the map's NPCs. */
  npc: number;
  at: number;
  /** The first thing they said, as the text box showed it. */
  said?: string;
  /** For trainers: beaten in battle. */
  beaten?: boolean;
}

/** A town or route on the town map, grouping its buildings and caves. */
export interface Place {
  name: string;
  /** Cell on the 20×18 town map. */
  x: number;
  y: number;
  maps: number[];
  /** Wild Pokémon here (Pokédex numbers), in grass or caves and on water. */
  grass: number[];
  water: number[];
}

export interface Person {
  key: string;
  map: number;
  npc: number;
  sprite: number;
  name: string;
  /** A trainer's class, for their battle picture. */
  trainer?: TrainerClass;
}

export interface Catalogue {
  entries: DexEntry[];
  /** By Pokédex number: the places each lives. */
  homes: Map<number, Place[]>;
  places: Place[];
  /** Which place a map belongs to. */
  placeOf(map: number): Place | undefined;
  person(map: number, npc: number): Person | undefined;
}

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/(^|[ .])([a-zé])/g, (_m, a: string, b: string) => a + b.toUpperCase());

/** Names for the people whose sprite says who they are; the rest are named by their look. */
const NAMED: Record<string, string> = {
  OAK: "Prof. Oak",
  MOM: "Mom",
  BLUE: "Rival",
  DAISY: "Daisy",
  NURSE: "Nurse Joy",
  CLERK: "Shop clerk",
  MR_FUJI: "Mr. Fuji",
  GIOVANNI: "Giovanni",
  LANCE: "Lance",
  BRUNO: "Bruno",
  LORELEI: "Lorelei",
  AGATHA: "Agatha",
  BILL: "Bill",
  GAMBLER_ASLEEP: "Sleepy old man",
  LINK_RECEPTIONIST: "Link Club desk",
  GYM_GUIDE: "Gym guide",
};

export function buildCatalogue(rom: Uint8Array, world: WorldData): Catalogue {
  const entries = dexEntries(rom);
  const dexOf = new Map(entries.map((e) => [e.species, e.dex]));
  const byName = new Map<string, Place>();
  const placeByMap = new Map<number, Place>();
  for (let map = 0; map < MAP_NAMES.length; map++) {
    if (!MAP_NAMES[map] || !world.maps[map]) continue;
    const spot = townMapPlace(rom, map);
    let place = byName.get(spot.name);
    if (!place) byName.set(spot.name, (place = { name: titleCase(spot.name), x: spot.x, y: spot.y, maps: [], grass: [], water: [] }));
    place.maps.push(map);
    placeByMap.set(map, place);
  }
  const homes = new Map<number, Place[]>();
  for (const area of wildAreas(rom)) {
    const place = placeByMap.get(area.map);
    if (!place) continue;
    const add = (list: number[], species: number) => {
      const dex = dexOf.get(species);
      if (!dex || list.includes(dex)) return;
      list.push(dex);
      const at = homes.get(dex) ?? [];
      if (!at.includes(place)) at.push(place);
      homes.set(dex, at);
    };
    for (const s of area.grass) add(place.grass, s.species);
    for (const s of area.water) add(place.water, s.species);
  }
  const classes = trainerClasses(rom);
  return {
    entries,
    homes,
    places: [...byName.values()],
    placeOf: (map) => placeByMap.get(map),
    person(map, npc) {
      const o = world.maps[map]?.npcs[npc];
      if (!o || (o.kind !== "person" && o.kind !== "trainer")) return undefined;
      const sprite = SPRITE_NAMES[o.sprite] ?? "";
      const trainer = o.kind === "trainer" ? classes[o.trainerClass - 1] : undefined;
      const name = trainer ? (trainer.name.startsWith("RIVAL") ? "Rival" : titleCase(trainer.name)) : (NAMED[sprite] ?? titleCase(sprite));
      return { key: `${map}:${npc}`, map, npc, sprite: o.sprite, name, trainer };
    },
  };
}

/** Height and weight the way the game prints them: 2′04″ and 15.0 lb. */
export function heightText(e: DexEntry): string {
  return `${e.heightFeet}′${String(e.heightInches).padStart(2, "0")}″`;
}
export function weightText(e: DexEntry): string {
  return `${(e.weightTenths / 10).toFixed(1)} lb`;
}
export const dexNo = (dex: number) => String(dex).padStart(3, "0");
export const niceName = titleCase;
