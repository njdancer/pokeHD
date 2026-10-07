// Throwaway comparison harness: same ROM, same inputs, same probes on each core.
// Usage: node compare.mjs <build/out> <rom> <dmg_boot.bin> binjgb-live,sameboy,gambatte
// IDLE=<frames> delays the input script (Gambatte boots without a boot ROM, so its
// intro runs ~100 frames ahead of the others and the mash lands in the wrong menu).
import { readFileSync } from 'node:fs';
// binjgb's RGBDS_LIVE build calls this from an EM_ASM on serial writes.
globalThis.emulator = { serialCallback() {} };
const [, , outDir, romPath, bootPath, which] = process.argv;
const rom = readFileSync(romPath), boot = readFileSync(bootPath);
const SYM = { DelayFrame: 0x20af, OverworldLoop: 0x03ff, wCurMap: 0xd35e, wYCoord: 0xd361, wXCoord: 0xd362 };
const K = { A: 1, B: 2, select: 4, start: 8, right: 16, left: 32, up: 64, down: 128 };
async function load(name) {
  const t0 = performance.now();
  const m = await (await import(`${outDir}/${name}.mjs`)).default();
  const rp = m._malloc(0x100000); m.HEAPU8.set(rom, rp);
  const bp = m._malloc(boot.length); m.HEAPU8.set(boot, bp);
  if (!m._h_new(rp, rom.length, bp, boot.length)) throw new Error('load failed');
  return { m, initMs: performance.now() - t0 };
}
function bench(m, frames) { const t = performance.now(); for (let i = 0; i < frames; i++) m._h_run_frame(); return frames / ((performance.now() - t) / 1000); }
for (const name of which.split(',')) {
  const { m, initMs } = await load(name);
  const r = (a) => m._h_read(a);
  // Intro: mash A, sprinkle downs (picks preset names), until the overworld loop runs.
  m._h_hook(SYM.OverworldLoop);
  let f = 0; for (let i = 0; i < +(process.env.IDLE ?? 0); i++) m._h_run_frame();
  while (m._h_hook_hits() === 0 && f < 20000) { m._h_keys(f % 8 < 2 ? (f % 64 < 8 ? K.down : (f % 512 < 8 ? K.start : K.A)) : 0); m._h_run_frame(); f++; }
  m._h_keys(0); for (let i = 0; i < 60; i++) m._h_run_frame();
  const inGame = `frame ${f}: map 0x${r(SYM.wCurMap).toString(16)} x=${r(SYM.wXCoord)} y=${r(SYM.wYCoord)}`;
  // Speed in the overworld, with and without a PC hook on DelayFrame.
  m._h_hook(-1); const fpsPlain = bench(m, 1200);
  const h0 = m._h_hook_hits(); m._h_hook(SYM.DelayFrame); const fpsHook = bench(m, 1200); const hookHits = m._h_hook_hits() - h0; m._h_hook(-1);
  // Save state round trip + WRAM write.
  const sz = m._h_state_size(); const sp = m._malloc(sz); const n = m._h_save(sp);
  const before = [r(SYM.wCurMap), r(SYM.wXCoord), r(SYM.wYCoord)].join(',');
  for (let i = 0; i < 40; i++) { m._h_keys(i < 20 ? K.right : K.down); for (let j = 0; j < 8; j++) m._h_run_frame(); }
  m._h_keys(0); for (let i = 0; i < 30; i++) m._h_run_frame();
  const moved = [r(SYM.wCurMap), r(SYM.wXCoord), r(SYM.wYCoord)].join(',');
  const ok = m._h_load(sp, n); const after = [r(SYM.wCurMap), r(SYM.wXCoord), r(SYM.wYCoord)].join(',');
  console.log(JSON.stringify({ name, initMs: +initMs.toFixed(1), inGame, fpsPlain: Math.round(fpsPlain), fpsHook: Math.round(fpsHook), hookHits, stateBytes: n, before, moved, restored: after, loadOk: ok }));
}
