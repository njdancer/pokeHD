// Battles the journal can't see (QA bug 71). The journal marks a trainer beaten when the game runs
// EndTrainerBattle past its lost-battle check (DexGuard's onBeat), which is how every trainer on a
// route or in a gym's line-up ends. Gym leaders, Giovanni and the rival don't: their text script
// starts the battle and a map script of their own picks up after it (PewterGymBrockText, then
// PewterGymBrockPostBattle), and that script sets the game's own event flag for the win
// (SetEvent EVENT_BEAT_BROCK). So for them the Pokédex reads the game's wEventFlags, which the save
// keeps: a game that won before this existed shows it too.
//
// Event numbers are constants/event_constants.asm's (EVENT_x is bit x & 7 of byte x >> 3 of
// wEventFlags, the CheckEvent macro's arithmetic); npc is the object's index in the map's
// data/maps/objects file (as in PersonMet). battles.rom.test.ts checks both against the disassembly,
// and each npc against the ROM.
import { MAP_NAMES, SYMBOLS } from "@pokehd/rom";

/** wEventFlags (flag_array NUM_EVENTS) ends where wGrassRate starts. */
export const EVENT_FLAG_BYTES = SYMBOLS.wGrassRate.address - SYMBOLS.wEventFlags.address;

/** Whether event `n` is set in wEventFlags' bytes. */
export function eventSet(events: ArrayLike<number>, n: number): boolean {
  return (((events[n >> 3] ?? 0) >> (n & 7)) & 1) === 1;
}

export interface ScriptedBattle {
  map: number;
  npc: number;
  /** The event's name in constants/event_constants.asm, and its number. */
  name: string;
  event: number;
  /**
   * The flag says they fought, not who won: Oak's lab (EVENT_BATTLED_RIVAL_IN_OAKS_LAB is set win
   * or lose, and the story goes on either way).
   */
  foughtOnly?: true;
}

const at = (map: string, npc: number, name: string, event: number, foughtOnly?: true): ScriptedBattle => {
  const id = MAP_NAMES.indexOf(map);
  if (id < 0) throw new Error(`No map ${map}`);
  return { map: id, npc, name, event, ...(foughtOnly ? { foughtOnly } : {}) };
};

/**
 * Not here: Lorelei, Bruno and Agatha end through EndTrainerBattle like any trainer (the journal
 * sees them), and the SS Anne rival, whose win the game keeps no flag for.
 */
export const SCRIPTED_BATTLES: readonly ScriptedBattle[] = [
  at("PEWTER_GYM", 0, "EVENT_BEAT_BROCK", 119),
  at("CERULEAN_GYM", 0, "EVENT_BEAT_MISTY", 191),
  at("VERMILION_GYM", 0, "EVENT_BEAT_LT_SURGE", 359),
  at("CELADON_GYM", 0, "EVENT_BEAT_ERIKA", 425),
  at("FUCHSIA_GYM", 0, "EVENT_BEAT_KOGA", 601),
  at("SAFFRON_GYM", 0, "EVENT_BEAT_SABRINA", 865),
  at("CINNABAR_GYM", 0, "EVENT_BEAT_BLAINE", 665),
  at("VIRIDIAN_GYM", 0, "EVENT_BEAT_VIRIDIAN_GYM_GIOVANNI", 81),
  at("ROCKET_HIDEOUT_B4F", 0, "EVENT_BEAT_ROCKET_HIDEOUT_GIOVANNI", 1703),
  at("SILPH_CO_11F", 2, "EVENT_BEAT_SILPH_CO_GIOVANNI", 1935),
  at("LANCES_ROOM", 0, "EVENT_BEAT_LANCE", 2302),
  at("OAKS_LAB", 0, "EVENT_BATTLED_RIVAL_IN_OAKS_LAB", 35, true),
  at("ROUTE_22", 0, "EVENT_BEAT_ROUTE22_RIVAL_1ST_BATTLE", 1317),
  at("ROUTE_22", 1, "EVENT_BEAT_ROUTE22_RIVAL_2ND_BATTLE", 1318),
  at("CERULEAN_CITY", 0, "EVENT_BEAT_CERULEAN_RIVAL", 152),
  at("POKEMON_TOWER_2F", 0, "EVENT_BEAT_POKEMON_TOWER_RIVAL", 241),
  at("SILPH_CO_7F", 8, "EVENT_BEAT_SILPH_CO_RIVAL", 1856),
  at("CHAMPIONS_ROOM", 0, "EVENT_BEAT_CHAMPION_RIVAL", 2305),
];

const byPerson = new Map(SCRIPTED_BATTLES.map((b) => [`${b.map}:${b.npc}`, b]));

/**
 * How the game remembers a scripted battle with this person: "beaten", "fought" (Oak's lab, either
 * way), null for not yet, or undefined when they're not one.
 */
export function scriptedOutcome(map: number, npc: number, events: ArrayLike<number>): "beaten" | "fought" | null | undefined {
  const battle = byPerson.get(`${map}:${npc}`);
  if (!battle) return undefined;
  if (!eventSet(events, battle.event)) return null;
  return battle.foughtOnly ? "fought" : "beaten";
}
