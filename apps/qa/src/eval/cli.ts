// The movement eval's command line.
//   node src/eval/cli.ts gen                      makes the dev and held-out scenario sets
//   node src/eval/cli.ts run <variant> [--set dev] [--reps 2] [--parallel 3] [--model …] [--only id,id]
//   node src/eval/cli.ts compare <runA> <runB>     paired comparison of two runs on the same set
//   node src/eval/cli.ts show <scenario>           the scenario's opening, as the model sees it
// Everything it writes goes under apps/qa/runs/eval/ (gitignored: scenario sets name places in
// the game and runs hold its text maps).
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { openingText, playEpisode, type EpisodeResult } from "./episode.ts";
import { generate, type Area, type Kind, type Scenario } from "./scenarios.ts";
import { loadRomData, Sim } from "./sim.ts";
import { summarise, compare, type Summary } from "./score.ts";
import { VARIANTS } from "./variants.ts";
import { exportDashboard, type ClimbEntry } from "./export.ts";

const ROOT = fileURLToPath(new URL("../../runs/eval/", import.meta.url));
const SETS = join(ROOT, "sets");
const RESULTS = join(ROOT, "results");

const SET_SPECS: Record<string, { seed: number; quota: Record<Kind, Record<Area, number>> }> = {
  dev: { seed: 1001, quota: { short: { outdoor: 16, indoor: 12, cave: 12 }, multi: { outdoor: 4, indoor: 5, cave: 5 } } },
  holdout: { seed: 2002, quota: { short: { outdoor: 8, indoor: 6, cave: 6 }, multi: { outdoor: 2, indoor: 3, cave: 3 } } },
};

export function loadSet(name: string): Scenario[] {
  return JSON.parse(readFileSync(join(SETS, `${name}.json`), "utf8")) as Scenario[];
}

export function loadRun(id: string): { meta: RunMeta; episodes: EpisodeResult[] } {
  const dir = join(RESULTS, id);
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as RunMeta;
  const episodes = existsSync(join(dir, "episodes.jsonl"))
    ? readFileSync(join(dir, "episodes.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as EpisodeResult)
    : [];
  return { meta, episodes };
}

/** Several runs of one variant on one set (comma-separated IDs), as one: extra repeats add up. */
function loadRuns(ids: string): { meta: RunMeta; episodes: EpisodeResult[] } {
  const runs = ids.split(",").map(loadRun);
  return { meta: runs[0]!.meta, episodes: runs.flatMap((r) => r.episodes) };
}

export interface RunMeta {
  id: string;
  variant: string;
  set: string;
  reps: number;
  model: string;
  startedAt: string;
  endedAt?: string;
  summary?: Summary;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      set: { type: "string", default: "dev" },
      reps: { type: "string", default: "2" },
      parallel: { type: "string", default: "3" },
      model: { type: "string", default: "claude-haiku-5-5" },
      only: { type: "string" },
      kind: { type: "string" },
      tag: { type: "string" },
      feature: { type: "string" },
    },
  });
  if (command === "gen") {
    mkdirSync(SETS, { recursive: true });
    const rom = loadRomData();
    const sim = await Sim.create(rom);
    for (const [name, spec] of Object.entries(SET_SPECS)) {
      if (positionals.length && !positionals.includes(name)) continue;
      const set = await generate(sim, { ...spec, prefix: name }, (s) => console.log(s));
      writeFileSync(join(SETS, `${name}.json`), JSON.stringify(set, null, 1));
      console.log(`${name}: ${set.length} scenarios`);
    }
    return;
  }
  if (command === "show") {
    const rom = loadRomData();
    const sim = await Sim.create(rom);
    const scenario = loadSet(values.set!).find((s) => s.id === positionals[0]);
    if (!scenario) throw new Error(`No scenario ${positionals[0]}`);
    sim.teleport(scenario.start, scenario.lastMap);
    console.log(openingText(scenario, VARIANTS[positionals[1] ?? "baseline"]!, sim));
    console.log(`\nroute ${scenario.route} (par ${scenario.par}, ${scenario.features.join(", ")})`);
    return;
  }
  if (command === "run") {
    const variant = VARIANTS[positionals[0] ?? "baseline"];
    if (!variant) throw new Error(`No variant ${positionals[0]}; have ${Object.keys(VARIANTS).join(", ")}`);
    let set = loadSet(values.set!);
    if (values.only) set = set.filter((s) => values.only!.split(",").includes(s.id));
    if (values.kind) set = set.filter((s) => s.kind === values.kind);
    if (values.feature) set = set.filter((s) => s.features.includes(values.feature as never));
    const reps = Number(values.reps);
    const parallel = Math.max(1, Math.min(3, Number(values.parallel)));
    const id = `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${variant.id}-${values.set}${values.tag ? `-${values.tag}` : ""}`;
    const dir = join(RESULTS, id);
    mkdirSync(dir, { recursive: true });
    const meta: RunMeta = { id, variant: variant.id, set: values.set!, reps, model: values.model!, startedAt: new Date().toISOString() };
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 1));
    const rom = loadRomData();
    const sims = await Promise.all(Array.from({ length: parallel }, () => Sim.create(rom)));
    const jobs = set.flatMap((s) => Array.from({ length: reps }, (_, rep) => ({ s, rep })));
    let next = 0;
    let done = 0;
    const episodes: EpisodeResult[] = [];
    await Promise.all(
      sims.map(async (sim) => {
        while (next < jobs.length) {
          const job = jobs[next++]!;
          const r = await playEpisode(sim, job.s, variant, { model: values.model!, rep: job.rep });
          episodes.push(r);
          appendFileSync(join(dir, "episodes.jsonl"), JSON.stringify(r) + "\n");
          done++;
          console.log(`[${done}/${jobs.length}] ${r.scenario}#${r.rep} ${r.end} turns ${r.turns}/${job.s.parTurns} walked ${r.walked}/${r.par} tokens ${r.inputTokens}+${r.outputTokens}${r.error ? ` (${r.error})` : ""}`);
        }
      }),
    );
    meta.endedAt = new Date().toISOString();
    meta.summary = summarise(episodes, set);
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 1));
    console.log(JSON.stringify(meta.summary.overall, null, 1));
    console.log(`run ${id}`);
    return;
  }
  if (command === "compare") {
    const [a, b] = positionals;
    const ra = loadRuns(a!);
    const rb = loadRuns(b!);
    const set = loadSet(ra.meta.set);
    console.log(JSON.stringify(compare(ra.episodes, rb.episodes, set), null, 1));
    return;
  }
  if (command === "decide") {
    // Records a hill-climb step: run B (a variant) against run A (the variant it was built on).
    const [a, b] = positionals;
    const ra = loadRuns(a!);
    const rb = loadRuns(b!);
    // --feature: a change that only acts on some goals (an exit note acts only at exits) is judged
    // on those, and checked for harm on the rest.
    const all = loadSet(rb.meta.set);
    const scoped = values.feature ? all.filter((s) => s.features.includes(values.feature as never)) : all;
    const c = compare(ra.episodes, rb.episodes, scoped);
    const rest = values.feature ? compare(ra.episodes, rb.episodes, all.filter((s) => !scoped.includes(s))) : null;
    if (rest?.verdict === "worse") [c.verdict, c.reason] = ["worse", `better on ${values.feature} goals but worse on the rest`];
    const v = VARIANTS[rb.meta.variant];
    const entry: ClimbEntry = {
      at: new Date().toISOString(),
      variant: rb.meta.variant,
      parent: ra.meta.variant,
      change: v?.note ?? "",
      runA: a!,
      runB: b!,
      set: rb.meta.set,
      verdict: c.verdict,
      kept: c.verdict === "better",
      reason: values.feature ? `${c.reason} (on ${values.feature} goals; rest ${rest!.verdict}, ${(rest!.success.diff * 100).toFixed(1)} pts)` : c.reason,
      ...(values.feature && { scope: values.feature }),
      success: c.success,
      turns: c.turns,
      tokens: c.tokens,
    };
    appendFileSync(join(ROOT, "climb.jsonl"), JSON.stringify(entry) + "\n");
    console.log(JSON.stringify(entry, null, 1));
    return;
  }
  if (command === "export") {
    exportDashboard(positionals[0] ?? join(ROOT, "dashboard"));
    return;
  }
  if (command === "list") {
    for (const id of readdirSync(RESULTS).sort()) {
      const { meta } = loadRun(id);
      const o = meta.summary?.overall;
      console.log(`${id}  ${o ? `success ${(o.success * 100).toFixed(1)}% steps/par ${o.stepRatio.toFixed(2)} turns/par ${o.turnRatio.toFixed(2)} tokens ${Math.round(o.tokens)}` : "(unfinished)"}`);
    }
    return;
  }
  console.log("commands: gen [dev|holdout], show <scenario> [variant], run <variant> [--set] [--reps] [--parallel] [--only], compare <runA> <runB>, list");
}

await main();
