import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { parseErrorReport, type ErrorReport } from "@pokehd/protocol";
import type { Sql, SqlValue } from "../directory/store.ts";
import { fingerprint, MAX_PER_VISIT, MAX_REPORTS, ReportStore } from "./store.ts";

function makeStore() {
  const db = new DatabaseSync(":memory:");
  let now = 1_000_000;
  const sql: Sql = { exec: (q, ...p) => db.prepare(q).all(...p) as Record<string, SqlValue>[] };
  return { store: new ReportStore(sql, () => now), advance: (ms: number) => (now += ms) };
}

function report(overrides: Partial<ErrorReport> = {}): ErrorReport {
  return {
    kind: "error",
    message: "TypeError: undefined is not an object (evaluating 'map.tiles')",
    stack: "MapScreen@https://pokehd.dncr.me/assets/MenuLive-B3xQ9aZk.js:12:345\nrender@https://pokehd.dncr.me/assets/react-Ck2f8sJd.js:1:2",
    page: "/",
    build: "a3e14f0 2026-10-10T21:00Z",
    visit: "visit0001",
    uptime: 12_000,
    device: { ua: "iPhone", screen: "390x844", dpr: 3, standalone: true },
    ...overrides,
  };
}

const nick = { id: "p1", name: "Nick" };

describe("crash reports", () => {
  it("groups the same problem across visits and builds", () => {
    const { store, advance } = makeStore();
    store.add(report(), nick);
    advance(60_000);
    store.add(
      report({
        visit: "visit0002",
        build: "b4c5d6e 2026-10-11T08:00Z",
        // A new build: new chunk hash, line numbers moved.
        stack: "MapScreen@https://pokehd.dncr.me/assets/MenuLive-Zz9yX8wV.js:14:20",
      }),
      null,
    );
    store.add(report({ message: "Something else" }), nick);
    const groups = store.groups();
    expect(groups).toHaveLength(2);
    const map = groups.find((g) => g.count === 2)!;
    expect(map).toMatchObject({ visits: 2, firstAt: 1_000_000, lastAt: 1_060_000 });
    expect(map.players.sort()).toEqual(["Nick", "signed out"]);
    expect(map.builds).toHaveLength(2);
    expect(map.latest).toMatchObject({ visit: "visit0002", player: null });
    expect(store.reports(map.fingerprint).map((r) => r.visit)).toEqual(["visit0002", "visit0001"]);
  });

  it("stops one page load from flooding it", () => {
    const { store } = makeStore();
    for (let i = 0; i < MAX_PER_VISIT; i++) expect(store.add(report({ message: `boom ${i}` }), null)).toBe(true);
    expect(store.add(report({ message: "one more" }), null)).toBe(false);
    expect(store.add(report({ visit: "visit0002" }), null)).toBe(true);
  });

  it("keeps only the newest reports", () => {
    const { store } = makeStore();
    for (let i = 0; i <= MAX_REPORTS; i++) store.add(report({ visit: `v${String(i).padStart(8, "0")}` }), null);
    expect(store.groups()[0]!.count).toBe(MAX_REPORTS);
  });

  it("forgets one problem or all of them", () => {
    const { store } = makeStore();
    store.add(report(), null);
    store.add(report({ message: "other" }), null);
    store.clear(store.groups()[0]!.fingerprint);
    expect(store.groups()).toHaveLength(1);
    store.clear();
    expect(store.groups()).toEqual([]);
  });
});

describe("fingerprint", () => {
  it("ignores numbers, URLs and build hashes, but not where it happened", () => {
    const a = fingerprint({ kind: "gpu", message: "Buffer 1234 is too big for https://x/y", stack: "at draw (https://h/assets/index-AbCdEf12.js:1:99)" });
    const b = fingerprint({ kind: "gpu", message: "Buffer 99 is too big for https://z", stack: "at draw (https://h/assets/index-ZyXwVu98.js:7:3)" });
    const c = fingerprint({ kind: "gpu", message: "Buffer 99 is too big for https://z", stack: "at other (https://h/assets/index-ZyXwVu98.js:7:3)" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("report parsing", () => {
  it("trims long text rather than dropping the report", () => {
    const parsed = parseErrorReport({ ...report(), message: "x".repeat(10_000), extra: "ignored" });
    expect(parsed?.message).toHaveLength(2000);
    expect(parsed).not.toHaveProperty("extra");
  });

  it("refuses what isn't a report", () => {
    expect(parseErrorReport({ ...report(), kind: "nope" })).toBeNull();
    expect(parseErrorReport({ ...report(), visit: "../../etc" })).toBeNull();
  });
});
