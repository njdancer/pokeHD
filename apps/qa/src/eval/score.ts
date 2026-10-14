// Scores for a run, and the paired comparison that decides whether a variant is kept.
// Success rate comes first; among runs that succeed equally, fewer turns and tokens per goal win.
// The comparison is paired by scenario (both variants played the same scenarios) with a bootstrap
// over scenarios, so a change counts only when its gain is clear of the run-to-run noise.
import type { EpisodeResult } from "./episode.ts";
import { rng, type Scenario } from "./scenarios.ts";

export interface Score {
  episodes: number;
  success: number;
  /** Over successful episodes: arrows asked for ÷ par (1 is a perfect route; bumps and detours raise it). */
  stepRatio: number;
  /** Over successful episodes: turns ÷ par turns. */
  turnRatio: number;
  /** Mean tokens (prompt + output) per episode, and output alone. */
  tokens: number;
  outputTokens: number;
  /** How the failures ended. */
  ends: Record<string, number>;
}

export interface Summary {
  overall: Score;
  byKind: Record<string, Score>;
  byArea: Record<string, Score>;
  bySplit: Record<string, Score>;
  byFeature: Record<string, Score>;
  /** Per scenario: success rate and the mean turns. */
  scenarios: Record<string, { success: number; turns: number; stepRatio: number | null; episodes: number }>;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function score(eps: EpisodeResult[], set: Map<string, Scenario>): Score {
  const ok = eps.filter((e) => e.success);
  const ends: Record<string, number> = {};
  for (const e of eps) if (!e.success) ends[e.end] = (ends[e.end] ?? 0) + 1;
  return {
    episodes: eps.length,
    success: mean(eps.map((e) => (e.success ? 1 : 0))),
    stepRatio: mean(ok.map((e) => e.asked / Math.max(1, e.par))),
    turnRatio: mean(ok.map((e) => e.turns / Math.max(1, set.get(e.scenario)?.parTurns ?? e.parTurns))),
    tokens: mean(eps.map((e) => e.inputTokens + e.outputTokens)),
    outputTokens: mean(eps.map((e) => e.outputTokens)),
    ends,
  };
}

function groupBy(eps: EpisodeResult[], key: (e: EpisodeResult) => string[]): Map<string, EpisodeResult[]> {
  const out = new Map<string, EpisodeResult[]>();
  for (const e of eps) for (const k of key(e)) out.set(k, [...(out.get(k) ?? []), e]);
  return out;
}

export function summarise(eps: EpisodeResult[], scenarios: Scenario[]): Summary {
  const set = new Map(scenarios.map((s) => [s.id, s]));
  const by = (key: (s: Scenario) => string[]) =>
    Object.fromEntries([...groupBy(eps, (e) => (set.get(e.scenario) ? key(set.get(e.scenario)!) : []))].sort().map(([k, v]) => [k, score(v, set)]));
  return {
    overall: score(eps, set),
    byKind: by((s) => [s.kind]),
    byArea: by((s) => [s.area]),
    bySplit: by((s) => [`${s.kind}/${s.area}`]),
    byFeature: by((s) => s.features),
    scenarios: Object.fromEntries(
      [...groupBy(eps, (e) => [e.scenario])].map(([id, v]) => {
        const ok = v.filter((e) => e.success);
        return [id, { success: mean(v.map((e) => (e.success ? 1 : 0))), turns: mean(v.map((e) => e.turns)), stepRatio: ok.length ? mean(ok.map((e) => e.asked / Math.max(1, e.par))) : null, episodes: v.length }];
      }),
    ),
  };
}

export interface Delta {
  metric: string;
  /** B minus A, averaged over shared scenarios. */
  diff: number;
  /** 90% bootstrap interval of the diff. */
  low: number;
  high: number;
}

export interface Comparison {
  scenarios: number;
  success: Delta;
  turns: Delta;
  tokens: Delta;
  /** "better", "worse" or "same": success first, then turns, then tokens. */
  verdict: "better" | "worse" | "same";
  reason: string;
}

function delta(metric: string, pairs: [number, number][], seed = 7): Delta {
  const diffs = pairs.map(([a, b]) => b - a);
  const random = rng(seed);
  const boots: number[] = [];
  for (let i = 0; i < 4000; i++) {
    let s = 0;
    for (let j = 0; j < diffs.length; j++) s += diffs[Math.floor(random() * diffs.length)]!;
    boots.push(s / diffs.length);
  }
  boots.sort((x, y) => x - y);
  return { metric, diff: mean(diffs), low: boots[Math.floor(boots.length * 0.05)]!, high: boots[Math.floor(boots.length * 0.95)]! };
}

/** B against A, paired by scenario. */
export function compare(a: EpisodeResult[], b: EpisodeResult[], scenarios: Scenario[]): Comparison {
  const ga = groupBy(a, (e) => [e.scenario]);
  const gb = groupBy(b, (e) => [e.scenario]);
  const ids = scenarios.map((s) => s.id).filter((id) => ga.has(id) && gb.has(id));
  const m = (eps: EpisodeResult[], f: (e: EpisodeResult) => number) => mean(eps.map(f));
  const success = delta("success", ids.map((id) => [m(ga.get(id)!, (e) => +e.success), m(gb.get(id)!, (e) => +e.success)]));
  // Turns and tokens per episode, failures counted at the cap they used: cheaper is better.
  const turns = delta("turns", ids.map((id) => [m(ga.get(id)!, (e) => e.turns), m(gb.get(id)!, (e) => e.turns)]));
  const tokens = delta("tokens", ids.map((id) => [m(ga.get(id)!, (e) => e.inputTokens + e.outputTokens), m(gb.get(id)!, (e) => e.inputTokens + e.outputTokens)]));
  let verdict: Comparison["verdict"] = "same";
  let reason = "no clear difference";
  if (success.low > 0) [verdict, reason] = ["better", "succeeds more often"];
  else if (success.high < 0) [verdict, reason] = ["worse", "succeeds less often"];
  else if (success.diff > -0.02 && turns.high < 0) [verdict, reason] = ["better", "as successful in fewer turns"];
  else if (success.diff > -0.02 && turns.diff <= 0 && tokens.high < 0) [verdict, reason] = ["better", "as successful on fewer tokens"];
  else if (turns.low > 0 && success.diff < 0.02) [verdict, reason] = ["worse", "more turns for no more success"];
  return { scenarios: ids.length, success, turns, tokens, verdict, reason };
}
