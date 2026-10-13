import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { deviceLabel, parsePerfReport, type PerfReport } from "@pokehd/protocol";
import type { Sql, SqlValue } from "../directory/store.ts";
import { MAX_WINDOWS, MAX_WINDOWS_PER_VISIT, PerfStore } from "./perf-store.ts";

function makeStore() {
  const db = new DatabaseSync(":memory:");
  let now = 1_000_000;
  const sql: Sql = { exec: (q, ...p) => db.prepare(q).all(...p) as Record<string, SqlValue>[] };
  return { store: new PerfStore(sql, () => now), advance: (ms: number) => (now += ms) };
}

const IPAD_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15";

function window(overrides: Partial<PerfReport> = {}): PerfReport {
  return {
    visit: "visit0001",
    build: "a3e14f0 2026-10-10T21:00Z",
    page: "/",
    uptime: 30_000,
    device: { ua: IPAD_UA, screen: "1024x768", dpr: 2, standalone: true, cores: 2, touch: 5 },
    backend: "webgl",
    quality: "mobile",
    seconds: 60,
    frames: 1800,
    fps: 30,
    p50Ms: 33.3,
    p95Ms: 50,
    worstMs: 180,
    missed: 0.9,
    stalls: 2,
    emuFps: 59.7,
    cpuMs: 9.5,
    scale: 0.6,
    dof: 0,
    drawn: 28,
    modes: { overworld: 0.8, dialog: 0.1, battle: 0, other: 0.1, menu: 0 },
    map: 0,
    ...overrides,
  };
}

const nick = { id: "p1", name: "Nick" };

describe("perf telemetry", () => {
  it("sums each page load's windows up", () => {
    const { store, advance } = makeStore();
    store.add(window({ seconds: 30, frames: 900 }), null);
    advance(60_000);
    store.add(window({ fps: 20, missed: 0.5, frames: 1200, emuFps: 45, stalls: 5, scale: 0.5 }), nick);
    advance(60_000);
    store.add(window({ fps: 40, frames: 2400, missed: 0.1, emuFps: 59.7, cpuMs: 8 }), nick);
    advance(1000);
    store.add(window({ visit: "visit0002", device: { ua: "iPhone", screen: "390x844", dpr: 3, standalone: false }, backend: "none", scale: undefined, cpuMs: undefined }), null);
    const [phone, ipad] = store.sessions();
    expect(phone).toMatchObject({ visit: "visit0002", label: "iPhone", player: null, backend: "none", scale: null, cpuMs: null, windows: 1 });
    expect(ipad).toMatchObject({
      visit: "visit0001",
      label: "iPad",
      player: "Nick",
      windows: 3,
      minutes: 2.5,
      fps: 30,
      emuFps: 59.7,
      emuFpsMin: 45,
      scale: 0.6,
      cpuMs: 9.5,
      stalls: 9,
      firstAt: 1_000_000,
      lastAt: 1_120_000,
    });
    // By frames: (0.9 × 900 + 0.5 × 1200 + 0.1 × 2400) / 4500.
    expect(ipad!.missed).toBeCloseTo(0.367, 3);
    expect(store.windows("visit0001").map((w) => w.fps)).toEqual([30, 20, 40]);
    expect(store.sessions(1)).toHaveLength(1);
  });

  it("stops one page load from flooding it", () => {
    const { store } = makeStore();
    for (let i = 0; i < MAX_WINDOWS_PER_VISIT; i++) expect(store.add(window(), null)).toBe(true);
    expect(store.add(window(), null)).toBe(false);
    expect(store.add(window({ visit: "visit0002" }), null)).toBe(true);
  });

  it("keeps only the newest windows", () => {
    const { store } = makeStore();
    for (let i = 0; i <= MAX_WINDOWS; i++) store.add(window({ visit: `v${String(Math.floor(i / 100)).padStart(8, "0")}` }), null);
    expect(store.sessions(1000).reduce((n, s) => n + s.windows, 0)).toBe(MAX_WINDOWS);
  });
});

describe("perf report parsing", () => {
  it("trims long text and refuses what isn't a report", () => {
    expect(parsePerfReport({ ...window(), build: "x".repeat(500) })?.build).toHaveLength(64);
    expect(parsePerfReport({ ...window(), backend: "metal" })).toBeNull();
    expect(parsePerfReport({ ...window(), missed: 2 })).toBeNull();
    expect(parsePerfReport({ ...window(), visit: "../../etc" })).toBeNull();
  });
});

describe("deviceLabel", () => {
  it("tells an iPad from a Mac by its touch points", () => {
    expect(deviceLabel(IPAD_UA, 5)).toBe("iPad");
    expect(deviceLabel(IPAD_UA)).toBe("Mac");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("Android");
  });
});
