// A seeded PRNG for the randomized tests, so a failure names a seed that replays it. Not
// exported from the package. FUZZ_RUNS sets how many runs each fuzz test makes (a modest
// default for CI; raise it for long hunts), FUZZ_SEED replays one.
export interface Rng {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [0, n). */
  int(n: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
}

/** mulberry32: small, fast and good enough to shuffle test steps. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    pick: (items) => items[Math.floor(next() * items.length)]!,
    chance: (p) => next() < p,
  };
}

/** The seeds to run: FUZZ_SEED alone, or FUZZ_RUNS of them (default `runs`) from a fixed start. */
export function fuzzSeeds(runs: number): number[] {
  const env = typeof process === "undefined" ? {} : process.env;
  if (env["FUZZ_SEED"]) return [Number(env["FUZZ_SEED"])];
  const n = Number(env["FUZZ_RUNS"] ?? runs) || runs;
  return Array.from({ length: n }, (_, i) => 0x5eed + i * 7919);
}
