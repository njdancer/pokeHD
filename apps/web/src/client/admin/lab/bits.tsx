// Small pieces every lab page uses: navigation, status pills, progress bars and the journal's
// light Markdown (paragraphs, `- ` bullets, `code`, **bold**, [links](…)).
import { Fragment, type ReactNode } from "react";
import type { LabStatus } from "@pokehd/protocol";
import { duration } from "./data.ts";

export type Tab = "overview" | "pipeline" | "runs" | "compare" | "journal" | "flags";
export interface Nav { tab: Tab; run?: string; runs?: string; dataset?: string; stage?: string; set?: string; sample?: string; task?: string }
export type Go = (nav: Nav) => void;

const STATUS_WORDS: Record<LabStatus, string> = { queued: "queued", running: "running", done: "done", failed: "failed", stopped: "stopped" };
export function Status({ status }: { status: LabStatus }) {
  return <span className={`lab-status ${status}`}><i aria-hidden />{STATUS_WORDS[status] ?? status}</span>;
}

export function Progress({ done, total, unit, eta }: { done: number; total: number; unit?: string; eta?: string }) {
  const f = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0;
  const left = eta ? Date.parse(eta) - Date.now() : NaN;
  return (
    <span className="lab-progress" title={`${done} of ${total} ${unit ?? ""}`}>
      <span className="track"><span style={{ width: `${f * 100}%` }} /></span>
      <span className="small">{done}/{total} {unit}{Number.isFinite(left) && left > 0 ? `, ~${duration(left)} left` : ""}</span>
    </span>
  );
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("`")) out.push(<code key={k++}>{t.slice(1, -1)}</code>);
    else if (t.startsWith("**")) out.push(<b key={k++}>{t.slice(2, -2)}</b>);
    else {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t)!;
      const safe = /^(https?:|\/)/.test(href!) ? href : undefined;
      out.push(<a key={k++} href={safe} target="_blank" rel="noreferrer">{label}</a>);
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, inline: isInline }: { text: string; inline?: boolean }) {
  if (isInline) return <>{inline(text)}</>;
  return (
    <div className="lab-md">
      {text.split(/\n\s*\n/).map((para, i) => {
        const lines = para.split("\n");
        if (lines.every((l) => /^\s*- /.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*- /, ""))}</li>)}</ul>;
        return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</p>;
      })}
    </div>
  );
}

/** A link inside the lab that navigates without reloading. */
export function LabLink({ go, to, children, className }: { go: Go; to: Nav; children: ReactNode; className?: string }) {
  const q = new URLSearchParams(Object.entries(to).filter((e): e is [string, string] => !!e[1]));
  return <a className={className} href={`/admin/lab?${q}`} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go(to); }}>{children}</a>;
}
