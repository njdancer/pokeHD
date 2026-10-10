// /admin/errors: crash reports from players' devices (sent by ../errors.ts), for Nick only.
import { useCallback, useEffect, useState } from "react";
import type { ErrorReport } from "@pokehd/protocol";
import "./errors.css";

interface Report extends ErrorReport {
  id: number;
  at: number;
  fingerprint: string;
  player: { id: string; name: string } | null;
}

interface Group {
  fingerprint: string;
  count: number;
  visits: number;
  firstAt: number;
  lastAt: number;
  players: string[];
  builds: string[];
  latest: Report;
}

type State = { k: "loading" } | { k: "denied" } | { k: "failed"; why: string } | { k: "ready"; groups: Group[] };

export function Errors() {
  const [state, setState] = useState<State>({ k: "loading" });

  const load = useCallback(() => fetchGroups().then(setState), []);

  useEffect(() => {
    let live = true;
    void fetchGroups().then((loaded) => live && setState(loaded));
    return () => {
      live = false;
    };
  }, []);

  const forget = async (fingerprint?: string) => {
    if (!fingerprint && !confirm("Forget every crash report?")) return;
    const query = fingerprint ? `?fp=${encodeURIComponent(fingerprint)}` : "";
    await fetch(`/api/admin/errors${query}`, { method: "DELETE" });
    await load();
  };

  return (
    <main className="errors-page">
      <h1>Crash reports</h1>
      <p className="muted">Errors from every device playing, grouped by problem, newest first.</p>
      <div className="bar">
        <button onClick={() => void load()}>Refresh</button>
        {state.k === "ready" && state.groups.length > 0 && <button onClick={() => void forget()}>Forget all</button>}
        <a href="/" className="muted">Back to the game</a>
      </div>
      {state.k === "loading" && <p className="muted">Loading…</p>}
      {state.k === "denied" && (
        <p>
          Only Nick can read these. <a href="/login">Sign in</a>
        </p>
      )}
      {state.k === "failed" && <p className="status bad">Couldn't load reports: {state.why}</p>}
      {state.k === "ready" && state.groups.length === 0 && <p className="muted">No crashes reported. 🎉</p>}
      {state.k === "ready" && state.groups.map((g) => <GroupView key={g.fingerprint} group={g} onForget={() => void forget(g.fingerprint)} />)}
    </main>
  );
}

async function fetchGroups(): Promise<State> {
  try {
    const response = await fetch("/api/admin/errors");
    if (response.status === 404 || response.status === 401) return { k: "denied" };
    if (!response.ok) return { k: "failed", why: `HTTP ${response.status}` };
    return { k: "ready", groups: ((await response.json()) as { groups: Group[] }).groups };
  } catch (e) {
    return { k: "failed", why: String(e) };
  }
}

function GroupView({ group, onForget }: { group: Group; onForget: () => void }) {
  const [open, setOpen] = useState(false);
  const [reports, setReports] = useState<Report[] | null>(null);
  const r = group.latest;

  useEffect(() => {
    if (!open || reports) return;
    void fetch(`/api/admin/errors/reports?fp=${encodeURIComponent(group.fingerprint)}`)
      .then((res) => res.json() as Promise<{ reports: Report[] }>)
      .then((body) => setReports(body.reports))
      .catch(() => setReports([]));
  }, [open, reports, group.fingerprint]);

  return (
    <details className="group" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className="kind">{r.kind}</span>
        <span className="message">{r.message}</span>
        <span className="meta">
          <span>
            {group.count}× in {group.visits} {group.visits === 1 ? "visit" : "visits"}
          </span>
          <span>last {when(group.lastAt)}</span>
          {group.firstAt !== group.lastAt && <span>first {when(group.firstAt)}</span>}
          <span>{group.players.join(", ")}</span>
        </span>
      </summary>
      {open && (
        <div className="body">
          <dl>
            <dt>Who</dt>
            <dd>{r.player?.name ?? "signed out"}</dd>
            <dt>Page</dt>
            <dd>{r.page}</dd>
            <dt>Build</dt>
            <dd>{group.builds.join(", ")}</dd>
            <dt>After</dt>
            <dd>{seconds(r.uptime)} on the page</dd>
            <dt>Device</dt>
            <dd>
              {r.device.screen} @{r.device.dpr}x{r.device.standalone ? ", home-screen app" : ""}
              {r.device.renderer ? `, ${r.device.renderer}` : ""}
              {r.device.gpu ? `, ${r.device.gpu}` : ""}
              {r.device.memory ? `, ${r.device.memory} GB` : ""}
            </dd>
            <dt>Browser</dt>
            <dd>{r.device.ua}</dd>
          </dl>
          {r.stack && <Block title="Stack" text={r.stack} />}
          {r.componentStack && <Block title="Components" text={r.componentStack.trim()} />}
          {r.log && r.log.length > 0 && <Block title="Console before it" text={r.log.join("\n")} />}
          {reports && reports.length > 1 && (
            <div>
              <h3>Recent occurrences</h3>
              <div className="occurrences">
                {reports.map((o) => (
                  <span key={o.id}>
                    {when(o.at)} · {o.player?.name ?? "signed out"} · {o.page} · {o.build}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <button onClick={onForget}>Forget this one</button>
          </div>
        </div>
      )}
    </details>
  );
}

function Block({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h3>{title}</h3>
      <pre>{text}</pre>
    </div>
  );
}

function when(ms: number): string {
  const ago = Date.now() - ms;
  const rel =
    ago < 60_000 ? "just now" : ago < 3_600_000 ? `${Math.round(ago / 60_000)} min ago` : ago < 86_400_000 ? `${Math.round(ago / 3_600_000)} h ago` : `${Math.round(ago / 86_400_000)} d ago`;
  return `${rel} (${new Date(ms).toLocaleString()})`;
}

const seconds = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);
