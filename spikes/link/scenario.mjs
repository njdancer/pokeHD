// Throwaway: get two games to the Cable Club and script a trade or a battle on both sides.
import { readFileSync } from 'node:fs';
import * as L from './lib.mjs';

const { K } = L;
const MAP = { REDS_HOUSE_2F: 0x26, VIRIDIAN_POKECENTER: 0x29, TRADE_CENTER: 0xef, COLOSSEUM: 0xf0 };
const SPECIES = { NIDOKING: 0x07, GENGAR: 0x0e, KADABRA: 0x26, PIKACHU: 0x54, EEVEE: 0x66, MACHAMP: 0x7e, BULBASAUR: 0x99, CHARMANDER: 0xb0, SQUIRTLE: 0xb1 };
export const PLAYERS = [
  { name: 'ALICE', id: 0x1111, mons: [{ species: SPECIES.PIKACHU, level: 30 }, { species: SPECIES.KADABRA, level: 25 }] },
  { name: 'BOB', id: 0x2222, mons: [{ species: SPECIES.EEVEE, level: 30 }, { species: SPECIES.CHARMANDER, level: 25 }] },
];

export class Rig {
  constructor(m, sym, rom) { Object.assign(this, { m, sym, rom }); }
  A(s) { return this.sym[s].addr; }
  r(i, s) { return this.m._h_read(i, typeof s === 'string' ? this.A(s) : s); }
  pos(i) { return { map: this.r(i, 'wCurMap'), x: this.r(i, 'wXCoord'), y: this.r(i, 'wYCoord') }; }
  // Run one core alone, frame by frame (setup only: there is no partner on the cable yet).
  frames(i, n = 1) {
    for (let k = 0; k < n; k++) { const f = this.m._h_frames(i); while (this.m._h_frames(i) === f) { this.m._h_run(i, 4096); if (this.m._h_stopped()) throw new Error('transfer during setup'); } }
  }
  step(i, key) { this.m._h_keys(i, key); this.frames(i, 4); this.m._h_keys(i, 0); this.frames(i, 16); }
  walk(i, path) { for (const [key, n] of path) for (let c = 0; c < n; c++) this.step(i, key); }

  // From a fresh game in Red's room: give a party and the Pokédex flag, repoint the stairs'
  // warp at Viridian's Pokémon Center and walk to the link receptionist (11,3), facing up.
  // This is test setup through WRAM; everything from talking to the receptionist on is the
  // game's own code.
  prepare(i, p) {
    const { m, sym, rom } = this;
    const npc = L.romOffset(sym.CableClubNPC); // ld hl,text; call PrintText; ld a,[flags]; bit b,a
    if (rom[npc + 6] !== 0xfa || rom[npc + 9] !== 0xcb) throw new Error('unexpected CableClubNPC');
    const flagAddr = rom[npc + 7] | (rom[npc + 8] << 8), bit = (rom[npc + 10] >> 3) & 7;
    m._h_write(i, flagAddr, this.r(i, flagAddr) | (1 << bit));
    const name = L.encodeName(p.name);
    name.forEach((v, k) => m._h_write(i, this.A('wPlayerName') + k, v));
    m._h_write(i, this.A('wPlayerID'), p.id >> 8); m._h_write(i, this.A('wPlayerID') + 1, p.id & 255);
    this.giveParty(i, p, p.mons);
    const we = this.A('wWarpEntries'); m._h_write(i, we + 2, 0); m._h_write(i, we + 3, MAP.VIRIDIAN_POKECENTER);
    this.walk(i, [[K.down, 1], [K.right, 2], [K.up, 6], [K.right, 3]]);
    this.frames(i, 60);
    this.walk(i, [[K.up, 3], [K.right, 8], [K.up, 1]]);
    this.frames(i, 30);
    const at = this.pos(i);
    if (at.map !== MAP.VIRIDIAN_POKECENTER || at.x !== 11 || at.y !== 3) throw new Error(`core ${i} at ${JSON.stringify(at)}`);
  }
  // Screen-driven checks: look for text in the 20x18 tilemap.
  screenHas(i, text) {
    const base = this.A('wTileMap'), want = L.encodeName(text).slice(0, -1);
    const row = Array.from({ length: 360 }, (_, k) => this.r(i, base + k));
    outer: for (let k = 0; k + want.length <= 360; k++) { for (let j = 0; j < want.length; j++) if (row[k + j] !== want[j]) continue outer; return true; }
    return false;
  }
  inLinkMenu(i) { return this.screenHas(i, 'COLOSSEUM'); }
  inTradeMenu(i) { return this.r(i, 'wCurMap') === MAP.TRADE_CENTER && this.screenHas(i, 'CANCEL'); }
  giveParty(i, p, mons) {
    L.writeParty(this.m, i, this.sym, L.makeParty(this.rom, this.sym, mons, p.id), L.encodeName(p.name));
  }
  partyStructs(i) {
    return Array.from({ length: this.r(i, 'wPartyCount') }, (_, n) => Array.from({ length: 44 }, (_, k) => this.r(i, this.A('wPartyMons') + n * 44 + k)));
  }
  battleHp(i) {
    const w = (s) => (this.r(i, s) << 8) | this.r(i, this.A(s) + 1);
    return [w('wBattleMonHP'), w('wEnemyMonHP')];
  }
  party(i) {
    const n = this.r(i, 'wPartyCount');
    return Array.from({ length: n }, (_, k) => this.r(i, this.A('wPartySpecies') + k));
  }
}

// Input scripts. Each is a generator over one core: yield [keys, frames] holds keys for that
// many of that core's frames (frames pause while the core is stalled on the cable).
// Presses are held 6 frames, as a person does: menus poll the joypad only every few frames.
const tap = (key, hold = 6, gap = 6) => [[key, hold], [0, gap]];
function* mashUntil(cond, key = K.A, limit = 6000) {
  for (let n = 0; !cond(); n++) { if (n > limit) throw new Error('mash timeout'); yield* tap(key); }
}
function* waitUntil(cond, limit = 20000) {
  for (let n = 0; !cond(); n++) { if (n > limit) throw new Error('wait timeout'); yield [0, 1]; }
}

// Trades swap each side's first mon (two each); battles are one mon a side, so the only input
// a battle needs is A (FIGHT, first move) until one side faints.
// `cores[p]` is the core player p's script watches (with four cores, each client runs both
// Game Boys and player p's own one is the one their script reads).
export function scripts(rig, kind, { delayFrames = 30, cores = [0, 1] } = {}) {
  for (let c = 0; c < (cores[1] > 1 ? 4 : 2); c++) { const p = PLAYERS[c % 2]; rig.giveParty(c, p, kind === 'trade' ? p.mons : p.mons.slice(0, 1)); }
  rig.result = {};
  const room = kind === 'trade' ? MAP.TRADE_CENTER : MAP.COLOSSEUM;
  const r = (i, s) => rig.r(i, s);
  function* side(p) {
    const i = cores[p];
    if (p === 1) yield [0, delayFrames]; // the second player walks up a little later
    // Talk to the receptionist and save (YES). Stop pressing A once the link menu's question
    // starts printing: an early A would pick the first room. Whoever presses A first decides
    // for both (the game's rule), so both scripts pick the same room.
    yield* mashUntil(() => rig.screenHas(i, 'Where would'));
    yield* waitUntil(() => rig.inLinkMenu(i));
    yield [0, 30];
    // The menu only reads the joypad between link exchanges, so a press can be missed while the
    // partner is slow: keep pressing until the cursor is on COLOSSEUM, as a player would.
    if (kind === 'battle') yield* mashUntil(() => r(i, 'wCurrentMenuItem') === 1, K.down, 600);
    yield* mashUntil(() => r(i, 'wCurMap') === room);
    yield [0, 60];
    // Face the table (master sits left, slave right) and press A on our Game Boy.
    const master = r(i, 'hSerialConnectionStatus') === 2;
    yield* tap(master ? K.right : K.left, 8, 20);
    yield* mashUntil(() => r(i, 'wLinkState') !== 1, K.A, 200);
    const before = rig.party(i).join();
    if (kind === 'trade') {
      yield* waitUntil(() => rig.inTradeMenu(i));
      yield [0, 30];
      yield* tap(K.A); yield [0, 20]; // our first mon -> STATS / TRADE
      yield* tap(K.right); yield* tap(K.A); yield [0, 20]; // TRADE
      yield* mashUntil(() => rig.party(i).join() !== before, K.A, 4000); // confirm, watch the trade
      yield* mashUntil(() => rig.inTradeMenu(i), K.A, 4000); // "Trade completed!", back at the menu
      rig.result[p] = { party: rig.party(i), mons: rig.partyStructs(i) };
    } else {
      yield* mashUntil(() => r(i, 'wIsInBattle') !== 0);
      let hp;
      yield* mashUntil(() => { if (r(i, 'wIsInBattle')) hp = rig.battleHp(i); return r(i, 'wIsInBattle') === 0; }, K.A, 20000);
      rig.result[p] = { hp }; // [own, enemy] as this side last saw them in battle
    }
  }
  return [side(0), side(1)];
}

export async function setup(outDir, romPath, symPath, bootPath) {
  const rom = readFileSync(romPath), boot = readFileSync(bootPath), sym = L.loadSymbols(symPath);
  const m = await L.loadCores(outDir, rom, boot);
  const rig = new Rig(m, sym, rom);
  // New game: mash through the intro (as in spikes/emu) until the overworld loop runs.
  m._h_hook(0, rig.A('OverworldLoop'));
  for (let f = 0; m._h_hook_hits(0) === 0; f++) {
    if (f > 40000) throw new Error('intro timeout');
    m._h_keys(0, f % 8 < 2 ? (f % 64 < 8 ? K.down : f % 512 < 8 ? K.start : K.A) : 0); rig.frames(0);
  }
  m._h_hook(0, -1); m._h_keys(0, 0); rig.frames(0, 60);
  L.loadState(m, 1, L.saveState(m, 0));
  PLAYERS.forEach((p, i) => rig.prepare(i, p));
  return { m, rig, states: [L.saveState(m, 0), L.saveState(m, 1)] };
}

/** Run both input scripts on a Link until both finish, or a wall-clock budget runs out. */
export function run(link, gens, { budgetSec = 600, onTick } = {}) {
  const m = link.m, frameAt = [m._h_frames(0), m._h_frames(1)], hold = [0, 0], done = [false, false], err = [null, null];
  const budget = budgetSec * L.TICKS_PER_SEC;
  while (!(done[0] && done[1]) && link.wall < budget) {
    link.step();
    for (const i of [0, 1]) {
      if (done[i]) continue;
      const f = m._h_frames(i); if (f === frameAt[i]) continue;
      hold[i] -= f - frameAt[i]; frameAt[i] = f;
      if (hold[i] > 0) continue;
      try {
        const n = gens[i].next();
        if (n.done) { done[i] = true; m._h_keys(i, 0); } else { m._h_keys(i, n.value[0]); hold[i] = n.value[1]; }
      } catch (e) { err[i] = e.message; done[i] = true; }
    }
    onTick?.();
  }
  return { done, err, wallSec: link.wall / L.TICKS_PER_SEC, frames: [m._h_frames(0), m._h_frames(1)] };
}

/**
 * Run both scripts over a Dual (each client runs both Game Boys; only input crosses the
 * network). Player p's script reads their own core on their own client. Every 300 frames each
 * client hashes both of its Game Boys; the two clients' hashes must match frame for frame.
 */
export function runDual(dual, gens, { budgetSec = 900, every = 300 } = {}) {
  const m = dual.m, own = [0, 3], frameAt = own.map((i) => m._h_frames(i)), hold = [0, 0], keys = [0, 0];
  const done = [false, false], err = [null, null], checks = [new Map(), new Map()];
  let mismatches = 0, compared = 0;
  const budget = budgetSec * L.TICKS_PER_SEC;
  const next = (c) => {
    if (done[c]) return 0;
    const f = m._h_frames(own[c]); hold[c] -= f - frameAt[c]; frameAt[c] = f;
    if (hold[c] > 0) return keys[c];
    try {
      const n = gens[c].next();
      if (n.done) { done[c] = true; keys[c] = 0; } else { [keys[c], hold[c]] = n.value; }
    } catch (e) { err[c] = e.message; done[c] = true; keys[c] = 0; }
    return keys[c];
  };
  const checkpoint = (c) => {
    const n = dual.n[c]; if (n % every) return;
    checks[c].set(n, dual.clients[c].cores.map((i) => L.ramHash(m, i)).join());
    const other = checks[1 - c].get(n);
    if (other !== undefined) { compared++; if (other !== checks[c].get(n)) mismatches++; checks[0].delete(n); checks[1].delete(n); }
  };
  while (!(done[0] && done[1]) && dual.wall < budget) checkpoint(dual.step(next));
  // Let the trailing client reach the same frame, then compare once more.
  while (dual.n[0] !== dual.n[1] && dual.wall < budget + L.TICKS_PER_SEC * 60) dual.step(() => 0);
  const final = dual.clients.map((p) => p.cores.map((i) => L.ramHash(m, i)).join());
  return { done, err, wallSec: dual.wall / L.TICKS_PER_SEC, compared: compared + 1, mismatches: mismatches + (final[0] === final[1] ? 0 : 1),
    waitSec: dual.waitTicks.map((t) => +(t / L.TICKS_PER_SEC).toFixed(1)), frames: [...dual.n] };
}
