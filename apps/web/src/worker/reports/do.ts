import { DurableObject } from "cloudflare:workers";
import type { ErrorReport } from "@pokehd/protocol";
import type { SqlValue } from "../directory/store.ts";
import { ReportStore, type Reporter } from "./store.ts";

/**
 * Crash reports from players' browsers, addressed by name as `"errors"`. The Worker calls it over
 * RPC; Nick reads them at /admin/errors.
 */
export class Reports extends DurableObject<Env> {
  readonly #store: ReportStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    const exec = (query: string, ...params: SqlValue[]) =>
      sql.exec(query, ...params).toArray() as Record<string, SqlValue>[];
    this.#store = new ReportStore({ exec });
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
}
