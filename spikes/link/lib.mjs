// Throwaway harness for p3-link-spike: two SameBoy cores, a simulated clock and a link bridge
// whose latency and synchronisation strategy are parameters. Nothing here ships.
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

export const TICKS_PER_SEC = 8388608; // SameBoy's GB_run counts 8 MHz ticks
export const msToTicks = (ms) => Math.round((ms / 1000) * TICKS_PER_SEC);
export const K = { A: 1, B: 2, select: 4, start: 8, right: 16, left: 32, up: 64, down: 128 };

// Symbols from the disassembly's pokeblue.sym (bank:addr name).
export function loadSymbols(path) {
  const sym = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^([0-9a-f]{2}):([0-9a-f]{4}) (\S+)$/.exec(line);
    if (m) sym[m[3]] = { bank: parseInt(m[1], 16), addr: parseInt(m[2], 16) };
  }
  return sym;
}
export const romOffset = ({ bank, addr }) => (bank ? bank * 0x4000 + (addr - 0x4000) : addr);

export async function loadCores(outDir, rom, boot) {
  const m = await (await import(`${outDir}/sameboy-link.mjs`)).default();
  const rp = m._malloc(rom.length); m.HEAPU8.set(rom, rp);
  const bp = m._malloc(boot.length); m.HEAPU8.set(boot, bp);
  for (const i of [0, 1, 2, 3]) if (!m._h_new(i, rp, rom.length, bp, boot.length)) throw new Error('load failed');
  return m;
}

export function saveState(m, i) {
  const sz = m._h_state_size(i); const p = m._malloc(sz); const n = m._h_save(i, p);
  const out = m.HEAPU8.slice(p, p + n); m._free(p); return out;
}
export function loadState(m, i, bytes) {
  const p = m._malloc(bytes.length); m.HEAPU8.set(bytes, p);
  const ok = m._h_load(i, p, bytes.length); m._free(p); if (!ok) throw new Error('state load failed');
}

// Debug only: dump a core's screen to a PNG (kept out of the repo: it is ROM-derived).
export function dumpPng(m, i, path) {
  const px = new Uint32Array(m.HEAPU8.buffer, m._h_pixels(i), 160 * 144);
  const raw = Buffer.alloc(144 * (1 + 160 * 3));
  for (let y = 0; y < 144; y++) for (let x = 0; x < 160; x++) {
    const v = px[y * 160 + x], o = y * (1 + 480) + 1 + x * 3;
    raw[o] = v & 255; raw[o + 1] = (v >> 8) & 255; raw[o + 2] = (v >> 16) & 255;
  }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(160, 0); ihdr.writeUInt32BE(144, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

/**
 * Two cores on one simulated wall clock. Each quantum, every core that isn't stalled runs Q ticks
 * of emulated time. When a core starts an internally clocked transfer (it is the master for that
 * byte), the strategy decides what it gets back and when:
 *
 * - `stall`: the master's emulation pauses. Its byte reaches the partner after `latency` (the
 *   partner shifts it in and its own byte out, atomically, as on a cable), and the reply reaches
 *   the master after another `latency`. With latency 0 this is an ideal cable.
 * - `async`: the master never pauses. It gets the partner's port as last seen over the network
 *   (state `latency` ago); its own byte reaches the partner `latency` later.
 */
export class Link {
  constructor(m, { strategy = 'stall', latencyMs = 0, quantum = 512 } = {}) {
    Object.assign(this, { m, strategy, L: msToTicks(latencyMs), Q: quantum });
    this.wall = 0; this.emu = [0, 0]; this.stalled = [false, false];
    this.events = []; // {t, fn}, kept sorted by t
    this.history = [[], []]; // async: [{t, sb, sc}] per core
    this.stats = { bytes: [0, 0], stallTicks: [0, 0], log: [] };
    this.stallStart = [0, 0];
    this.logBytes = false;
  }
  at(t, fn) { const e = { t, fn }; let k = this.events.length; while (k > 0 && this.events[k - 1].t > t) k--; this.events.splice(k, 0, e); }
  portSeen(i, t) { // the partner's port as observed at wall time t (async)
    const h = this.history[i]; let k = h.length - 1; while (k > 0 && h[k].t > t) k--; return h[Math.max(k, 0)];
  }
  replyFromPort({ sb, sc }) { // what h_clock_in would have returned for that port state
    if (!(sc & 0x80)) return 0x00; if (sc & 1) return 0xff; return sb;
  }
  onTransfer(i) {
    const m = this.m, j = 1 - i, out = m._h_xfer_out(i), t0 = this.wall;
    this.stats.bytes[i]++;
    if (this.strategy === 'stall') {
      this.stalled[i] = true; this.stallStart[i] = t0;
      this.at(t0 + this.L, () => {
        const reply = m._h_clock_in(j, out);
        if (this.logBytes) this.stats.log.push([t0, i, out, reply]);
        this.at(this.wall + this.L, () => { m._h_set_reply(i, reply); this.stalled[i] = false; this.stats.stallTicks[i] += this.wall - this.stallStart[i]; });
      });
    } else {
      const reply = this.replyFromPort(this.portSeen(j, t0 - this.L));
      if (this.logBytes) this.stats.log.push([t0, i, out, reply]);
      m._h_set_reply(i, reply);
      this.at(t0 + this.L, () => m._h_clock_in(j, out));
    }
  }
  step() {
    const m = this.m;
    for (;;) { // deliver due events (they may schedule more at the same time)
      const e = this.events[0]; if (!e || e.t > this.wall) break; this.events.shift(); e.fn();
    }
    for (const i of [0, 1]) {
      if (this.strategy === 'async') {
        const h = this.history[i], sb = m._h_sb(i), sc = m._h_sc(i), last = h[h.length - 1];
        if (!last || last.sb !== sb || last.sc !== sc) h.push({ t: this.wall, sb, sc });
        if (h.length > 4096) h.splice(0, 2048);
      }
      if (this.stalled[i]) continue;
      let budget = this.Q;
      while (budget > 0) {
        const ran = m._h_run(i, budget); budget -= ran; this.emu[i] += ran;
        if (m._h_stopped()) { this.onTransfer(i); if (this.stalled[i]) break; }
      }
    }
    this.wall += this.Q;
  }
}

// Party injection: build a valid party struct from the ROM's own base stats and move data.
export function makeParty(rom, sym, mons, otId) {
  const at = (s) => romOffset(sym[s]);
  const dexOf = (sp) => rom[at('PokedexOrder') + sp - 1];
  const base = (sp) => at('BaseStats') + (dexOf(sp) - 1) * 28;
  const name = (sp) => { const o = at('MonsterNames') + (sp - 1) * 10; const b = [...rom.subarray(o, o + 10)]; const e = b.indexOf(0x50); return [...b.slice(0, e < 0 ? 10 : e), 0x50]; };
  const expFor = (rate, n) => [n ** 3, 0, 0, Math.floor((6 * n ** 3) / 5) - 15 * n * n + 100 * n - 140, Math.floor((4 * n ** 3) / 5), Math.floor((5 * n ** 3) / 4)][rate];
  return mons.map(({ species: sp, level: L }) => {
    const b = base(sp), st = (k) => Math.floor((rom[b + k] * 2 * L) / 100) + 5;
    const hp = Math.floor((rom[b + 1] * 2 * L) / 100) + L + 10;
    const moves = [...rom.subarray(b + 15, b + 19)];
    const pp = moves.map((mv) => (mv ? rom[at('Moves') + (mv - 1) * 6 + 5] : 0));
    const exp = expFor(rom[b + 19], L);
    const s = new Uint8Array(44);
    s[0] = sp; s[1] = hp >> 8; s[2] = hp & 255; s[3] = L; s[5] = rom[b + 6]; s[6] = rom[b + 7]; s[7] = rom[b + 8];
    s.set(moves, 8); s[12] = otId >> 8; s[13] = otId & 255; s[14] = exp >> 16; s[15] = (exp >> 8) & 255; s[16] = exp & 255;
    s.set(pp, 29); s[33] = L; s[34] = hp >> 8; s[35] = hp & 255;
    [2, 3, 4, 5].forEach((k, n) => { const v = st(k); s[36 + n * 2] = v >> 8; s[37 + n * 2] = v & 255; });
    return { struct: s, nick: name(sp) };
  });
}
export function writeParty(m, i, sym, party, otName) {
  const w = (a, v) => m._h_write(i, a, v), A = (s) => sym[s].addr;
  w(A('wPartyCount'), party.length);
  party.forEach((p, n) => w(A('wPartySpecies') + n, p.struct[0])); w(A('wPartySpecies') + party.length, 0xff);
  party.forEach((p, n) => {
    p.struct.forEach((v, k) => w(A('wPartyMons') + n * 44 + k, v));
    otName.forEach((v, k) => w(A('wPartyMonOT') + n * 11 + k, v));
    p.nick.forEach((v, k) => w(A('wPartyMonNicks') + n * 11 + k, v));
  });
}
// Charmap encoding for A-Z, a-z and space, terminated by '@' (0x50).
export const encodeName = (s) => [...s].map((c) => (c === ' ' ? 0x7f : c >= 'a' ? 0xa0 + c.charCodeAt(0) - 97 : 0x80 + c.charCodeAt(0) - 65)).concat(0x50);

export const FRAME_TICKS = 140448; // one Game Boy frame (70224 cycles) in 8 MHz ticks

/**
 * Two Game Boys on an ideal cable inside one client, stepped deterministically in emulated time:
 * the same inputs on the same starting states give the same result on every machine.
 */
export class Pair {
  constructor(m, a, b, quantum = 512) { Object.assign(this, { m, cores: [a, b], Q: quantum }); this.bytes = 0; }
  frame() {
    const m = this.m;
    for (let left = FRAME_TICKS; left > 0; left -= this.Q) {
      for (const [k, i] of this.cores.entries()) {
        let budget = this.Q;
        while (budget > 0) {
          budget -= m._h_run(i, budget);
          if (m._h_stopped()) { this.bytes++; m._h_set_reply(i, m._h_clock_in(this.cores[1 - k], m._h_xfer_out(i))); }
        }
      }
    }
  }
}

/**
 * `dual`: each client runs both Game Boys (its own and a replica of the friend's) on a local
 * ideal cable, and the network carries only joypad input. Player p's input for frame n is
 * sampled at frame n - delay and sent to the other client; a client runs frame n only once it
 * has both inputs for n (lockstep). Cores 0,1 are client A (A's own is 0); cores 2,3 client B
 * (B's own is 3).
 */
export class Dual {
  constructor(m, { latencyMs = 0, delayFrames = 6 } = {}) {
    Object.assign(this, { m, L: msToTicks(latencyMs), D: delayFrames });
    this.clients = [new Pair(m, 0, 1), new Pair(m, 2, 3)];
    this.n = [0, 0]; this.t = [0, 0]; this.waitTicks = [0, 0];
    this.inputs = [new Map(), new Map()]; // per client: frame -> [keysA, keysB]
    this.arrive = [new Map(), new Map()]; // per client: frame -> wall time the friend's input lands
    for (const c of [0, 1]) for (let f = 0; f < delayFrames; f++) { this.inputs[c].set(f, [0, 0]); this.arrive[c].set(f, 0); }
  }
  get wall() { return Math.max(...this.t); }
  /** Run the next frame on whichever client can start soonest. `keys(c)` is client c's own input now. */
  step(keys) {
    let c = -1, start = Infinity;
    for (const k of [0, 1]) {
      const ready = this.arrive[k].get(this.n[k]); // undefined: the friend hasn't sent it yet
      if (ready !== undefined && Math.max(this.t[k], ready) < start) { c = k; start = Math.max(this.t[k], ready); }
    }
    const n = this.n[c];
    this.waitTicks[c] += start - this.t[c];
    // Sample our own input for frame n + D, keep it, and send it to the friend.
    const own = keys(c), f = n + this.D;
    const mine = this.inputs[c].get(f) ?? [0, 0]; mine[c] = own; this.inputs[c].set(f, mine);
    const theirs = this.inputs[1 - c].get(f) ?? [0, 0]; theirs[c] = own; this.inputs[1 - c].set(f, theirs);
    this.arrive[1 - c].set(f, start + this.L);
    const [ka, kb] = this.inputs[c].get(n);
    const [a, b] = this.clients[c].cores; this.m._h_keys(a, ka); this.m._h_keys(b, kb);
    this.clients[c].frame();
    this.inputs[c].delete(n); this.arrive[c].delete(n);
    this.n[c]++; this.t[c] = start + FRAME_TICKS;
    return c;
  }
}

/** FNV-1a over WRAM and HRAM: two replicas of one Game Boy should hash the same. */
export function ramHash(m, i) {
  let h = 0x811c9dc5;
  for (let a = 0xc000; a < 0xe000; a++) h = Math.imul(h ^ m._h_read(i, a), 0x01000193);
  for (let a = 0xff80; a < 0xffff; a++) h = Math.imul(h ^ m._h_read(i, a), 0x01000193);
  return h >>> 0;
}
