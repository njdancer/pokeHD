// Prints the game's perf telemetry (/admin/perf) for agents: `pnpm perf` lists page loads, one per
// line, the most recently played first; `pnpm perf <n>` shows load n's device in full and its windows.
// Needs POKEHD_DEV_ROM_TOKEN (cloud sandboxes; read-only here), POKEHD_ADMIN_TOKEN, or
// ~/.config/pokehd/admin-token on Nick's Mac. Never print either.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const base = `${process.env.POKEHD_URL ?? "https://pokehd.dncr.me"}/api/admin/perf`;
const token = process.env.POKEHD_ADMIN_TOKEN ?? readToken() ?? process.env.POKEHD_DEV_ROM_TOKEN;
if (!token) {
  console.error("Set POKEHD_DEV_ROM_TOKEN or POKEHD_ADMIN_TOKEN.");
  process.exit(1);
}

function readToken(): string | undefined {
  try {
    return readFileSync(`${homedir()}/.config/pokehd/admin-token`, "utf8").trim();
  } catch {
    return undefined;
  }
}

async function get<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

interface Session {
  visit: string;
  player: string | null;
  label: string;
  device: Record<string, unknown>;
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

interface Window {
  at: number;
  uptime: number;
  seconds: number;
  fps: number;
  p50Ms: number;
  p95Ms: number;
  worstMs: number;
  missed: number;
  stalls: number;
  emuFps: number;
  cpuMs?: number;
  scale?: number;
  dof?: number;
  drawn?: number;
  modes: Record<string, number>;
  map?: number;
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
const pct = (share: number) => `${Math.round(share * 100)}%`;
const limit = process.argv[2] ? Math.max(50, Number(process.argv[2])) : 50;
const { sessions } = await get<{ sessions: Session[] }>(`${base}?limit=${limit}`);
const pick = process.argv[2] ? Number(process.argv[2]) : null;

if (pick === null) {
  if (!sessions.length) console.log("No perf telemetry.");
  sessions.forEach((s, i) => {
    const engine = s.scale === null ? "" : `, scale ${pct(s.scale)}, cpu ${s.cpuMs} ms`;
    console.log(
      `${i + 1}. ${iso(s.lastAt)} ${s.player ?? "signed out"}, ${s.label}, ${s.backend}, ${s.minutes} min: ` +
        `${s.fps} fps, ${pct(s.missed)} missed, emu ${s.emuFps} fps (min ${s.emuFpsMin})${engine}`,
    );
  });
} else {
  const s = sessions[pick - 1];
  if (!s) throw new Error(`No session ${pick}; there are ${sessions.length}.`);
  console.log(`${s.player ?? "signed out"} on ${s.label}, ${iso(s.firstAt)} to ${iso(s.lastAt)}, ${s.minutes} min in ${s.windows} windows`);
  console.log(`Build ${s.build}, ${s.backend}${s.quality ? ` (${s.quality} tier)` : ""}, visit ${s.visit}`);
  console.log(`Device: ${JSON.stringify(s.device)}`);
  console.log(
    `Overall: ${s.fps} fps, p95 ${s.p95Ms} ms, ${pct(s.missed)} missed, ${s.stalls} stalls, emu ${s.emuFps} fps (min ${s.emuFpsMin})` +
      (s.scale === null ? "" : `, scale ${pct(s.scale)}, cpu ${s.cpuMs} ms`),
  );
  const { windows } = await get<{ windows: Window[] }>(`${base}/windows?visit=${encodeURIComponent(s.visit)}`);
  console.log("\nWindows (time, seconds in, length: fps, p50/p95/worst ms, missed, stalls, emu fps, engine, modes, map):");
  for (const w of windows) {
    const engine = w.scale === undefined ? "no renderer" : `scale ${pct(w.scale)} dof ${pct(w.dof ?? 0)} cpu ${w.cpuMs} ms drawn ${w.drawn}/s`;
    const modes = Object.entries(w.modes).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${pct(v)}`).join(" ");
    console.log(
      `  ${iso(w.at)} ${Math.round(w.uptime / 1000)} s, ${w.seconds} s: ${w.fps} fps, ${w.p50Ms}/${w.p95Ms}/${w.worstMs} ms, ` +
        `${pct(w.missed)} missed, ${w.stalls} stalls, emu ${w.emuFps}, ${engine}, ${modes}${w.map === undefined ? "" : `, map ${w.map}`}`,
    );
  }
}
