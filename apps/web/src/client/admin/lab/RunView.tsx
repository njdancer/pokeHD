// One run, top to bottom: why it exists and what changed, its stages, live curves, every
// evaluation (per class, confusion, per object, predictions), pictures, architecture and config.
import { useMemo, useState } from "react";
import type { LabEval, LabIndex, LabMetricDef, LabRun } from "@pokehd/protocol";
import { ClassBars, Confusion, LineChart, SERIES, smooth, Stat, type Line } from "./charts.tsx";
import { ago, fileUrl, fmt, metricDef, metricsPath, runPath, series, splitKey, useLab, type Row } from "./data.ts";
import { SampleBrowser } from "./Samples.tsx";
import { Arch } from "./Arch.tsx";
import { Markdown, Status, Progress, type Go } from "./bits.tsx";

export function RunView({ id, index, go, sample }: { id: string; index: LabIndex | undefined; go: Go; sample?: { set?: string; id?: string } }) {
  const run = useLab<LabRun>(runPath(id));
  const r = run.data;
  const parent = useLab<LabRun>(r?.parent ? runPath(r.parent) : null, { live: false });
  if (run.error) return <p className="muted">Couldn't load run {id} ({run.error}).</p>;
  if (!r) return <p className="muted">Loading run…</p>;
  const p = parent.data;
  return (
    <div className="lab-run">
      <header className="lab-runhead">
        <div className="lab-row wrap">
          <h2>{r.title ?? r.name ?? r.id}</h2>
          <Status status={r.status} />
          <span className="pill">{r.task}</span>
          {index?.best?.[r.task] === r.id && <span className="pill best">best {r.task}</span>}
        </div>
        <p className="muted small"><code>{r.id}</code>{r.host && ` · on ${r.host}`}{r.started && ` · started ${ago(r.started)}`}{r.updated && ` · updated ${ago(r.updated)}`}</p>
        {r.why && <p className="why"><b>Why:</b> {r.why}</p>}
        {(r.changes?.length || r.parent) && (
          <div className="changes">
            <b>Changes against {r.parent ? <a href="#" onClick={(e) => { e.preventDefault(); go({ tab: "runs", run: r.parent! }); }}>{p?.title ?? p?.name ?? r.parent}</a> : "nothing"}:</b>
            <ul>{(r.changes ?? []).map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        )}
        {r.datasets?.length ? <p className="small">Data: {r.datasets.map((d) => <a key={d} className="chip" href="#" onClick={(e) => { e.preventDefault(); go({ tab: "pipeline", dataset: d }); }}>{d}</a>)}</p> : null}
        {r.stages?.length ? <div className="lab-stages">{r.stages.map((s) => <div key={s.name} className={`stage ${s.status}`}><span>{s.name}</span><Status status={s.status} />{s.progress && <Progress {...s.progress} />}</div>)}</div> : null}
      </header>

      <Summary run={r} parent={p} index={index} />
      {r.findings?.length ? <section className="lab-card"><h3>Findings</h3><ul>{r.findings.map((f) => <li key={f}><Markdown text={f} inline /></li>)}</ul></section> : null}
      <Curves run={r} parent={p} index={index} />
      {r.evals?.length ? <Evals run={r} parent={p} index={index} sample={sample} /> : null}
      <Predictions run={r} parent={p} sample={sample} />
      {r.images?.length ? (
        <section className="lab-card"><h3>Pictures</h3>
          <div className="lab-gallery">{r.images.map((im) => (
            <figure key={im.path}><a href={fileUrl(runPath(r.id, im.path))} target="_blank" rel="noreferrer"><img src={fileUrl(runPath(r.id, im.path))} alt={im.caption ?? im.path} loading="lazy" /></a><figcaption>{im.caption ?? im.path}</figcaption></figure>
          ))}</div>
        </section>
      ) : null}
      {r.arch ? <section className="lab-card"><h3>Architecture</h3><Arch arch={r.arch} /></section> : null}
      <ConfigDiff a={p?.config} b={r.config} aLabel={p ? p.name ?? p.id : undefined} />
      <details className="lab-card"><summary>Raw run.json</summary><pre>{JSON.stringify(r, null, 1)}</pre></details>
    </div>
  );
}

function Summary({ run, parent, index }: { run: LabRun; parent?: LabRun; index?: LabIndex }) {
  const keys = Object.keys(run.summary ?? {}).filter((k) => typeof run.summary![k] === "number");
  if (!keys.length) return null;
  keys.sort((a, b) => Number(!!metricDef(b, run, index).primary) - Number(!!metricDef(a, run, index).primary));
  return (
    <section className="lab-stats">
      {keys.map((k) => {
        const def = metricDef(k, run, index), v = run.summary![k] as number, pv = parent?.summary?.[k];
        return <Stat key={k} label={def.label} value={fmt(v, def)} delta={typeof pv === "number" ? v - pv : null} better={def.better} help={def.help} />;
      })}
      {parent && <p className="muted small">Arrows compare with {parent.name ?? parent.id}; green is better.</p>}
    </section>
  );
}

/** Curves grouped by metric group; train solid, other splits dashed; the parent's faint. */
function Curves({ run, parent, index }: { run: LabRun; parent?: LabRun; index?: LabIndex }) {
  const rows = useLab<Row[]>(metricsPath(run.id), { kind: "jsonl", live: run.status === "running" || run.status === "queued" });
  const parentRows = useLab<Row[]>(parent ? metricsPath(parent.id) : null, { kind: "jsonl", live: false });
  const [k, setK] = useState(0.6);
  const [log, setLog] = useState(false);
  const [perClass, setPerClass] = useState(false);
  const [withParent, setWithParent] = useState(false);
  const s = useMemo(() => series(rows.data), [rows.data]);
  const ps = useMemo(() => series(parentRows.data), [parentRows.data]);
  const groups = useMemo(() => {
    const g = new Map<string, { def: LabMetricDef; keys: string[] }>();
    for (const key of s.keys()) {
      const { metric } = splitKey(key);
      if (metric === "lr") continue;
      const def = metricDef(metric, run, index);
      if (metric.includes("/") && !perClass) continue;
      const name = def.group ?? metric.replace(/^(val|train|test)_/, "");
      const entry = g.get(name) ?? { def, keys: [] };
      entry.keys.push(key);
      g.set(name, entry);
    }
    return [...g];
  }, [s, run, index, perClass]);
  if (rows.error === "missing") return <section className="lab-card"><h3>Curves</h3><p className="muted">No metrics yet.</p></section>;
  if (!rows.data) return <section className="lab-card"><h3>Curves</h3><p className="muted">Loading…</p></section>;
  const lr = s.get("lr");
  const last = rows.data[rows.data.length - 1];
  return (
    <section className="lab-card">
      <div className="lab-row wrap">
        <h3>Curves</h3>
        <span className="muted small">{rows.data.length.toLocaleString()} rows{last?.ts ? `, last ${ago(last.ts)}` : ""}{last?.epoch != null ? `, epoch ${last.epoch}` : ""}</span>
        <span className="grow" />
        <label className="small">Smoothing <input type="range" min={0} max={0.98} step={0.02} value={k} onChange={(e) => setK(Number(e.target.value))} /></label>
        <label className="small"><input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} /> Log scale</label>
        <label className="small"><input type="checkbox" checked={perClass} onChange={(e) => setPerClass(e.target.checked)} /> Per class</label>
        {parent && <label className="small"><input type="checkbox" checked={withParent} onChange={(e) => setWithParent(e.target.checked)} /> Show {parent.name ?? "parent"}</label>}
      </div>
      <div className="lab-grid2">
        {groups.map(([name, g]) => {
          const lines: Line[] = [];
          g.keys.forEach((key, i) => {
            const { metric, split } = splitKey(key);
            const def = metricDef(metric, run, index);
            const pts = s.get(key)!;
            const colour = SERIES[i % SERIES.length]!;
            lines.push({ key, label: `${def.label}${split ? ` (${split})` : ""}`, points: smooth(pts, pts.length > 30 ? k : 0), colour, dashed: !!split || /^val_/.test(metric) });
            const pp = withParent ? ps.get(key) : undefined;
            if (pp) lines.push({ key: `p:${key}`, label: `${parent!.name ?? "parent"}: ${def.label}`, points: smooth(pp, pp.length > 30 ? k : 0), colour: `color-mix(in oklab, ${colour} 45%, var(--panel))`, dashed: true });
          });
          return (
            <div key={name} className="lab-chartbox">
              <h4 title={g.def.help}>{name === g.def.group ? name : g.def.label}{g.def.better && <span className="muted small"> · {g.def.better} is better</span>}</h4>
              {g.def.help && <p className="muted small">{g.def.help}</p>}
              <LineChart lines={lines} log={log} />
            </div>
          );
        })}
        {lr && (
          <div className="lab-chartbox">
            <h4>Learning rate</h4>
            <p className="muted small">How big each correction step is. It ramps up, then winds down so the model settles.</p>
            <LineChart lines={[{ key: "lr", label: "learning rate", points: lr, colour: SERIES[5]! }]} height={120} />
          </div>
        )}
      </div>
    </section>
  );
}

function Evals({ run, parent, index, sample }: { run: LabRun; parent?: LabRun; index?: LabIndex; sample?: { set?: string; id?: string } }) {
  const [name, setName] = useState(() => run.evals!.find((e) => sample?.set?.includes(`/preds/${e}`)) ?? run.evals![0]!);
  const ev = useLab<LabEval>(runPath(run.id, `evals/${name}.json`), { live: run.status !== "done" });
  const pev = useLab<LabEval>(parent?.evals?.includes(name) ? runPath(parent.id, `evals/${name}.json`) : null, { live: false });
  const e = ev.data;
  return (
    <section className="lab-card">
      <div className="lab-row wrap">
        <h3>Evaluations</h3>
        <div className="lab-seg" role="tablist">{run.evals!.map((n) => <button type="button" key={n} aria-pressed={n === name} onClick={() => setName(n)}>{n}</button>)}</div>
      </div>
      {!e ? <p className="muted">{ev.error ? `Not written yet (${ev.error}).` : "Loading…"}</p> : (
        <>
          <div className="lab-row wrap">
            <strong>{e.title ?? e.name}</strong>{e.split && <span className="muted small">on {e.split}</span>}
            {e.circular && <span className="pill warn" title="Graded by the same rule labels the model trained on, so a high score only says it learned the rule.">circular: not a quality score</span>}
          </div>
          <div className="lab-stats">
            {Object.entries(e.overall).map(([k, v]) => {
              const def = metricDef(k, run, index), pv = pev.data?.overall[k];
              return <Stat key={k} label={def.label} value={fmt(v, def)} delta={v != null && typeof pv === "number" ? v - pv : null} better={def.better} help={def.help} />;
            })}
          </div>
          {e.perClass && Object.entries(e.perClass).map(([metric, values]) => {
            const classes = run.classes?.filter((c) => c in values) ?? Object.keys(values);
            const sources = [{ label: run.name ?? run.id, colour: SERIES[0]!, values }];
            const pv = pev.data?.perClass?.[metric];
            if (pv) sources.push({ label: parent!.name ?? parent!.id, colour: SERIES[1]!, values: pv });
            const def = metricDef(metric, run, index);
            const pct = Object.values(values).every((v) => v == null || (v >= 0 && v <= 1));
            return <div key={metric}><h4>{def.label} per class</h4><ClassBars classes={classes} sources={sources} max={pct ? 1 : Math.max(...Object.values(values).map((v) => v ?? 0))} format={pct ? undefined : (v) => v.toFixed(2)} /></div>;
          })}
          {e.confusion && <div><h4>Where it goes wrong</h4><Confusion labels={e.confusion.labels} matrix={e.confusion.matrix} /></div>}
          {e.perObject?.length ? <PerObject e={e} /> : null}
          {e.preds?.map((p) => (
            <SampleBrowser key={p} manifest={runPath(run.id, p)} ctx={{ run: run.id, runTitle: run.title ?? run.name, stage: "eval" }}
              initial={sample?.set === runPath(run.id, p) ? sample.id : undefined}
              others={parent?.evals?.includes(name) ? [{ label: parent.name ?? parent.id, manifest: runPath(parent.id, p) }] : []} />
          ))}
        </>
      )}
    </section>
  );
}

/** Prediction manifests outside the evals, e.g. the watch set the trainer refreshes every epoch. */
function Predictions({ run, parent, sample }: { run: LabRun; parent?: LabRun; sample?: { set?: string; id?: string } }) {
  const own = (run.preds ?? []).filter((p) => !run.evals?.some((e) => p === `preds/${e}.json`));
  if (!own.length) return null;
  return (
    <section className="lab-card">
      <h3>Predictions</h3>
      <p className="muted small">{run.status === "running" ? "Refreshed as the model trains: watch them change epoch by epoch." : "What the model made of these samples."}</p>
      {own.map((p) => (
        <SampleBrowser key={p} manifest={runPath(run.id, p)} ctx={{ run: run.id, runTitle: run.title ?? run.name, stage: "train" }}
          initial={sample?.set === runPath(run.id, p) ? sample.id : undefined}
          others={parent?.preds?.includes(p) ? [{ label: parent.name ?? parent.id, manifest: runPath(parent.id, p) }] : []} />
      ))}
    </section>
  );
}

function PerObject({ e }: { e: LabEval }) {
  const keys = [...new Set(e.perObject!.flatMap((o) => Object.keys(o.scores)))];
  const [by, setBy] = useState(keys[0]);
  const rows = [...e.perObject!].sort((a, b) => (a.scores[by!] ?? 0) - (b.scores[by!] ?? 0));
  return (
    <div>
      <h4>Per object, worst first</h4>
      <table className="lab-table small">
        <thead><tr><th>Object</th>{keys.map((k) => <th key={k}><button type="button" className="link" onClick={() => setBy(k)}>{k}{by === k ? " ↑" : ""}</button></th>)}</tr></thead>
        <tbody>{rows.map((o) => (
          <tr key={o.id}><td>{o.title ?? o.id}{o.sample && <code className="muted"> {o.sample}</code>}</td>{keys.map((k) => {
            const v = o.scores[k];
            return <td key={k} className="num"><span className="cellbar" style={{ width: `${v != null && v <= 1 ? v * 100 : 0}%` }} />{v == null ? "–" : v <= 1 ? `${Math.round(v * 100)}%` : v.toFixed(2)}</td>;
          })}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/** Config as a flat table; keys that differ from the parent are highlighted with the old value. */
export function ConfigDiff({ a, b, aLabel }: { a?: Record<string, unknown>; b: Record<string, unknown>; aLabel?: string }) {
  const [onlyDiff, setOnlyDiff] = useState(!!a);
  const fa = flatten(a ?? {}), fb = flatten(b);
  const keys = [...new Set([...Object.keys(fb), ...Object.keys(fa)])].sort();
  const changed = (k: string) => !!a && JSON.stringify(fa[k]) !== JSON.stringify(fb[k]);
  const shown = keys.filter((k) => !onlyDiff || changed(k));
  return (
    <section className="lab-card">
      <div className="lab-row wrap"><h3>Config</h3>{a && <label className="small"><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Only what changed against {aLabel}</label>}</div>
      {shown.length ? (
        <table className="lab-table small mono">
          <tbody>{shown.map((k) => (
            <tr key={k} className={changed(k) ? "changed" : ""}><td>{k}</td><td>{show(fb[k])}</td>{a && <td className="muted">{changed(k) ? `was ${show(fa[k])}` : ""}</td>}</tr>
          ))}</tbody>
        </table>
      ) : <p className="muted small">Same config as {aLabel}.</p>}
    </section>
  );
}

export function flatten(o: Record<string, unknown>, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v as Record<string, unknown>, `${prefix}${k}.`, out);
    else out[prefix + k] = v;
  }
  return out;
}
const show = (v: unknown) => (v === undefined ? "–" : typeof v === "string" ? v : JSON.stringify(v));
