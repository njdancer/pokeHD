// The dashboard's data: one JSON file per table, written from the runs and the climb log, for the
// published eval dashboard (uploaded as files there). Scores and scenario IDs only, no text maps.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EpisodeResult } from "./episode.ts";
import type { Scenario } from "./scenarios.ts";
import { summarise, type Delta, type Score } from "./score.ts";
import { VARIANTS } from "./variants.ts";

const ROOT = fileURLToPath(new URL("../../runs/eval/", import.meta.url));

export interface ClimbEntry {
  at: string;
  variant: string;
  parent: string;
  change: string;
  runA: string;
  runB: string;
  set: string;
  verdict: string;
  kept: boolean;
  reason: string;
  scope?: string;
  success: Delta;
  turns: Delta;
  tokens: Delta;
}

const round = (x: number, d = 3) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const row = (s: Score) => ({
  episodes: s.episodes,
  success: round(s.success),
  steps_vs_par: round(s.stepRatio),
  turns_vs_par: round(s.turnRatio),
  tokens: Math.round(s.tokens),
  output_tokens: Math.round(s.outputTokens),
});

export function exportDashboard(out: string): void {
  mkdirSync(out, { recursive: true });
  const results = join(ROOT, "results");
  const climb: ClimbEntry[] = existsSync(join(ROOT, "climb.jsonl"))
    ? readFileSync(join(ROOT, "climb.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as ClimbEntry)
    : [];
  const sets = new Map<string, Scenario[]>();
  const set = (name: string) => {
    if (!sets.has(name)) sets.set(name, JSON.parse(readFileSync(join(ROOT, "sets", `${name}.json`), "utf8")) as Scenario[]);
    return sets.get(name)!;
  };
  const runs: Record<string, unknown>[] = [];
  const splits: Record<string, unknown>[] = [];
  const scenarios: Record<string, unknown>[] = [];
  const pooled = new Map<string, { eps: EpisodeResult[]; started: string; model: string }>();
  for (const id of readdirSync(results).sort()) {
    if (id.includes("smoke")) continue;
    const meta = JSON.parse(readFileSync(join(results, id, "meta.json"), "utf8")) as { variant: string; set: string; model: string; startedAt: string; endedAt?: string };
    if (!meta.endedAt) continue;
    const eps = readFileSync(join(results, id, "episodes.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as EpisodeResult);
    const scen = set(meta.set);
    const sum = summarise(eps, scen);
    const decided = climb.find((c) => c.runB.split(",").includes(id));
    if (meta.set === "dev") {
      const p = pooled.get(meta.variant) ?? { eps: [], started: meta.startedAt, model: meta.model };
      p.eps.push(...eps);
      pooled.set(meta.variant, p);
    }
    runs.push({
      run: id,
      variant: meta.variant,
      parent: VARIANTS[meta.variant]?.parent ?? decided?.parent ?? null,
      change: VARIANTS[meta.variant]?.note ?? decided?.change ?? "",
      set: meta.set,
      scope: Object.keys(sum.scenarios).length < scen.length ? `${Object.keys(sum.scenarios).length} of ${scen.length} scenarios (extra repeats)` : "all",
      model: meta.model,
      started: meta.startedAt,
      ...row(sum.overall),
      short_success: round(sum.byKind["short"]?.success ?? NaN),
      multi_success: round(sum.byKind["multi"]?.success ?? NaN),
      outdoor_success: round(sum.byArea["outdoor"]?.success ?? NaN),
      indoor_success: round(sum.byArea["indoor"]?.success ?? NaN),
      cave_success: round(sum.byArea["cave"]?.success ?? NaN),
      decision: decided ? (decided.kept ? "kept" : "rejected") : meta.variant === "baseline" ? "baseline" : "undecided",
      verdict: decided?.verdict ?? null,
      reason: decided?.reason ?? null,
      vs_run: decided?.runA ?? null,
      success_delta: decided ? round(decided.success.diff) : null,
      success_delta_low: decided ? round(decided.success.low) : null,
      success_delta_high: decided ? round(decided.success.high) : null,
      turns_delta: decided ? round(decided.turns.diff) : null,
      tokens_delta: decided ? Math.round(decided.tokens.diff) : null,
    });
    for (const [group, table] of [["kind", sum.byKind], ["area", sum.byArea], ["split", sum.bySplit], ["feature", sum.byFeature]] as const) {
      for (const [name, s] of Object.entries(table)) splits.push({ run: id, variant: meta.variant, group, name, ...row(s) });
    }
    const byId = new Map(scen.map((s) => [s.id, s]));
    for (const [sid, s] of Object.entries(sum.scenarios)) {
      const sc = byId.get(sid);
      scenarios.push({
        key: `${id}|${sid}`,
        run: id,
        variant: meta.variant,
        scenario: sid,
        kind: sc?.kind ?? null,
        area: sc?.area ?? null,
        place: sc?.mapName ?? null,
        features: sc?.features.join(" ") ?? "",
        par: sc?.par ?? null,
        par_turns: sc?.parTurns ?? null,
        success: round(s.success),
        turns: round(s.turns, 2),
        steps_vs_par: s.stepRatio === null ? null : round(s.stepRatio),
        episodes: s.episodes,
      });
    }
  }
  // Every dev run of a variant pooled into one row: its extra repeats on some goals included.
  const dev = set("dev");
  const byId = new Map(dev.map((s) => [s.id, s]));
  for (const [variant, p] of [...pooled].sort((a, b) => a[1].started.localeCompare(b[1].started))) {
    const sum = summarise(p.eps, dev);
    const decided = [...climb].reverse().find((c) => c.variant === variant);
    const run = `${variant} (all dev runs)`;
    // Extra repeats went to some goals only (exits, multi-turn), so weigh each scenario once.
    const per = (keep: (sc: Scenario) => boolean) => {
      const rates = Object.entries(sum.scenarios).filter(([sid]) => byId.get(sid) && keep(byId.get(sid)!)).map(([, v]) => v.success);
      return rates.length ? round(rates.reduce((a, b) => a + b, 0) / rates.length) : null;
    };
    runs.push({
      run,
      variant,
      parent: VARIANTS[variant]?.parent ?? decided?.parent ?? null,
      change: VARIANTS[variant]?.note ?? decided?.change ?? "",
      set: "dev",
      scope: "pooled",
      model: p.model,
      started: p.started,
      ...row(sum.overall),
      success: per(() => true),
      short_success: per((x) => x.kind === "short"),
      multi_success: per((x) => x.kind === "multi"),
      outdoor_success: per((x) => x.area === "outdoor"),
      indoor_success: per((x) => x.area === "indoor"),
      cave_success: per((x) => x.area === "cave"),
      scenarios_covered: Object.keys(sum.scenarios).length,
      decision: decided ? (decided.kept ? "kept" : "rejected") : variant === "baseline" ? "baseline" : "undecided",
      verdict: decided?.verdict ?? null,
      reason: decided?.reason ?? null,
      vs_run: decided?.runA ?? null,
      success_delta: decided ? round(decided.success.diff) : null,
      success_delta_low: decided ? round(decided.success.low) : null,
      success_delta_high: decided ? round(decided.success.high) : null,
      turns_delta: decided ? round(decided.turns.diff) : null,
      tokens_delta: decided ? Math.round(decided.tokens.diff) : null,
    });
    for (const [group, table] of [["kind", sum.byKind], ["area", sum.byArea], ["split", sum.bySplit], ["feature", sum.byFeature]] as const) {
      for (const [name, sc] of Object.entries(table)) splits.push({ run, variant, group, name, ...row(sc) });
    }
    for (const [sid, sc] of Object.entries(sum.scenarios)) {
      const x = byId.get(sid);
      scenarios.push({ key: `${run}|${sid}`, run, variant, scenario: sid, kind: x?.kind ?? null, area: x?.area ?? null, place: x?.mapName ?? null, features: x?.features.join(" ") ?? "", par: x?.par ?? null, par_turns: x?.parTurns ?? null, success: round(sc.success), turns: round(sc.turns, 2), steps_vs_par: sc.stepRatio === null ? null : round(sc.stepRatio), episodes: sc.episodes });
    }
  }
  writeFileSync(join(out, "runs.json"), JSON.stringify(runs));
  writeFileSync(join(out, "splits.json"), JSON.stringify(splits));
  writeFileSync(join(out, "scenarios.json"), JSON.stringify(scenarios));
  console.log(`${runs.length} runs, ${splits.length} split rows, ${scenarios.length} scenario rows → ${out}`);
}
