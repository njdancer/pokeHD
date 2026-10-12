// The ops agent's journal (events.jsonl) and Nick's flags, with their answers.
import { useState } from "react";
import type { LabFlag } from "@pokehd/protocol";
import { ago, fileUrl, putLab, type Event } from "./data.ts";
import { LabLink, Markdown, type Go } from "./bits.tsx";
import { copyText, issueCard } from "./issue.ts";

const KIND_WORDS: Record<string, string> = { finding: "Finding", decision: "Decision", question: "Question for you", milestone: "Milestone", note: "Note", status: "Status" };

export function EventCard({ e, go, compact }: { e: Event; go: Go; compact?: boolean }) {
  return (
    <article className={`lab-event ${e.kind}`}>
      <header><span className="kind">{KIND_WORDS[e.kind] ?? e.kind}</span><b>{e.title}</b><span className="muted small">{ago(e.ts)}</span></header>
      {!compact && e.body && <Markdown text={e.body} />}
      {!compact && e.images?.length ? <div className="lab-gallery">{e.images.map((im) => <figure key={im.path}><a href={fileUrl(im.path)} target="_blank" rel="noreferrer"><img src={fileUrl(im.path)} alt={im.caption ?? ""} loading="lazy" /></a>{im.caption && <figcaption>{im.caption}</figcaption>}</figure>)}</div> : null}
      {(e.runs?.length || e.links?.length) ? (
        <p className="small">
          {e.runs?.map((r) => <LabLink key={r} go={go} to={{ tab: "runs", run: r }} className="chip">{r}</LabLink>)}
          {e.links?.map((l) => <a key={l.url} className="chip" href={/^https?:/.test(l.url) ? l.url : undefined} target="_blank" rel="noreferrer">{l.title} ↗</a>)}
        </p>
      ) : null}
    </article>
  );
}

export function Journal({ events, go }: { events: Event[]; go: Go }) {
  const [kind, setKind] = useState<string>("all");
  const kinds = ["all", ...new Set(events.map((e) => e.kind))];
  const list = [...events].reverse().filter((e) => kind === "all" || e.kind === kind);
  return (
    <div className="lab-journal">
      <div className="lab-seg">{kinds.map((k) => <button type="button" key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{k === "all" ? "All" : KIND_WORDS[k] ?? k}</button>)}</div>
      {list.length ? list.map((e, i) => <EventCard key={`${e.ts}-${i}`} e={e} go={go} />) : <p className="muted">Nothing here yet.</p>}
    </div>
  );
}

export function Flags({ flags, go, reload }: { flags: LabFlag[]; go: Go; reload: () => void }) {
  const [status, setStatus] = useState<string>("open");
  const [copied, setCopied] = useState("");
  const list = flags.filter((f) => status === "all" || f.status === status || (status === "open" && f.status === "seen"));
  const close = async (f: LabFlag) => {
    await putLab(`flags/${f.id}.json`, JSON.stringify({ ...f, status: "wontfix", reply: f.reply ?? "Withdrawn by Nick.", updated: new Date().toISOString() }));
    reload();
  };
  return (
    <div className="lab-flags">
      <p className="muted small">Flags you've raised on samples and runs. The ops agent reads the open ones, works them and answers here. Copy one as an issue card to paste to it in a thread.</p>
      <div className="lab-seg">{["open", "fixed", "wontfix", "all"].map((s) => <button type="button" key={s} aria-pressed={status === s} onClick={() => setStatus(s)}>{s}</button>)}</div>
      {list.length ? list.map((f) => (
        <article key={f.id} className={`lab-flag ${f.status}`}>
          <header><span className={`pill ${f.status}`}>{f.status}</span><b>{f.kind.replace("-", " ")}</b><span className="muted small">{ago(f.created)}</span></header>
          <p>{f.note}</p>
          <p className="small muted">
            {f.run && <LabLink go={go} to={{ tab: "runs", run: f.run, set: f.sample?.manifest, sample: f.sample?.id }} className="chip">{f.run}</LabLink>}
            {f.sample && <code>{f.sample.id}</code>}{f.box && ` box ${f.box.join(", ")}`}
          </p>
          {f.reply && <p className="reply"><b>Ops agent:</b> {f.reply}</p>}
          <div className="lab-row">
            <button type="button" onClick={async () => setCopied((await copyText(issueCard(f))) ? f.id : "")}>{copied === f.id ? "Copied" : "Copy issue card"}</button>
            {(f.status === "open" || f.status === "seen") && <button type="button" onClick={() => void close(f)}>Withdraw</button>}
          </div>
        </article>
      )) : <p className="muted">No {status === "all" ? "" : status} flags.</p>}
    </div>
  );
}
