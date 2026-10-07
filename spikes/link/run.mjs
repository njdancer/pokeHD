// Throwaway: run trades and battles over the simulated cable for each strategy and latency.
// Usage: node run.mjs <build/out> <rom> <pokeblue.sym> <dmg_boot.bin> <strategy>:<ms>:<trade|battle> ...
// Prints one JSON line per run. Time is simulated: both Game Boys run at real speed against one
// wall clock, so "wallSec" is what the players would wait.
import * as L from './lib.mjs';
import * as S from './scenario.mjs';

const [, , outDir, romPath, symPath, bootPath, ...runs] = process.argv;
const { m, rig, states } = await S.setup(outDir, romPath, symPath, bootPath);

for (const spec of runs) {
  const [strategy, ms, kind, delay = '6'] = spec.split(':');
  const dual = strategy === 'dual', budgetSec = kind === 'trade' ? 900 : 1500;
  [0, 1, 2, 3].forEach((i) => L.loadState(m, i, states[i % 2]));
  const sent = [S.PLAYERS[0], S.PLAYERS[1]].map((p) => L.makeParty(rig.rom, rig.sym, p.mons, p.id)[0].struct);
  const t0 = performance.now();
  let out;
  if (dual) {
    const d = new L.Dual(m, { latencyMs: +ms, delayFrames: +delay });
    const res = S.runDual(d, S.scripts(rig, kind, { cores: [0, 3] }), { budgetSec });
    out = { strategy, latencyMs: +ms, delayFrames: +delay, kind, done: res.done, err: res.err, wallSec: +res.wallSec.toFixed(1),
      cableBytes: d.clients.map((p) => p.bytes), waitSec: res.waitSec, replicaChecks: res.compared, replicaMismatches: res.mismatches };
  } else {
    const link = new L.Link(m, { strategy, latencyMs: +ms });
    const res = S.run(link, S.scripts(rig, kind), { budgetSec });
    out = { strategy, latencyMs: +ms, kind, done: res.done, err: res.err, wallSec: +res.wallSec.toFixed(1),
      masterBytes: link.stats.bytes[0] + link.stats.bytes[1], stallSec: link.stats.stallTicks.map((t) => +(t / L.TICKS_PER_SEC).toFixed(1)) };
  }
  out.cpuSec = +((performance.now() - t0) / 1000).toFixed(1);
  if (kind === 'trade') {
    const got = [0, 1].map((i) => rig.result[i]);
    out.parties = got.map((g) => g?.party);
    // Each side's new mon must be byte-identical to the one the other side sent.
    out.verified = got.every((g, i) => g && g.party.join() === [S.PLAYERS[i].mons[1].species, S.PLAYERS[1 - i].mons[0].species].join()
      && g.mons[1].every((v, k) => v === sent[1 - i][k]));
  } else {
    const [a, b] = [rig.result[0]?.hp, rig.result[1]?.hp];
    out.hp = [a, b];
    out.verified = !!(a && b && a[0] === b[1] && a[1] === b[0] && (a[0] === 0) !== (a[1] === 0));
  }
  if (!out.verified) out.final = (dual ? [0, 3] : [0, 1]).map((i) => ({ ...rig.pos(i), conn: rig.r(i, 'hSerialConnectionStatus'), linkState: rig.r(i, 'wLinkState'), inBattle: rig.r(i, 'wIsInBattle') }));
  console.log(JSON.stringify(out));
}
