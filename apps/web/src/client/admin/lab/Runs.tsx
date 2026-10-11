// Every run in a table (filter by task, tick runs to compare), and the comparison itself: curves
// overlaid, headline numbers side by side, per-class bars, config differences and the same
// samples predicted by each run.
import { useMemo, useState } from "react";
import type { LabEval, LabIndex, LabRun } from "@pokehd/protocol";
import { ClassBars, LineChart, SERIES, smooth, Sparkline, type Line } from "./charts.tsx";
import { ago, fmt, metricDef, metricsPath, primaryMetric, runPath, series, splitKey, useLab, useLabMany, type Row } from "./data.ts";
import { LabLink, Status, type Go } from "./bits.tsx";
import { flatten } from "./RunView.tsx";
import { SampleBrowser } from "./Samples.tsx";

export function RunList({ index, go, task }: { index: LabIndex; go: Go; task?: string }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [archived, setArchived] = useState(false);
  const tasks = [...new Set(index.runs.map((r) => r.task))];
  const runs = [...index.runs]
    .filter((r) => (!task || r.task === task) && (archived || !r.archived))
    .sort((a, b) => (b.started ?? b.id).localeCompare(a.started ?? a.id));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-6)));
  return (
    <div className="lab-runs">
      <div className="lab-row wrap">
        <div className="lab-seg">
          <button type="button" aria-pressed={!task} onClick={() => go({ tab: "runs" })}>All</button>
          {tasks.map((t) => <button type="button" key={t} aria-pressed={task === t} onClick={() => go({ tab: "runs", task: t })}>{t}</button>)}
        </div>
        <label className="small"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archived</label>
        <span className="grow" />
        <button type="button" className="primary" disabled={picked.length < 2} onClick={() => go({ tab: "compare", runs: picked.join(",") })}>Compare {picked.length || ""}</button>
      </div>
      <table className="lab-table lab-runtable">
        <thead><tr><th aria-label="Compare" /><th>Run</th><th>Status</th><th>Headline</th><th className="hide-sm">Loss</th><th className="hide-sm">Started</th></tr></thead>
        <tbody>
          {runs.map((r) => {
            const m = primaryMetric(r.summary, null, index), best = index.best?.[r.task] === r.id;
            return (
              <tr key={r.id} className={picked.includes(r.id) ? "picked" : ""}>
                <td><input type="checkbox" aria-label={`Compare ${r.name ?? r.id}`} checked={picked.includes(r.id)} onChange={() => toggle(r.id)} /></td>
                <td>
                  <LabLink go={go} to={{ tab: "runs", run: r.id }}><b>{r.title ?? r.name ?? r.id}</b></LabLink>{best && <span className="pill best">best</span>}
                  <div className="muted small">{r.task}{r.parent ? <> · from {index.runs.find((x) => x.id === r.parent)?.name ?? r.parent}</> : null}</div>
                </td>
                <td><Status status={r.status} /></td>
                <td>{m ? <><span className="muted small">{m.def.label}</span><br /><b>{fmt(m.value, m.def)}</b></> : "–"}</td>
                <td className="hide-sm"><LossSpark id={r.id} live={r.status === "running"} /></td>
                <td className="hide-sm small muted">{ago(r.started)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!runs.length && <p className="muted">No runs yet.</p>}
    </div>
  );
}

function LossSpark({ id, live }: { id: string; live: boolean }) {
  const rows = useLab<Row[]>(metricsPath(id), { kind: "jsonl", live }).data;
  const s = useMemo(() => series(rows), [rows]);
  const pts = s.get("loss") ?? s.get("epoch_loss");
  return pts ? <Sparkline points={smooth(pts, 0.8).filter((_, i, a) => a.length < 200 || i % Math.ceil(a.length / 200) === 0)} /> : <span className="muted">–</span>;
}

export function Compare({ ids, index, go }: { ids: string[]; index: LabIndex; go: Go }) {
  const runs = useLabMany<LabRun>(ids.map((id) => runPath(id)), { live: false });
  const rows = useLabMany<Row[]>(ids.map(metricsPath), { kind: "jsonl" });
  const loaded = runs.filter(Boolean) as LabRun[];
  const colour = (i: number) => SERIES[i % SERIES.length]!;
  const name = (i: number) => runs[i]?.name ?? ids[i]!;
  const allSeries = useMemo(() => rows.map((r) => series(r)), [rows]);
  const keys = useMemo(() => [...new Set(allSeries.flatMap((s) => [...s.keys()]))].filter((k) => !splitKey(k).metric.includes("/")).sort(), [allSeries]);
  const [metric, setMetric] = useState<string | undefined>();
  const chosen = metric ?? keys.find((k) => /^val_/.test(k)) ?? keys.find((k) => k === "loss") ?? keys[0];
  const [k, setK] = useState(0.6);

  if (ids.length < 2) return <p className="muted">Tick two or more runs on the Runs tab to compare them.</p>;
  const summaryKeys = [...new Set(loaded.flatMap((r) => Object.keys(r.summary ?? {}).filter((x) => typeof r.summary![x] === "number")))];
  const flat = runs.map((r) => (r ? flatten(r.config) : {}));
  const configKeys = [...new Set(flat.flatMap((f) => Object.keys(f)))].filter((key) => new Set(flat.map((f) => JSON.stringify(f[key]))).size > 1).sort();
  const evalNames = [...new Set(loaded.flatMap((r) => r.evals ?? []))];

  return (
    <div className="lab-compare">
      <div className="lab-legend big">{ids.map((id, i) => <LabLink key={id} go={go} to={{ tab: "runs", run: id }}><i style={{ background: colour(i) }} />{runs[i]?.title ?? name(i)}</LabLink>)}</div>
      <section className="lab-card">
        <div className="lab-row wrap">
          <h3>Curves</h3>
          <select value={chosen} onChange={(e) => setMetric(e.target.value)} aria-label="Metric">
            {keys.map((key) => { const { metric: m, split } = splitKey(key); return <option key={key} value={key}>{metricDef(m, loaded[0], index).label}{split ? ` (${split})` : ""}</option>; })}
          </select>
          <label className="small">Smoothing <input type="range" min={0} max={0.98} step={0.02} value={k} onChange={(e) => setK(Number(e.target.value))} /></label>
        </div>
        {chosen && <LineChart lines={allSeries.map((s, i): Line => { const pts = s.get(chosen) ?? []; return { key: ids[i]!, label: name(i), points: smooth(pts, pts.length > 30 ? k : 0), colour: colour(i) }; })} height={220} />}
        {chosen && metricDef(splitKey(chosen).metric, loaded[0], index).help && <p className="muted small">{metricDef(splitKey(chosen).metric, loaded[0], index).help}</p>}
      </section>
      <section className="lab-card">
        <h3>Numbers</h3>
        <div className="lab-scrollx">
          <table className="lab-table small">
            <thead><tr><th>Metric</th>{ids.map((id, i) => <th key={id}><i className="dot" style={{ background: colour(i) }} />{name(i)}</th>)}</tr></thead>
            <tbody>{summaryKeys.map((key) => {
              const def = metricDef(key, loaded[0], index);
              const vals = runs.map((r) => (typeof r?.summary?.[key] === "number" ? (r.summary[key] as number) : null));
              const present = vals.filter((v): v is number => v != null);
              const best = def.better && present.length > 1 ? (def.better === "lower" ? Math.min(...present) : Math.max(...present)) : null;
              return <tr key={key}><td title={def.help}>{def.label}</td>{vals.map((v, i) => <td key={i} className={`num ${v != null && v === best ? "bestcell" : ""}`}>{fmt(v, def)}</td>)}</tr>;
            })}</tbody>
          </table>
        </div>
        <p className="muted small">Bold is best for metrics with a known direction.</p>
      </section>
      {evalNames.map((e) => <CompareEval key={e} name={e} ids={ids} runs={runs} colour={colour} />)}
      <section className="lab-card">
        <h3>Config differences</h3>
        {configKeys.length ? (
          <div className="lab-scrollx">
            <table className="lab-table small mono">
              <thead><tr><th>Setting</th>{ids.map((id, i) => <th key={id}>{name(i)}</th>)}</tr></thead>
              <tbody>{configKeys.map((key) => <tr key={key}><td>{key}</td>{flat.map((f, i) => <td key={i}>{f[key] === undefined ? "–" : typeof f[key] === "string" ? (f[key] as string) : JSON.stringify(f[key])}</td>)}</tr>)}</tbody>
            </table>
          </div>
        ) : <p className="muted small">Same config.</p>}
      </section>
    </div>
  );
}

function CompareEval({ name, ids, runs, colour }: { name: string; ids: string[]; runs: (LabRun | undefined)[]; colour: (i: number) => string }) {
  const evals = useLabMany<LabEval>(ids.map((id, i) => (runs[i]?.evals?.includes(name) ? runPath(id, `evals/${name}.json`) : `runs/${id}/evals/${name}.json`)), { live: false });
  const first = evals.find(Boolean);
  if (!first) return null;
  const metrics = Object.keys(first.perClass ?? {});
  const preds = first.preds?.[0];
  const firstIdx = evals.indexOf(first);
  return (
    <section className="lab-card">
      <div className="lab-row wrap"><h3>{first.title ?? name}</h3>{evals.some((e) => e?.circular) && <span className="pill warn">some scores circular</span>}</div>
      {metrics.map((m) => {
        const classes = [...new Set(evals.flatMap((e) => Object.keys(e?.perClass?.[m] ?? {})))];
        return <ClassBars key={m} classes={classes} sources={evals.map((e, i) => ({ label: runs[i]?.name ?? ids[i]!, colour: colour(i), values: e?.perClass?.[m] ?? {} })).filter((_, i) => evals[i])} />;
      })}
      {preds && (
        <SampleBrowser manifest={runPath(ids[firstIdx]!, preds)} ctx={{ run: ids[firstIdx], stage: "eval" }}
          others={ids.map((id, i) => ({ label: runs[i]?.name ?? id, manifest: runPath(id, preds) })).filter((_, i) => i !== firstIdx && evals[i]?.preds?.includes(preds))} />
      )}
    </section>
  );
}
