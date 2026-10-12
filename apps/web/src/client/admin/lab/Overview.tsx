// The front page: what Nick cares about first. What the ops agent is doing and why, the best model
// per task and what it changed, runs in progress, how long since each task last improved, the
// latest findings and the flags still waiting.
import { useMemo } from "react";
import type { LabFlag, LabIndex, LabRun } from "@pokehd/protocol";
import { ago, duration, fileUrl, fmt, metricDef, metricsPath, primaryMetric, runPath, series, useLab, type Event, type Row } from "./data.ts";
import { LabLink, Progress, Status, type Go } from "./bits.tsx";
import { Sparkline, Stat } from "./charts.tsx";
import { EventCard } from "./Journal.tsx";

/** The ops agent stops when a task hasn't improved for this long (Nick, 2026-10-11). */
const PLATEAU_MS = 6 * 3600_000;

export function Overview({ index, events, flags, go }: { index: LabIndex; events: Event[]; flags: LabFlag[]; go: Go }) {
  const running = index.runs.filter((r) => r.status === "running" || r.status === "queued");
  const tasks = useMemo(() => [...new Set([...Object.keys(index.best ?? {}), ...index.runs.map((r) => r.task)])], [index]);
  const latest = [...events].reverse().filter((e) => e.kind !== "status").slice(0, 4);
  const questions = [...events].reverse().filter((e) => e.kind === "question").slice(0, 3);
  const open = flags.filter((f) => f.status === "open" || f.status === "seen");
  const ops = index.ops;
  return (
    <div className="lab-overview">
      <section className="lab-card lab-now">
        <h3>Now</h3>
        {ops?.doing ? (
          <>
            <p className="doing">{ops.doing}</p>
            {ops.why && <p><b>Why:</b> {ops.why}</p>}
            {ops.next?.length ? <div><b>Next:</b><ol>{ops.next.map((n) => <li key={n}>{n}</li>)}</ol></div> : null}
            <p className="muted small">{ops.updated ? `Updated ${ago(ops.updated)}` : ""}{ops.runs?.length ? <> · {ops.runs.map((r) => <LabLink key={r} go={go} to={{ tab: "runs", run: r }} className="chip">{r}</LabLink>)}</> : null}</p>
          </>
        ) : <p className="muted">The ops agent hasn't said what it's doing yet.</p>}
        {questions.length > 0 && <div className="lab-questions"><b>Waiting on you:</b>{questions.map((q, i) => <EventCard key={i} e={q} go={go} compact />)}</div>}
      </section>

      <section className="lab-card">
        <h3>Best model per task</h3>
        <div className="lab-best">{tasks.map((t) => <BestCard key={t} task={t} index={index} go={go} />)}</div>
      </section>

      {running.length > 0 && (
        <section className="lab-card">
          <h3>Running</h3>
          {running.map((r) => <LiveRun key={r.id} id={r.id} index={index} go={go} />)}
        </section>
      )}

      {Object.keys(ops?.lastImproved ?? {}).length > 0 && (
        <section className="lab-card">
          <h3>Plateau watch</h3>
          <p className="muted small">Time since each task's best score last improved. Training stops when one goes 6 hours without improving.</p>
          {Object.entries(ops!.lastImproved!).map(([task, at]) => {
            const ms = Date.now() - Date.parse(at), f = Math.min(1, ms / PLATEAU_MS);
            return (
              <div key={task} className="lab-plateau">
                <span>{task}</span>
                <span className="track"><span style={{ width: `${f * 100}%` }} className={f >= 1 ? "over" : f > 0.66 ? "near" : ""} /></span>
                <span className="small">{duration(ms)} of 6 h</span>
              </div>
            );
          })}
        </section>
      )}

      <section className="lab-card">
        <div className="lab-row"><h3>Latest from the ops agent</h3><span className="grow" /><LabLink go={go} to={{ tab: "journal" }} className="small">all</LabLink></div>
        {latest.length ? latest.map((e, i) => <EventCard key={i} e={e} go={go} />) : <p className="muted">Nothing yet.</p>}
      </section>

      <section className="lab-card">
        <div className="lab-row"><h3>Your flags</h3><span className="grow" /><LabLink go={go} to={{ tab: "flags" }} className="small">all</LabLink></div>
        {open.length ? <ul className="small">{open.slice(0, 5).map((f) => <li key={f.id}><span className={`pill ${f.status}`}>{f.status}</span> {f.note}{f.reply && <span className="muted"> · {f.reply}</span>}</li>)}</ul> : <p className="muted small">No open flags. Flag any sample from its viewer.</p>}
      </section>
    </div>
  );
}

function BestCard({ task, index, go }: { task: string; index: LabIndex; go: Go }) {
  const id = index.best?.[task];
  const run = useLab<LabRun>(id ? runPath(id) : null, { live: false }).data;
  const parent = useLab<LabRun>(run?.parent ? runPath(run.parent) : null, { live: false }).data;
  if (!id) return <div className="lab-bestcard muted"><b>{task}</b><p className="small">No best run picked yet.</p></div>;
  if (!run) return <div className="lab-bestcard"><b>{task}</b><p className="muted small">Loading…</p></div>;
  const m = primaryMetric(run.summary, run, index);
  const pic = run.images?.find((im) => im.kind === "3d") ?? run.images?.[0];
  const pv = m && typeof parent?.summary?.[m.key] === "number" ? (parent.summary[m.key] as number) : null;
  return (
    <LabLink go={go} to={{ tab: "runs", run: id }} className="lab-bestcard">
      <span className="task">{task}</span>
      <b>{run.title ?? run.name ?? run.id}</b>
      {m && <Stat label={m.def.label} value={fmt(m.value, m.def)} delta={pv != null ? m.value - pv : null} better={m.def.better} help={m.def.help} />}
      {run.changes?.length ? <span className="small muted">Changed: {run.changes.slice(0, 2).join("; ")}{run.changes.length > 2 ? "…" : ""}</span> : null}
      {pic && <img src={fileUrl(runPath(run.id, pic.path))} alt={pic.caption ?? ""} loading="lazy" />}
    </LabLink>
  );
}

function LiveRun({ id, index, go }: { id: string; index: LabIndex; go: Go }) {
  const run = useLab<LabRun>(runPath(id)).data;
  const rows = useLab<Row[]>(metricsPath(id), { kind: "jsonl" }).data;
  const s = useMemo(() => series(rows), [rows]);
  const loss = s.get("loss") ?? s.get("epoch_loss");
  const m = primaryMetric(run?.summary, run, index);
  if (!run) return null;
  const stage = run.stages?.find((x) => x.status === "running") ?? run.stages?.find((x) => x.status === "queued");
  return (
    <LabLink go={go} to={{ tab: "runs", run: id }} className="lab-liverun">
      <span className="title"><Status status={run.status} /> <b>{run.title ?? run.name ?? id}</b></span>
      {run.why && <span className="small muted">{run.why}</span>}
      <span className="small">{stage ? <>{stage.name} {stage.progress && <Progress {...stage.progress} />}</> : null}</span>
      <span className="row">
        {loss && <span className="small">{metricDef("loss", run, index).label} <Sparkline points={loss.slice(-300)} /></span>}
        {m && <span className="small">{m.def.label} <b>{fmt(m.value, m.def)}</b></span>}
        {run.updated && <span className="small muted">updated {ago(run.updated)}</span>}
      </span>
    </LabLink>
  );
}

