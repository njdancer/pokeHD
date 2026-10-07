// Test-only: two players' Game Boys scripted from a new game to the Cable Club and through a
// trade or a battle, reproducing the p3-link spike's checks. Shared by the in-process link test
// and the room test in apps/web (p3-link-net); the transport between the two LinkPorts is the
// caller's. Test setup (party, Pokédex flag, a warp to Viridian's Pokémon Center) goes through
// WRAM; from the first A press at the receptionist on, it's the game's own code.
import { existsSync, readFileSync } from "node:fs";
import { romOffset } from "@pokehd/rom";
import { parseSym } from "../../../tools/gen-symbols.ts";
import { Button, FRAME_RATE, GameBoy } from "./core.ts";

const ROM_PATH = new URL("../../../rom/pokeblue.gb", import.meta.url);
const SYM_PATH = new URL("../../../vendor/pokered/pokeblue.sym", import.meta.url);
const WASM_PATH = new URL("./generated/sameboy.wasm", import.meta.url);
export const linkScenarioReady = existsSync(ROM_PATH) && existsSync(SYM_PATH);

const MAP = { VIRIDIAN_POKECENTER: 0x29, TRADE_CENTER: 0xef, COLOSSEUM: 0xf0 };
const SPECIES = { KADABRA: 0x26, PIKACHU: 0x54, EEVEE: 0x66, CHARMANDER: 0xb0 };
const PARTY_MON_SIZE = 44;

export interface Player {
  name: string;
  id: number;
  mons: { species: number; level: number }[];
}
export const PLAYERS: [Player, Player] = [
  { name: "ALICE", id: 0x1111, mons: [{ species: SPECIES.PIKACHU, level: 30 }, { species: SPECIES.KADABRA, level: 25 }] },
  { name: "BOB", id: 0x2222, mons: [{ species: SPECIES.EEVEE, level: 30 }, { species: SPECIES.CHARMANDER, level: 25 }] },
];

/** Test-only symbols straight from the disassembly (the app's allowlist stays small). */
let sym: Map<string, { bank: number; address: number }>;
const A = (name: string) => {
  const s = sym.get(name);
  if (!s) throw new Error(`No symbol ${name}`);
  return s.address;
};
const r = (gb: GameBoy, name: string) => gb.read(A(name));

/** Charmap encoding for A–Z, a–z and space, terminated by `@` ($50). */
const encodeName = (s: string) =>
  [...s].map((c) => (c === " " ? 0x7f : c >= "a" ? 0xa0 + c.charCodeAt(0) - 97 : 0x80 + c.charCodeAt(0) - 65)).concat(0x50);

/** Experience at a level for each growth rate (constants/pokemon_data_constants.asm). */
const expForLevel = (rate: number, n: number) =>
  [n ** 3, 0, 0, Math.floor((6 * n ** 3) / 5) - 15 * n * n + 100 * n - 140, Math.floor((4 * n ** 3) / 5), Math.floor((5 * n ** 3) / 4)][rate] ?? 0;

/** A valid party struct from the ROM's own base stats and moves. */
export function makeParty(rom: Uint8Array, mons: Player["mons"], otId: number) {
  const at = (name: string) => romOffset(sym.get(name)!);
  const byte = (offset: number) => rom[offset] ?? 0;
  return mons.map(({ species, level }) => {
    const base = at("BaseStats") + (byte(at("PokedexOrder") + species - 1) - 1) * 28;
    const stat = (k: number) => Math.floor((byte(base + k) * 2 * level) / 100) + 5;
    const hp = Math.floor((byte(base + 1) * 2 * level) / 100) + level + 10;
    const moves = [...rom.subarray(base + 15, base + 19)];
    const pp = moves.map((mv) => (mv ? byte(at("Moves") + (mv - 1) * 6 + 5) : 0));
    const exp = expForLevel(byte(base + 19), level);
    const s = new Uint8Array(PARTY_MON_SIZE);
    s.set([species, hp >> 8, hp & 255, level, 0, byte(base + 6), byte(base + 7), byte(base + 8)]);
    s.set(moves, 8);
    s.set([otId >> 8, otId & 255, exp >> 16, (exp >> 8) & 255, exp & 255], 12);
    s.set(pp, 29);
    s.set([level, hp >> 8, hp & 255], 33);
    [2, 3, 4, 5].forEach((k, n) => s.set([stat(k) >> 8, stat(k) & 255], 36 + n * 2));
    const nameAt = at("MonsterNames") + (species - 1) * 10;
    const name = [...rom.subarray(nameAt, nameAt + 10)];
    const end = name.indexOf(0x50);
    return { struct: s, nick: [...name.slice(0, end < 0 ? 10 : end), 0x50] };
  });
}

export function giveParty(gb: GameBoy, rom: Uint8Array, p: Player, mons: Player["mons"]) {
  const party = makeParty(rom, mons, p.id);
  const ot = encodeName(p.name);
  gb.write(A("wPartyCount"), party.length);
  party.forEach((m, n) => gb.write(A("wPartySpecies") + n, m.struct[0]!));
  gb.write(A("wPartySpecies") + party.length, 0xff);
  party.forEach((m, n) => {
    m.struct.forEach((v, k) => gb.write(A("wPartyMons") + n * PARTY_MON_SIZE + k, v));
    ot.forEach((v, k) => gb.write(A("wPartyMonOT") + n * 11 + k, v));
    m.nick.forEach((v, k) => gb.write(A("wPartyMonNicks") + n * 11 + k, v));
  });
}

const frames = (gb: GameBoy, n: number) => {
  for (let i = 0; i < n; i++) gb.runFrame();
};
function walk(gb: GameBoy, path: [number, number][]) {
  for (const [button, steps] of path) {
    for (let i = 0; i < steps; i++) {
      gb.setButtons(button);
      frames(gb, 4);
      gb.setButtons(0);
      frames(gb, 16);
    }
  }
}
const position = (gb: GameBoy) => [r(gb, "wCurMap"), r(gb, "wXCoord"), r(gb, "wYCoord")];

/** Mashes A (with the odd Down and Start) through the intro until the overworld loop runs. */
function playIntro(gb: GameBoy) {
  let reached = false;
  const remove = gb.addHook("OverworldLoop", () => (reached = true));
  for (let f = 0; !reached && f < 20_000; f++) {
    const press = f % 64 < 8 ? Button.Down : f % 512 < 8 ? Button.Start : Button.A;
    gb.setButtons(f % 8 < 2 ? press : 0);
    gb.runFrame();
  }
  remove();
  gb.setButtons(0);
  frames(gb, 60);
}

/**
 * From Red's room: a name, ID, party and the Pokédex flag the receptionist checks, then the
 * stairs' warp repointed at Viridian's Pokémon Center and a walk to the link receptionist.
 */
function prepare(gb: GameBoy, rom: Uint8Array, p: Player) {
  // CableClubNPC: ld hl, text; call PrintText; ld a, [flags]; bit b, a
  const npc = romOffset(sym.get("CableClubNPC")!);
  if (rom[npc + 6] !== 0xfa || rom[npc + 9] !== 0xcb) throw new Error("Unexpected CableClubNPC");
  const flag = rom[npc + 7]! | (rom[npc + 8]! << 8);
  gb.write(flag, gb.read(flag) | (1 << ((rom[npc + 10]! >> 3) & 7)));
  encodeName(p.name).forEach((v, k) => gb.write(A("wPlayerName") + k, v));
  gb.write(A("wPlayerID"), p.id >> 8);
  gb.write(A("wPlayerID") + 1, p.id & 255);
  giveParty(gb, rom, p, p.mons);
  gb.write(A("wWarpEntries") + 2, 0);
  gb.write(A("wWarpEntries") + 3, MAP.VIRIDIAN_POKECENTER);
  walk(gb, [[Button.Down, 1], [Button.Right, 2], [Button.Up, 6], [Button.Right, 3]]);
  frames(gb, 60);
  walk(gb, [[Button.Up, 3], [Button.Right, 8], [Button.Up, 1]]);
  frames(gb, 30);
  const at = position(gb).join();
  if (at !== [MAP.VIRIDIAN_POKECENTER, 11, 3].join()) throw new Error(`Not at the receptionist: ${at}`);
}

export function screenHas(gb: GameBoy, text: string) {
  const tiles = [...gb.readBytes(A("wTileMap"), 360)].join();
  return tiles.includes(encodeName(text).slice(0, -1).join());
}
const party = (gb: GameBoy) => [...gb.readBytes(A("wPartySpecies"), r(gb, "wPartyCount"))];
const partyMon = (gb: GameBoy, n: number) => [...gb.readBytes(A("wPartyMons") + n * PARTY_MON_SIZE, PARTY_MON_SIZE)];
const word = (gb: GameBoy, name: string) => (r(gb, name) << 8) | gb.read(A(name) + 1);

// Input scripts: each yields [buttons, frames] to hold. Presses are held 6 frames, as a person
// does: menus poll the joypad only every few frames.
type Script = Generator<[number, number], void, void>;
function* tap(button: number, hold = 6, gap = 6): Script {
  yield [button, hold];
  yield [0, gap];
}
function* mashUntil(done: () => boolean, button: number = Button.A, limit = 6000): Script {
  for (let n = 0; !done(); n++) {
    if (n > limit) throw new Error("mash timeout");
    yield* tap(button);
  }
}
function* waitUntil(done: () => boolean, limit = 20_000): Script {
  for (let n = 0; !done(); n++) {
    if (n > limit) throw new Error("wait timeout");
    yield [0, 1];
  }
}

export type Kind = "trade" | "battle";
export interface Result {
  party?: number[];
  received?: number[];
  hp?: [number, number];
}

function* side(gb: GameBoy, p: 0 | 1, kind: Kind, result: Result): Script {
  if (p === 1) yield [0, 30]; // the second player walks up a little later
  // Talk and save (YES). Stop pressing once the link menu's question prints: an early A would
  // pick the first room. Whoever presses A first decides for both.
  yield* mashUntil(() => screenHas(gb, "Where would"));
  yield* waitUntil(() => screenHas(gb, "COLOSSEUM"));
  yield [0, 30];
  if (kind === "battle") yield* mashUntil(() => r(gb, "wCurrentMenuItem") === 1, Button.Down, 600);
  const room = kind === "trade" ? MAP.TRADE_CENTER : MAP.COLOSSEUM;
  yield* mashUntil(() => r(gb, "wCurMap") === room);
  yield [0, 60];
  // Face the table (the master sits on the left) and press A on our Game Boy.
  const master = r(gb, "hSerialConnectionStatus") === 2;
  yield* tap(master ? Button.Right : Button.Left, 8, 20);
  yield* mashUntil(() => r(gb, "wLinkState") !== 1, Button.A, 200);
  if (kind === "trade") {
    const before = party(gb).join();
    const inTradeMenu = () => r(gb, "wCurMap") === MAP.TRADE_CENTER && screenHas(gb, "CANCEL");
    yield* waitUntil(inTradeMenu);
    yield [0, 30];
    yield* tap(Button.A); // our first mon: STATS / TRADE
    yield [0, 20];
    yield* tap(Button.Right);
    yield* tap(Button.A); // TRADE
    yield [0, 20];
    yield* mashUntil(() => party(gb).join() !== before, Button.A, 4000); // confirm, watch it
    yield* mashUntil(inTradeMenu, Button.A, 4000); // "Trade completed!", back at the menu
    result.party = party(gb);
    result.received = partyMon(gb, 1);
  } else {
    yield* mashUntil(() => r(gb, "wIsInBattle") !== 0);
    yield* mashUntil(
      () => {
        if (r(gb, "wIsInBattle")) result.hp = [word(gb, "wBattleMonHP"), word(gb, "wEnemyMonHP")];
        return r(gb, "wIsInBattle") === 0;
      },
      Button.A,
      20_000,
    );
  }
}

/** Both Game Boys standing at the link receptionist, and a way back there for each run. */
export async function setupLinkScenario() {
  sym = parseSym(readFileSync(SYM_PATH, "utf8"));
  const rom = new Uint8Array(readFileSync(ROM_PATH));
  const wasmBinary = readFileSync(WASM_PATH);
  const gbs: [GameBoy, GameBoy] = [await GameBoy.create({ rom, wasmBinary }), await GameBoy.create({ rom, wasmBinary })];
  playIntro(gbs[0]);
  gbs[1].loadState(gbs[0].saveState());
  PLAYERS.forEach((p, i) => prepare(gbs[i as 0 | 1], rom, p));
  const start = [gbs[0].saveState(), gbs[1].saveState()];
  /** Back to the receptionist; battles use one mon each so no switch menu is needed. */
  const reset = (kind: Kind) => {
    gbs.forEach((gb, i) => {
      gb.loadState(start[i]!);
      const p = PLAYERS[i as 0 | 1];
      giveParty(gb, rom, p, kind === "trade" ? p.mons : p.mons.slice(0, 1));
    });
  };
  return { gbs, rom, reset };
}

/**
 * Runs both games' scripts against one simulated wall clock, a frame at a time. `step` runs
 * before each frame with the clock in ms: deliver whatever has arrived by then.
 */
export async function runLink(gbs: [GameBoy, GameBoy], kind: Kind, step: (now: number) => void | Promise<void>) {
  const frameMs = 1000 / FRAME_RATE;
  let now = 0;
  const results: [Result, Result] = [{}, {}];
  const scripts = gbs.map((gb, i) => side(gb, i as 0 | 1, kind, results[i]!));
  const hold = [0, 0];
  const done = [false, false];
  for (let frame = 0; !(done[0] && done[1]); frame++) {
    if (frame > 60 * 600) throw new Error("Link run timed out");
    await step(now);
    for (const i of [0, 1] as const) {
      const gb = gbs[i];
      gb.runFrame();
      if (done[i] || --hold[i]! > 0) continue;
      const next = scripts[i]!.next();
      if (next.done) {
        done[i] = true;
        gb.setButtons(0);
      } else {
        gb.setButtons(next.value[0]);
        hold[i] = next.value[1];
      }
    }
    now += frameMs;
  }
  return { results, seconds: now / 1000 };
}
