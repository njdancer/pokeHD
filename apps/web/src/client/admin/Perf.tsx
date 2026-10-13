// /admin/perf: how smoothly the game runs on every device playing (sent by ../perf.ts), for Nick
// only. One row per page load, newest first; open one to see its device and its windows of play.
import { Fragment, useCallback, useEffect, useState } from "react";
import type { Device, PerfReport } from "@pokehd/protocol";
import "./errors.css";
import "./perf.css";

interface Session {
  visit: string;
  player: string | null;
  label: string;
  device: Device;
  backend: string;
  quality: string | null;
  build: string;
  firstAt: number;
  lastAt: number;
  windows: number;
  minutes: number;
  fps: number;
  p95Ms: number;
  missed: number;
  emuFps: number;
  emuFpsMin: number;
  scale: number | null;
  cpuMs: number | null;
  stalls: number;
}

interface Window extends PerfReport {
  id: number;
  at: number;
}

type State = { k: "loading" } | { k: "denied" } | { k: "failed"; why: string } | { k: "ready"; sessions: Session[] };

/** The Game Boy's own frame rate: an emulator slower than this is the game itself running slow. */
const GAME_BOY_FPS = 59.7;

export function Perf() {
  const [state, setState] = useState<State>({ k: "loading" });
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => fetchSessions().then(setState), []);

  useEffect(() => {
    let live = true;
    void fetchSessions().then((loaded) => live && setState(loaded));
    return () => {
      live = false;
    };
  }, []);

  return (
    <main className="errors-page perf-page">
      <h1>Performance</h1>
      <p className="muted">
        Frame rates from every device playing, one row per page load, newest first. Only time the game is on screen counts.
        Missed is the share of frames slower than 60 fps; emu is the Game Boy's own speed (59.7 when it keeps up).
      </p>
      <div className="bar">
        <button onClick={() => void load()}>Refresh</button>
        <a href="/" className="muted">Back to the game</a>
      </div>
      {state.k === "loading" && <p className="muted">Loading…</p>}
      {state.k === "denied" && (
        <p>
          Only Nick can read these. <a href="/login">Sign in</a>
        </p>
      )}
      {state.k === "failed" && <p className="status bad">Couldn't load telemetry: {state.why}</p>}
      {state.k === "ready" && state.sessions.length === 0 && <p className="muted">Nobody has played long enough to report yet.</p>}
      {state.k === "ready" && state.sessions.length > 0 && (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Device</th>
                <th>Renderer</th>
                <th className="num">Min</th>
                <th className="num">FPS</th>
                <th className="num">p95 ms</th>
                <th className="num">Missed</th>
                <th className="num">Emu fps</th>
                <th className="num">Scale</th>
                <th className="num">CPU ms</th>
                <th className="num">Stalls</th>
              </tr>
            </thead>
            <tbody>
              {state.sessions.map((s) => (
                <Fragment key={s.visit}>
                  <tr className={`session${open === s.visit ? " open" : ""}`} onClick={() => setOpen(open === s.visit ? null : s.visit)}>
                    <td>{when(s.lastAt)}</td>
                    <td>{s.player ?? "signed out"}</td>
                    <td>{s.label}</td>
                    <td>{s.backend}{s.quality ? ` · ${s.quality}` : ""}</td>
                    <td className="num">{s.minutes}</td>
                    <td className={`num${s.fps < 45 ? " bad" : ""}`}>{s.fps}</td>
                    <td className="num">{s.p95Ms}</td>
                    <td className={`num${s.missed > 0.2 ? " bad" : ""}`}>{pct(s.missed)}</td>
                    <td className={`num${s.emuFpsMin < GAME_BOY_FPS - 2 ? " bad" : ""}`}>
                      {s.emuFps}{s.emuFpsMin < s.emuFps ? ` (min ${s.emuFpsMin})` : ""}
                    </td>
                    <td className="num">{s.scale === null ? "–" : pct(s.scale)}</td>
                    <td className="num">{s.cpuMs ?? "–"}</td>
                    <td className="num">{s.stalls}</td>
                  </tr>
                  {open === s.visit && (
                    <tr className="detail">
                      <td colSpan={12}>
                        <SessionView session={s} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

async function fetchSessions(): Promise<State> {
  try {
    const response = await fetch("/api/admin/perf");
    if (response.status === 404 || response.status === 401) return { k: "denied" };
    if (!response.ok) return { k: "failed", why: `HTTP ${response.status}` };
    return { k: "ready", sessions: ((await response.json()) as { sessions: Session[] }).sessions };
  } catch (e) {
    return { k: "failed", why: String(e) };
  }
}

function SessionView({ session: s }: { session: Session }) {
  const [windows, setWindows] = useState<Window[] | null>(null);
  const d = s.device;

  useEffect(() => {
    void fetch(`/api/admin/perf/windows?visit=${encodeURIComponent(s.visit)}`)
      .then((res) => res.json() as Promise<{ windows: Window[] }>)
      .then((body) => setWindows(body.windows))
      .catch(() => setWindows([]));
  }, [s.visit]);

  return (
    <div className="body">
      <dl>
        <dt>Played</dt>
        <dd>
          {new Date(s.firstAt).toLocaleString()} to {new Date(s.lastAt).toLocaleTimeString()}, {s.minutes} min in {s.windows}{" "}
          {s.windows === 1 ? "window" : "windows"}
        </dd>
        <dt>Build</dt>
        <dd>{s.build}</dd>
        <dt>Device</dt>
        <dd>
          {d.screen} @{d.dpr}x{d.standalone ? ", home-screen app" : ""}
          {d.gpu ? `, ${d.gpu}` : ""}
          {d.memory ? `, ${d.memory} GB` : ""}
          {d.cores ? `, ${d.cores} cores` : ""}
        </dd>
        <dt>Browser</dt>
        <dd>{d.ua}</dd>
      </dl>
      {!windows && <p className="muted">Loading windows…</p>}
      {windows && windows.length > 0 && (
        <div className="scroll">
          <table className="windows">
            <thead>
              <tr>
                <th>At</th>
                <th className="num">Secs</th>
                <th className="num">FPS</th>
                <th className="num">p50 / p95 / worst ms</th>
                <th className="num">Missed</th>
                <th className="num">Stalls</th>
                <th className="num">Emu</th>
                <th className="num">Scale</th>
                <th className="num">DoF</th>
                <th className="num">CPU ms</th>
                <th className="num">Drawn/s</th>
                <th>Doing</th>
                <th className="num">Map</th>
              </tr>
            </thead>
            <tbody>
              {windows.map((w) => (
                <tr key={w.id}>
                  <td>{new Date(w.at).toLocaleTimeString()}</td>
                  <td className="num">{w.seconds}</td>
                  <td className={`num${w.fps < 45 ? " bad" : ""}`}>{w.fps}</td>
                  <td className="num">
                    {w.p50Ms} / {w.p95Ms} / {w.worstMs}
                  </td>
                  <td className={`num${w.missed > 0.2 ? " bad" : ""}`}>{pct(w.missed)}</td>
                  <td className="num">{w.stalls}</td>
                  <td className={`num${w.emuFps < GAME_BOY_FPS - 2 ? " bad" : ""}`}>{w.emuFps}</td>
                  <td className="num">{w.scale === undefined ? "–" : pct(w.scale)}</td>
                  <td className="num">{w.dof === undefined ? "–" : pct(w.dof)}</td>
                  <td className="num">{w.cpuMs ?? "–"}</td>
                  <td className="num">{w.drawn ?? "–"}</td>
                  <td>{doing(w.modes)}</td>
                  <td className="num">{w.map ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** What the window was spent on, biggest share first: "overworld 70% · battle 30%". */
function doing(modes: PerfReport["modes"]): string {
  return Object.entries(modes)
    .filter(([, share]) => share >= 0.05)
    .sort((a, b) => b[1] - a[1])
    .map(([mode, share]) => `${mode} ${pct(share)}`)
    .join(" · ");
}

const pct = (share: number) => `${Math.round(share * 100)}%`;

function when(ms: number): string {
  const ago = Date.now() - ms;
  return ago < 60_000 ? "just now" : ago < 3_600_000 ? `${Math.round(ago / 60_000)} min ago` : ago < 86_400_000 ? `${Math.round(ago / 3_600_000)} h ago` : new Date(ms).toLocaleDateString();
}
