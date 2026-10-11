// The pipeline map: the six stages data flows through, for the run in focus, with what's at each
// stage and dots flowing along the stages that are working now; tap a stage to inspect what's in it.
// Below, every run's family tree per task, so "what came from what" is one look.
import { useMemo, useState } from "react";
import type { LabDataset, LabIndex, LabRun, LabStageName, LabStatus } from "@pokehd/protocol";
import { ago, fileUrl, fmt, metricDef, primaryMetric, runPath, useLab, useLabMany, type RunRow } from "./data.ts";
import { LabLink, Progress, Status, type Go } from "./bits.tsx";
import { SampleBrowser } from "./Samples.tsx";
import { SERIES } from "./charts.tsx";

export const STAGES: { id: LabStageName; name: string; what: string }[] = [
  { id: "source", name: "Source", what: "Real art comes from your cartridge; made-up scenes from recipes of simple 3D shapes." },
  { id: "render", name: "Render & stylise", what: "Each made-up scene is drawn the way the Game Boy would: 4 shades, outlines, dither. Matched against real maps first." },
  { id: "dataset", name: "Datasets", what: "Thousands of drawings, each paired with the true answer: which way every pixel faces, and how deep it is." },
  { id: "train", name: "Training", what: "The small model guesses the answer for a drawing, gets told how wrong it was, adjusts, and repeats." },
  { id: "eval", name: "Evaluation", what: "Graded on drawings it never trained on: made-up ones, the hand-made test set, and real maps." },
  { id: "3d", name: "3D", what: "Its guesses turned into a mesh and lit, seen from the game camera and from the side." },
];

/** The status of a stage for a run: its own stage entry, else its datasets' status. */
function stageStatus(run: LabRun | undefined, datasets: (LabDataset | undefined)[], id: LabStageName): LabStatus | undefined {
  const own = run?.stages?.filter((s) => s.stage === id || s.name === id);
  if (own?.length) return own.some((s) => s.status === "running") ? "running" : own.some((s) => s.status === "failed") ? "failed" : own.every((s) => s.status === "done") ? "done" : own[0]!.status;
  if (id === "source" || id === "render" || id === "dataset") {
    const st = datasets.map((d) => d?.status).filter(Boolean) as LabStatus[];
    if (st.length) return st.includes("running") ? "running" : st.includes("failed") ? "failed" : st.every((s) => s === "done") ? "done" : "queued";
  }
  if (id === "train" && run) return run.status;
  return undefined;
}

export function Pipeline({ index, go, focusRun, stage, dataset }: { index: LabIndex; go: Go; focusRun?: string; stage?: string; dataset?: string }) {
  const focus = focusRun ?? index.ops?.runs?.[0] ?? index.runs.find((r) => r.status === "running")?.id ?? index.runs[0]?.id;
  const run = useLab<LabRun>(focus ? runPath(focus) : null).data;
  const dsIds = run?.datasets ?? [];
  const datasets = useLabMany<LabDataset>(dsIds.map((d) => `datasets/${d}/dataset.json`));
  const open = (stage as LabStageName | undefined) ?? (dataset ? "dataset" : undefined);

  return (
    <div className="lab-pipeline">
      <div className="lab-row wrap">
        <span className="muted small">Showing</span>
        <select value={focus} onChange={(e) => go({ tab: "pipeline", run: e.target.value })} aria-label="Run in focus">
          {index.runs.filter((r) => !r.archived).map((r) => <option key={r.id} value={r.id}>{r.title ?? r.name ?? r.id} · {r.status}</option>)}
        </select>
        {run && <LabLink go={go} to={{ tab: "runs", run: run.id }} className="small">open run</LabLink>}
      </div>
      <ol className="lab-spine">
        {STAGES.map((s, i) => {
          const status = stageStatus(run, datasets, s.id);
          const entry = run?.stages?.find((x) => x.stage === s.id || x.name === s.id);
          return (
            <li key={s.id} className={`${status ?? "idle"} ${open === s.id ? "open" : ""}`}>
              <button type="button" onClick={() => go({ tab: "pipeline", run: focus, stage: open === s.id ? undefined : s.id })} aria-expanded={open === s.id}>
                <span className="n">{i + 1}</span>
                <span className="name">{s.name}</span>
                {status && <Status status={status} />}
                <span className="what">{s.what}</span>
                <StageFact id={s.id} run={run} datasets={datasets} index={index} />
                {entry?.progress && <Progress {...entry.progress} />}
              </button>
              {i < STAGES.length - 1 && <span className={`pipe ${status === "running" || stageStatus(run, datasets, STAGES[i + 1]!.id) === "running" ? "flowing" : ""}`} aria-hidden><i /><i /><i /></span>}
            </li>
          );
        })}
      </ol>
      {open && run && <StageInspector stage={open} run={run} datasets={dsIds.map((id, i) => ({ id, d: datasets[i] }))} focusDataset={dataset} go={go} />}
      <Lineage index={index} go={go} focus={focus} />
    </div>
  );
}

function StageFact({ id, run, datasets, index }: { id: LabStageName; run?: LabRun; datasets: (LabDataset | undefined)[]; index: LabIndex }) {
  if (!run) return null;
  const total = datasets.reduce((a, d) => a + Object.values(d?.counts ?? {}).reduce((x, y) => x + y, 0), 0);
  const fact = (() => {
    switch (id) {
      case "source": return [...new Set(datasets.map((d) => d?.kind).filter(Boolean))].join(" + ") || null;
      case "render": return datasets.some((d) => d?.config && "style" in d.config) ? "calibrated styles" : null;
      case "dataset": return total ? `${total.toLocaleString()} drawings in ${datasets.length} set${datasets.length === 1 ? "" : "s"}` : `${datasets.length} set${datasets.length === 1 ? "" : "s"}`;
      case "train": { const p = run.arch && typeof run.arch.params === "number" ? `${(run.arch.params / 1e6).toFixed(2)}M params` : null; return p; }
      case "eval": { const m = primaryMetric(run.summary, run, index); return m ? `${m.def.label}: ${fmt(m.value, m.def)}` : run.evals?.length ? `${run.evals.length} evals` : null; }
      case "3d": { const n = run.images?.filter((im) => im.kind === "3d").length ?? 0; return n ? `${n} renders` : null; }
    }
  })();
  return fact ? <span className="fact">{fact}</span> : null;
}

function StageInspector({ stage, run, datasets, focusDataset, go }: { stage: LabStageName; run: LabRun; datasets: { id: string; d?: LabDataset }[]; focusDataset?: string; go: Go }) {
  const s = STAGES.find((x) => x.id === stage)!;
  const [ds, setDs] = useState(focusDataset ?? datasets[0]?.id);
  const d = datasets.find((x) => x.id === ds)?.d;
  return (
    <section className="lab-card lab-inspector">
      <h3>{s.name}</h3>
      <p className="muted small">{s.what}</p>
      {(stage === "source" || stage === "render" || stage === "dataset") && (
        datasets.length ? (
          <>
            <div className="lab-seg">{datasets.map((x) => <button type="button" key={x.id} aria-pressed={x.id === ds} onClick={() => setDs(x.id)}>{x.d?.title ?? x.id}</button>)}</div>
            {d ? (
              <div>
                <p className="small">{d.kind && <span className="pill">{d.kind}</span>} {d.status && <Status status={d.status} />} {d.progress && <Progress {...d.progress} />} {d.updated && <span className="muted">updated {ago(d.updated)}</span>}</p>
                {d.changes?.length ? <ul className="small">{d.changes.map((c) => <li key={c}>{c}</li>)}</ul> : null}
                {d.counts && <MixBar counts={d.counts} />}
                {stage !== "dataset" && d.config && <pre className="small">{JSON.stringify(d.config, null, 1)}</pre>}
                {d.images?.length ? <div className="lab-gallery">{d.images.map((im) => <figure key={im.path}><img src={fileUrl(`datasets/${d.id}/${im.path}`)} alt={im.caption ?? ""} loading="lazy" /><figcaption>{im.caption}</figcaption></figure>)}</div> : null}
                {d.findings?.length ? <ul className="small">{d.findings.map((f) => <li key={f}>{f}</li>)}</ul> : null}
                {d.samples?.map((m) => <SampleBrowser key={m} manifest={`datasets/${d.id}/${m}`} ctx={{ dataset: d.id, stage }} />)}
              </div>
            ) : <p className="muted">Loading {ds}…</p>}
          </>
        ) : <p className="muted">This run lists no datasets.</p>
      )}
      {stage === "train" && <p className="small">Training curves, architecture and config are on the run's page. <LabLink go={go} to={{ tab: "runs", run: run.id }}>Open {run.name ?? run.id}</LabLink></p>}
      {stage === "eval" && (run.evals?.length ? <p className="small">Evaluations: {run.evals.map((e) => <LabLink key={e} go={go} to={{ tab: "runs", run: run.id, set: runPath(run.id, `preds/${e}.json`) }} className="chip">{e}</LabLink>)}</p> : <p className="muted">No evaluations yet.</p>)}
      {stage === "3d" && (
        run.images?.some((im) => im.kind === "3d")
          ? <div className="lab-gallery">{run.images.filter((im) => im.kind === "3d").map((im) => <figure key={im.path}><img src={fileUrl(runPath(run.id, im.path))} alt={im.caption ?? ""} loading="lazy" /><figcaption>{im.caption}</figcaption></figure>)}</div>
          : <p className="muted small">No rendered pictures yet. Any prediction can be turned into 3D from its sample, with the 3D button.</p>
      )}
    </section>
  );
}

/** What a dataset is made of, as one bar split by scene kind. */
function MixBar({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts), total = entries.reduce((a, [, n]) => a + n, 0) || 1;
  return (
    <div className="lab-mix">
      <div className="bar">{entries.map(([k, n], i) => <span key={k} style={{ flex: n, background: SERIES[i % SERIES.length] }} title={`${k}: ${n.toLocaleString()}`} />)}</div>
      <div className="lab-legend">{entries.map(([k, n], i) => <span key={k}><i style={{ background: SERIES[i % SERIES.length] }} />{k} {n.toLocaleString()} ({Math.round((n / total) * 100)}%)</span>)}</div>
    </div>
  );
}

/** Runs per task, oldest left, a line from each run to the run it changed. */
function Lineage({ index, go, focus }: { index: LabIndex; go: Go; focus?: string }) {
  const tasks = useMemo(() => {
    const by = new Map<string, RunRow[]>();
    for (const r of index.runs) if (!r.archived) by.set(r.task, [...(by.get(r.task) ?? []), r]);
    for (const list of by.values()) list.sort((a, b) => (a.started ?? a.id).localeCompare(b.started ?? b.id));
    return [...by];
  }, [index.runs]);
  if (!tasks.length) return null;
  const colW = 128, rowH = 74, maxN = Math.max(...tasks.map(([, l]) => l.length));
  const W = 110 + maxN * colW, H = tasks.length * rowH + 10;
  const where = new Map<string, { x: number; y: number }>();
  tasks.forEach(([, list], ti) => list.forEach((r, i) => where.set(r.id, { x: 110 + i * colW + colW / 2, y: 10 + ti * rowH + rowH / 2 })));
  return (
    <section className="lab-card">
      <h3>Family tree</h3>
      <p className="muted small">Each row is one task; each box a run, oldest on the left. Lines join a run to the one it changed. Tap a box to open it.</p>
      <div className="lab-scrollx">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="lab-lineage" role="img" aria-label="Runs by task, with parents">
          {tasks.map(([task], ti) => <text key={task} x={8} y={10 + ti * rowH + rowH / 2 + 4} className="lane">{task}</text>)}
          {index.runs.map((r) => {
            const a = r.parent ? where.get(r.parent) : undefined, b = where.get(r.id);
            if (!a || !b) return null;
            return <path key={r.id} d={`M${a.x + 50},${a.y} C${a.x + 80},${a.y} ${b.x - 80},${b.y} ${b.x - 50},${b.y}`} className="edge" />;
          })}
          {tasks.flatMap(([task, list]) => list.map((r) => {
            const p = where.get(r.id)!, best = index.best?.[task] === r.id;
            const m = primaryMetric(r.summary, null, index);
            return (
              <g key={r.id} className={`node ${r.status} ${r.id === focus ? "focus" : ""} ${best ? "best" : ""}`} onClick={() => go({ tab: "runs", run: r.id })} role="link" tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter") go({ tab: "runs", run: r.id }); }}>
                <title>{`${r.title ?? r.id}\n${r.status}${m ? `\n${m.def.label}: ${fmt(m.value, m.def)}` : ""}`}</title>
                <rect x={p.x - 52} y={p.y - 24} width={104} height={48} rx={8} />
                <text x={p.x} y={p.y - 6} textAnchor="middle" className="name">{(r.name ?? r.id).slice(0, 16)}</text>
                <text x={p.x} y={p.y + 12} textAnchor="middle" className="tick">{m ? `${shortLabel(m.key, index)} ${fmt(m.value, m.def)}` : r.status}</text>
                {best && <text x={p.x + 46} y={p.y - 12} textAnchor="end" className="star">★</text>}
              </g>
            );
          }))}
        </svg>
      </div>
    </section>
  );
}

const shortLabel = (key: string, index: LabIndex) => { const l = metricDef(key, null, index).label; return l.length > 10 ? key : l; };
