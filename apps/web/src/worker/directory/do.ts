import { DurableObject } from "cloudflare:workers";
import { DirectoryStore, type SqlValue } from "./store.ts";

/**
 * The one directory of friends (D19), addressed by name as `"friends"`. The Worker calls it
 * over RPC; nothing reaches it from outside.
 */
export class Directory extends DurableObject<Env> {
  readonly #store: DirectoryStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    // The schema has no BLOB columns, so rows only hold strings, numbers and nulls.
    const exec = (query: string, ...params: SqlValue[]) =>
      sql.exec(query, ...params).toArray() as Record<string, SqlValue>[];
    this.#store = new DirectoryStore({ exec });
  }

  createInvite(note: string) {
    return this.#store.createInvite(note);
  }
  createDeviceCode(playerId: string) {
    return this.#store.createDeviceCode(playerId);
  }
  redeem(code: string, name: string) {
    return this.#store.redeem(code, name);
  }
  authenticate(sessionToken: string) {
    return this.#store.authenticate(sessionToken);
  }
  endSession(sessionToken: string) {
    return this.#store.endSession(sessionToken);
  }
  listPlayers() {
    return this.#store.listPlayers();
  }
  listInvites() {
    return this.#store.listInvites();
  }
  revokePlayer(playerId: string) {
    return this.#store.revokePlayer(playerId);
  }
}
