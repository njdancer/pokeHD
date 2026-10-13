// Perf telemetry from players' browsers, in SQLite next to the crash reports: one row per window
// of play, grouped by visit (page load) when read. Plain logic over the tiny SQL interface, like
// ReportStore, so tests run it on node:sqlite.
import { deviceLabel, type Device, type PerfReport } from "@pokehd/protocol";
import type { Sql } from "../directory/store.ts";
import type { Reporter } from "./store.ts";

/** One window as stored. */
export interface StoredWindow extends PerfReport {
  id: number;
  at: number;
}

/** One page load's play: its device, and its windows summed up. */
export interface PerfSession {
  visit: string;
  /** The signed-in player's name, or null if they never were. */
  player: string | null;
  /** "iPad", "iPhone", "Mac" and so on. */
  label: string;
  device: Device;
  backend: PerfReport["backend"];
  quality: string | null;
  build: string;
  firstAt: number;
  lastAt: number;
  windows: number;
  minutes: number;
  /** Medians over its windows, unless said otherwise. */
  fps: number;
  p95Ms: number;
  /** Share of all its frames that missed 60 fps. */
  missed: number;
  emuFps: number;
  /** The slowest window's emulator speed. */
  emuFpsMin: number;
  scale: number | null;
  cpuMs: number | null;
  /** Stalls in all its windows. */
  stalls: number;
}

/** The newest windows kept; older ones are dropped as new ones arrive. */
export const MAX_WINDOWS = 20_000;
/** The most windows one page load may store (the browser sends at most 120). */
export const MAX_WINDOWS_PER_VISIT = 150;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS perf (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  visit TEXT NOT NULL,
  player TEXT,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS perf_visit ON perf (visit, id);
`;

export class PerfStore {
  readonly #sql: Sql;
  readonly #now: () => number;

  constructor(sql: Sql, now: () => number = Date.now) {
    this.#sql = sql;
    this.#now = now;
    for (const statement of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) sql.exec(statement);
  }

  /** Stores a window. False if its page load has already sent too many. */
  add(report: PerfReport, player: Reporter | null): boolean {
    const [row] = this.#sql.exec("SELECT COUNT(*) AS n FROM perf WHERE visit = ?", report.visit);
    if (Number(row?.n ?? 0) >= MAX_WINDOWS_PER_VISIT) return false;
    const [added] = this.#sql.exec(
      "INSERT INTO perf (at, visit, player, body) VALUES (?, ?, ?, ?) RETURNING id",
      this.#now(),
      report.visit,
      player ? JSON.stringify(player) : null,
      JSON.stringify(report),
    );
    // Ids only grow and only this trims, so the newest MAX_WINDOWS are the last MAX_WINDOWS ids
    // (cheaper than counting rows: a Durable Object pays for every row a query reads).
    this.#sql.exec("DELETE FROM perf WHERE id <= ?", Number(added!.id) - MAX_WINDOWS);
    return true;
  }

  /** Page loads, the most recently played first. */
  sessions(limit = 50): PerfSession[] {
    const visits = this.#sql.exec("SELECT visit, MAX(id) AS latest FROM perf GROUP BY visit ORDER BY latest DESC LIMIT ?", limit);
    return visits.map((row) => {
      const rows = this.#sql.exec("SELECT * FROM perf WHERE visit = ? ORDER BY id", String(row.visit));
      return summarise(rows.map(toWindow), rows.findLast((r) => r.player)?.player);
    });
  }

  /** One page load's windows, in the order they were played. */
  windows(visit: string): StoredWindow[] {
    return this.#sql.exec("SELECT * FROM perf WHERE visit = ? ORDER BY id", visit).map(toWindow);
  }
}

function summarise(windows: StoredWindow[], player: unknown): PerfSession {
  const first = windows[0]!;
  const last = windows.at(-1)!;
  const frames = windows.reduce((n, w) => n + w.frames, 0);
  const engine = windows.filter((w) => w.scale !== undefined);
  return {
    visit: last.visit,
    player: player ? (JSON.parse(String(player)) as Reporter).name : null,
    label: deviceLabel(last.device.ua, last.device.touch),
    device: last.device,
    backend: last.backend,
    quality: last.quality ?? null,
    build: last.build,
    firstAt: first.at,
    lastAt: last.at,
    windows: windows.length,
    minutes: round(windows.reduce((s, w) => s + w.seconds, 0) / 60, 1),
    fps: median(windows.map((w) => w.fps)),
    p95Ms: median(windows.map((w) => w.p95Ms)),
    missed: frames ? round(windows.reduce((n, w) => n + w.missed * w.frames, 0) / frames, 3) : 0,
    emuFps: median(windows.map((w) => w.emuFps)),
    emuFpsMin: Math.min(...windows.map((w) => w.emuFps)),
    scale: engine.length ? median(engine.map((w) => w.scale!)) : null,
    cpuMs: engine.length ? median(engine.map((w) => w.cpuMs!)) : null,
    stalls: windows.reduce((n, w) => n + w.stalls, 0),
  };
}

function toWindow(row: Record<string, unknown>): StoredWindow {
  return { ...(JSON.parse(String(row.body)) as PerfReport), id: Number(row.id), at: Number(row.at) };
}

function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : round((sorted[mid - 1]! + sorted[mid]!) / 2, 3);
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
