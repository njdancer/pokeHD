import { DurableObject } from "cloudflare:workers";
import type { ErrorReport, PerfReport } from "@pokehd/protocol";
import type { SqlValue } from "../directory/store.ts";
import { PerfStore } from "./perf-store.ts";
import { ReportStore, type Reporter } from "./store.ts";

/**
 * Crash reports and perf telemetry from players' browsers, addressed by name as `"errors"`. The
 * Worker calls it over RPC; Nick reads them at /admin/errors and /admin/perf.
 */
export class Reports extends DurableObject<Env> {
  readonly #store: ReportStore;
  readonly #perf: PerfStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    const exec = (query: string, ...params: SqlValue[]) =>
      sql.exec(query, ...params).toArray() as Record<string, SqlValue>[];
    this.#store = new ReportStore({ exec });
    this.#perf = new PerfStore({ exec });
  }

  add(report: ErrorReport, player: Reporter | null) {
    return this.#store.add(report, player);
  }
  groups(limit?: number) {
    return this.#store.groups(limit);
  }
  reports(fingerprint: string, limit?: number) {
    return this.#store.reports(fingerprint, limit);
  }
  clear(fingerprint?: string) {
    this.#store.clear(fingerprint);
  }

  addPerf(report: PerfReport, player: Reporter | null) {
    return this.#perf.add(report, player);
  }
  perfSessions(limit?: number) {
    return this.#perf.sessions(limit);
  }
  perfWindows(visit: string) {
    return this.#perf.windows(visit);
  }
}
