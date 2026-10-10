// Crash reports from players' browsers, in SQLite. Like the directory, plain logic over a tiny
// SQL interface: tests run it on node:sqlite, the Reports Durable Object on its own storage.
import type { ErrorReport } from "@pokehd/protocol";
import type { Sql } from "../directory/store.ts";

/** Who sent a report, if they were signed in. */
export interface Reporter {
  id: string;
  name: string;
}

/** One report as stored. */
export interface StoredReport extends ErrorReport {
  id: number;
  at: number;
  fingerprint: string;
  player: Reporter | null;
}

/** Reports that look like the same problem, with the newest one in full. */
export interface ReportGroup {
  fingerprint: string;
  count: number;
  /** Separate page loads it happened in. */
  visits: number;
  firstAt: number;
  lastAt: number;
  /** Who it happened to (names, or "signed out"). */
  players: string[];
  builds: string[];
  latest: StoredReport;
}

/** The newest reports kept; older ones are dropped as new ones arrive. */
export const MAX_REPORTS = 2000;
/** The most reports one page load may store: a loop that throws every frame stops here. */
export const MAX_PER_VISIT = 50;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  visit TEXT NOT NULL,
  player TEXT,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_fingerprint ON reports (fingerprint, at);
CREATE INDEX IF NOT EXISTS reports_visit ON reports (visit);
`;

export class ReportStore {
  readonly #sql: Sql;
  readonly #now: () => number;

  constructor(sql: Sql, now: () => number = Date.now) {
    this.#sql = sql;
    this.#now = now;
    for (const statement of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) sql.exec(statement);
  }

  /** Stores a report. False if its page load has already sent too many. */
  add(report: ErrorReport, player: Reporter | null): boolean {
    const [row] = this.#sql.exec("SELECT COUNT(*) AS n FROM reports WHERE visit = ?", report.visit);
    if (Number(row?.n ?? 0) >= MAX_PER_VISIT) return false;
    this.#sql.exec(
      "INSERT INTO reports (at, fingerprint, visit, player, body) VALUES (?, ?, ?, ?, ?)",
      this.#now(),
      fingerprint(report),
      report.visit,
      player ? JSON.stringify(player) : null,
      JSON.stringify(report),
    );
    this.#sql.exec(
      "DELETE FROM reports WHERE id <= (SELECT id FROM reports ORDER BY id DESC LIMIT 1 OFFSET ?)",
      MAX_REPORTS,
    );
    return true;
  }

  /** Problems, the most recently seen first. */
  groups(limit = 100): ReportGroup[] {
    const rows = this.#sql.exec(
      `SELECT fingerprint, COUNT(*) AS count, COUNT(DISTINCT visit) AS visits, MIN(at) AS first_at,
              MAX(at) AS last_at, MAX(id) AS latest_id
       FROM reports GROUP BY fingerprint ORDER BY last_at DESC LIMIT ?`,
      limit,
    );
    return rows.map((row) => {
      const fp = String(row.fingerprint);
      const all = this.#sql.exec("SELECT player, body FROM reports WHERE fingerprint = ?", fp);
      const players = new Set<string>();
      const builds = new Set<string>();
      for (const r of all) {
        players.add(r.player ? (JSON.parse(String(r.player)) as Reporter).name : "signed out");
        builds.add((JSON.parse(String(r.body)) as ErrorReport).build);
      }
      return {
        fingerprint: fp,
        count: Number(row.count),
        visits: Number(row.visits),
        firstAt: Number(row.first_at),
        lastAt: Number(row.last_at),
        players: [...players],
        builds: [...builds],
        latest: this.#report(Number(row.latest_id))!,
      };
    });
  }

  /** The newest reports of one problem. */
  reports(fp: string, limit = 50): StoredReport[] {
    return this.#sql
      .exec("SELECT * FROM reports WHERE fingerprint = ? ORDER BY id DESC LIMIT ?", fp, limit)
      .map(toReport);
  }

  /** Forgets one problem, or every report. */
  clear(fp?: string): void {
    if (fp) this.#sql.exec("DELETE FROM reports WHERE fingerprint = ?", fp);
    else this.#sql.exec("DELETE FROM reports");
  }

  #report(id: number): StoredReport | null {
    const [row] = this.#sql.exec("SELECT * FROM reports WHERE id = ?", id);
    return row ? toReport(row) : null;
  }
}

function toReport(row: Record<string, unknown>): StoredReport {
  return {
    ...(JSON.parse(String(row.body)) as ErrorReport),
    id: Number(row.id),
    at: Number(row.at),
    fingerprint: String(row.fingerprint),
    player: row.player ? (JSON.parse(String(row.player)) as Reporter) : null,
  };
}

/**
 * What makes two reports the same problem: their kind, their message with the parts that change
 * every time (numbers, URLs, hashes in file names) taken out, and where in our code they started.
 */
export function fingerprint(report: Pick<ErrorReport, "kind" | "message" | "stack">): string {
  const message = report.message
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b[0-9a-f]{8,}\b/gi, "<hex>")
    .replace(/\d+/g, "<n>")
    .slice(0, 200);
  return `${report.kind}|${message}|${topFrame(report.stack)}`;
}

/** The first stack frame's function and file, without line numbers or build hashes. */
function topFrame(stack: string | undefined): string {
  if (!stack) return "";
  for (const line of stack.split("\n")) {
    // Chrome: "    at fn (https://host/assets/App-abc123.js:1:2)"; Safari/Firefox: "fn@https://…:1:2".
    const match = /^\s*(?:at\s+(?:(\S+)\s+\()?|(\S*)@)(\S+?)(?::\d+){1,2}\)?\s*$/.exec(line);
    if (!match) continue;
    const fn = match[1] ?? match[2] ?? "";
    const file = (match[3] ?? "").replace(/^.*\//, "").replace(/-[\w-]{8}\.js$/, ".js").replace(/\?.*$/, "");
    return `${fn}@${file}`;
  }
  return "";
}
