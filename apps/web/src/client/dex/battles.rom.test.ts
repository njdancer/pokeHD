// The leaders' and rival's battles, from the game's event flags (QA bug 71). The table's numbers
// and objects are checked against the disassembly (skipped without vendor/pokered), its people
// against the ROM, and the Pokédex menu's People against a game that beat Brock, Misty and the
// rival in Cerulean (skipped without the ROM).
import { existsSync, readFileSync } from "node:fs";
import { decodeSnapshot, SNAPSHOT_RANGES } from "@pokehd/emu";
import { MAP_NAMES, parseWorld, SPRITE_NAMES, SYMBOLS, trainerClasses } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { liveModel } from "../menu/live.ts";
import { PlayJournal } from "../menu/journal.ts";
import { EVENT_FLAG_BYTES, eventSet, SCRIPTED_BATTLES, scriptedOutcome } from "./battles.ts";
import { buildCatalogue } from "./catalogue.ts";

const ROM_PATH = new URL("../../../../../rom/pokeblue.gb", import.meta.url);
const VENDOR = new URL("../../../../../vendor/pokered/", import.meta.url);
const id = (name: string) => MAP_NAMES.indexOf(name);
const battle = (name: string) => SCRIPTED_BATTLES.find((b) => b.name === name)!;

/** wEventFlags with these events set. */
function flags(...events: number[]): Uint8Array {
  const bytes = new Uint8Array(EVENT_FLAG_BYTES);
  for (const n of events) bytes[n >> 3]! |= 1 << (n & 7);
  return bytes;
}

describe("event flags", () => {
  it("are NUM_EVENTS ($A00) bits", () => {
    expect(EVENT_FLAG_BYTES).toBe(0xa00 / 8);
    expect(SNAPSHOT_RANGES.at(-1)).toEqual([SYMBOLS.wEventFlags.address, EVENT_FLAG_BYTES]);
  });

  it("put event n at bit n & 7 of byte n >> 3, as CheckEvent does", () => {
    // EVENT_BEAT_ROUTE_3_TRAINER_2 (996) is bit 4 of wEventFlags + $7c (trainer-engage.rom.test.ts).
    const bytes = new Uint8Array(EVENT_FLAG_BYTES);
    bytes[0x7c] = 1 << 4;
    expect(eventSet(bytes, 996)).toBe(true);
    expect(eventSet(bytes, 995)).toBe(false);
    expect(eventSet(bytes, 997)).toBe(false);
    // EVENT_BEAT_BROCK (119) is bit 7 of byte $0e.
    expect(eventSet(Uint8Array.of(...new Array(14).fill(0), 0x80), 119)).toBe(true);
  });

  it("say who was beaten, fought or not yet", () => {
    const brock = battle("EVENT_BEAT_BROCK");
    const lab = battle("EVENT_BATTLED_RIVAL_IN_OAKS_LAB");
    const events = flags(brock.event, lab.event);
    expect(scriptedOutcome(brock.map, brock.npc, events)).toBe("beaten");
    expect(scriptedOutcome(lab.map, lab.npc, events)).toBe("fought");
    const misty = battle("EVENT_BEAT_MISTY");
    expect(scriptedOutcome(misty.map, misty.npc, events)).toBeNull();
    // Brock's gym's trainer (npc 1) isn't scripted: the journal's beat hook sees him.
    expect(scriptedOutcome(brock.map, 1, events)).toBeUndefined();
  });
});

describe.skipIf(!existsSync(new URL("constants/event_constants.asm", VENDOR)))("against the disassembly", () => {
  /** constants/event_constants.asm, by the const macros (macros/const.asm). */
  function eventConstants(): Map<string, number> {
    const out = new Map<string, number>();
    let value = 0;
    const num = (s: string) => Number.parseInt(s.replace(/^\$/, ""), s.startsWith("$") ? 16 : 10);
    for (const raw of readFileSync(new URL("constants/event_constants.asm", VENDOR), "utf8").split("\n")) {
      const line = raw.replace(/;.*/, "").trim();
      let m: RegExpMatchArray | null;
      if ((m = line.match(/^const_def\s*(\S*)/))) value = m[1] ? num(m[1]) : 0;
      else if ((m = line.match(/^const_skip\s*(\S*)/))) value += m[1] ? num(m[1]) : 1;
      else if ((m = line.match(/^const_next\s+(\S+)/))) value = num(m[1]!);
      else if ((m = line.match(/^const\s+(\w+)/))) out.set(m[1]!, value++);
    }
    return out;
  }

  it("has each event's number", () => {
    const events = eventConstants();
    for (const b of SCRIPTED_BATTLES) expect([b.name, events.get(b.name)]).toEqual([b.name, b.event]);
  });

  it("names each map's leader or rival object", () => {
    for (const b of SCRIPTED_BATTLES) {
      const file = MAP_NAMES[b.map]!.toLowerCase().replace(/(^|_)([a-z0-9])/g, (_m, _u, c: string) => c.toUpperCase());
      const objects = readFileSync(new URL(`data/maps/objects/${file}.asm`, VENDOR), "utf8")
        .split("\n")
        .filter((l) => /^\s*object_event\b/.test(l));
      expect([b.name, objects[b.npc]]).toEqual([b.name, expect.stringMatching(/SPRITE_BLUE|OPP_(BROCK|MISTY|LT_SURGE|ERIKA|KOGA|SABRINA|BLAINE|GIOVANNI|LANCE)\b/)]);
    }
  });
});

describe.skipIf(!existsSync(ROM_PATH))("in the ROM", () => {
  const rom = existsSync(ROM_PATH) ? new Uint8Array(readFileSync(ROM_PATH)) : new Uint8Array(0);

  it("each battle is with the map's leader or the rival", () => {
    const world = parseWorld(rom);
    const classes = trainerClasses(rom);
    for (const b of SCRIPTED_BATTLES) {
      const npc = world.maps[b.map]?.npcs[b.npc];
      const who = npc?.kind === "trainer" ? classes[npc.trainerClass - 1]?.name : npc ? SPRITE_NAMES[npc.sprite] : undefined;
      expect([b.name, who]).toEqual([b.name, expect.stringMatching(/^(BLUE|RIVAL\d|BROCK|MISTY|LT\.SURGE|ERIKA|KOGA|SABRINA|BLAINE|GIOVANNI|LANCE)$/)]);
    }
  });

  it("People shows Brock, Misty and the Cerulean rival beaten from the save's flags (QA bug 71)", () => {
    const world = parseWorld(rom);
    const catalogue = buildCatalogue(rom, world);
    // Met, but the journal never saw them beaten: their battles don't end in EndTrainerBattle.
    const journal = PlayJournal.memory();
    const met = [["OAKS_LAB", 0], ["PEWTER_GYM", 0], ["CERULEAN_CITY", 0], ["CERULEAN_GYM", 0], ["ROUTE_22", 0], ["PEWTER_GYM", 1]] as const;
    for (const [map, npc] of met) journal.met(id(map), npc);
    // A gym trainer the journal did see beaten.
    journal.beat(id("CERULEAN_GYM"), 1);
    // As in QA bug 71's save: Boulder and Cascade badges, the lab and Cerulean rival battles.
    const bytes: Uint8Array[] = SNAPSHOT_RANGES.map(([, n]) => new Uint8Array(n));
    bytes[SNAPSHOT_RANGES.findIndex(([a]) => a === SYMBOLS.wObtainedBadges.address)]![0] = 0b11;
    bytes[bytes.length - 1] = flags(...["EVENT_BATTLED_RIVAL_IN_OAKS_LAB", "EVENT_BEAT_BROCK", "EVENT_BEAT_CERULEAN_RIVAL", "EVENT_BEAT_MISTY"].map((n) => battle(n).event));
    const game = decodeSnapshot(bytes);
    const model = liveModel({ rom, world, catalogue, game, journal, friends: [], savedAt: 0, app: { sound: false, readAloud: false, gameBoyScreen: false } });
    const status = (map: string, npc: number) => model.people.find((p) => p.key === `${id(map)}:${npc}`);
    expect(status("PEWTER_GYM", 0)).toMatchObject({ name: "Brock", kind: "Leader", status: "Beaten", beaten: true });
    expect(status("CERULEAN_GYM", 0)).toMatchObject({ name: "Misty", kind: "Leader", status: "Beaten", beaten: true });
    expect(status("CERULEAN_CITY", 0)).toMatchObject({ name: "Rival", kind: "Leader", status: "Beaten", beaten: true });
    expect(status("OAKS_LAB", 0)).toMatchObject({ name: "Rival", kind: "Leader", status: "Battled" });
    expect(status("OAKS_LAB", 0)?.beaten).toBeUndefined();
    expect(status("ROUTE_22", 0)).toMatchObject({ name: "Rival", kind: "Leader", status: "Not beaten yet" });
    expect(status("PEWTER_GYM", 1)).toMatchObject({ kind: "Trainer", status: "Not beaten yet" });
    expect(status("CERULEAN_GYM", 1)).toMatchObject({ kind: "Trainer", status: "Beaten", beaten: true });
  });
});
