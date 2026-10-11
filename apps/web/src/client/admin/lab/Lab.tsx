// /admin/lab: the relief lab, Nick's console for the relief models' training on his Mac
// (docs/relief-ml/BRIEFS.md). It reads the run tree the trainer mirrors into the private bucket
// (docs/relief-ml/LAB-CONTRACT.md); everything here is live while the tab is open.
import { useCallback, useEffect, useState } from "react";
import type { LabFlag, LabIndex } from "@pokehd/protocol";
import { ago, listLab, useLab, useLastSync, type Event } from "./data.ts";
import type { Nav, Tab } from "./bits.tsx";
import { Overview } from "./Overview.tsx";
import { Pipeline } from "./Pipeline.tsx";
import { Compare, RunList } from "./Runs.tsx";
import { RunView } from "./RunView.tsx";
import { Flags, Journal } from "./Journal.tsx";
import { API } from "./data.ts";
import { me } from "../../room/account.ts";
import "./lab.css";

const TABS: [Tab, string][] = [["overview", "Overview"], ["pipeline", "Pipeline"], ["runs", "Runs"], ["compare", "Compare"], ["journal", "Journal"], ["flags", "Flags"]];

function readNav(): Nav {
  const q = new URLSearchParams(location.search);
  const tab = (q.get("tab") as Tab | null) ?? (q.get("run") ? "runs" : "overview");
  return { tab, ...Object.fromEntries([...q].filter(([k]) => k !== "tab")) };
}

export function Lab() {
  const [nav, setNav] = useState<Nav>(readNav);
  const go = useCallback((to: Nav) => {
    const q = new URLSearchParams(Object.entries(to).filter((e): e is [string, string] => !!e[1]));
    history.pushState(null, "", `/admin/lab?${q}`);
    setNav(to);
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const pop = () => setNav(readNav());
    addEventListener("popstate", pop);
    return () => removeEventListener("popstate", pop);
  }, []);

  // Every admin route answers 404 to anyone else, so ask who's signed in rather than guess from that.
  const [admin, setAdmin] = useState<boolean | undefined>(undefined);
  useEffect(() => { void me().then((a) => setAdmin(!!a?.admin)).catch(() => setAdmin(false)); }, []);
  const index = useLab<LabIndex>(admin ? "index.json" : null);
  const events = useLab<Event[]>("events.jsonl", { kind: "jsonl" });
  const [flags, setFlags] = useState<LabFlag[]>([]);
  const loadFlags = useCallback(async () => {
    if (!admin) return;
    const listed = await listLab("flags/");
    if (!listed) return;
    const docs = await Promise.all(listed.files.filter((f) => f.path.endsWith(".json")).map((f) => fetch(API + f.path).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
    setFlags((docs.filter(Boolean) as LabFlag[]).sort((a, b) => b.created.localeCompare(a.created)));
  }, [admin]);
  useEffect(() => {
    void loadFlags();
    const t = setInterval(() => { if (document.visibilityState === "visible") void loadFlags(); }, 30_000);
    return () => clearInterval(t);
  }, [loadFlags]);
  const synced = useLastSync();
  const fresh = synced && Date.now() - synced < 15_000;

  const openFlags = flags.filter((f) => f.status === "open").length;
  const questions = (events.data ?? []).filter((e) => e.kind === "question").length;
  const title = nav.tab === "runs" && nav.run ? "Run" : TABS.find(([t]) => t === nav.tab)?.[1] ?? "";
  useEffect(() => { document.title = `Relief lab · ${title}`; }, [title]);

  return (
    <main className="lab">
      <header className="lab-top">
        <a className="brand" href="/admin/lab" onClick={(e) => { e.preventDefault(); go({ tab: "overview" }); }}>Relief lab</a>
        <span className={`lab-live ${fresh ? "on" : ""}`} title={synced ? `Last answer from the server ${ago(synced)}` : "Not connected"}><i />{fresh ? "live" : synced ? ago(synced) : "connecting"}</span>
        {index.data?.updated && <span className="muted small hide-sm">trainer wrote {ago(index.data.updated)}</span>}
        <span className="grow" />
        <a href="/tools/relief" className="small">Relief editor</a>
      </header>
      <nav className="lab-tabs" aria-label="Sections">
        {TABS.map(([t, label]) => (
          <button type="button" key={t} aria-current={nav.tab === t ? "page" : undefined} onClick={() => go({ tab: t })}>
            {label}
            {t === "flags" && openFlags > 0 && <em>{openFlags}</em>}
            {t === "journal" && questions > 0 && <em className="q" title="Questions for you">?</em>}
          </button>
        ))}
      </nav>
      <div className="lab-body">
        {admin === false
          ? <Denied />
          : index.error === "missing"
            ? <Empty />
            : !index.data
            ? <p className="muted">{index.error ? `Couldn't reach the lab (${index.error}).` : "Loading…"}</p>
            : <Page nav={nav} index={index.data} events={events.data ?? []} flags={flags} go={go} reloadFlags={() => void loadFlags()} />}
      </div>
    </main>
  );
}

function Page({ nav, index, events, flags, go, reloadFlags }: { nav: Nav; index: LabIndex; events: Event[]; flags: LabFlag[]; go: (n: Nav) => void; reloadFlags: () => void }) {
  switch (nav.tab) {
    case "pipeline": return <Pipeline index={index} go={go} focusRun={nav.run} stage={nav.stage} dataset={nav.dataset} />;
    case "runs": return nav.run ? <RunView key={nav.run} id={nav.run} index={index} go={go} sample={{ set: nav.set, id: nav.sample }} /> : <RunList index={index} go={go} task={nav.task} />;
    case "compare": return <Compare ids={(nav.runs ?? "").split(",").filter(Boolean)} index={index} go={go} />;
    case "journal": return <Journal events={events} go={go} />;
    case "flags": return <Flags flags={flags} go={go} reload={reloadFlags} />;
    default: return <Overview index={index} events={events} flags={flags} go={go} />;
  }
}

function Empty() {
  return (
    <div className="lab-card">
      <h3>No runs yet</h3>
      <p>The trainer on the Mac hasn't published anything. Once it syncs, its runs appear here within a few seconds.</p>
      <p className="muted small">The data contract is docs/relief-ml/LAB-CONTRACT.md.</p>
    </div>
  );
}

function Denied() {
  return <div className="lab-card"><p>Only Nick can open the lab. <a href="/login">Sign in</a></p></div>;
}
