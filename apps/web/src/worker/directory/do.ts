import { DurableObject } from "cloudflare:workers";
import { DirectoryStore, type CodeKind, type SqlValue } from "./store.ts";

/**
 * The one directory of friends (D23), addressed by name as `"friends"`. The Worker calls it
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

  addPlayer(email: string, name: string) {
    return this.#store.addPlayer(email, name);
  }
  ensurePlayer(email: string, name: string) {
    return this.#store.ensurePlayer(email, name);
  }
  setEmail(playerId: string, email: string) {
    return this.#store.setEmail(playerId, email);
  }
  playerByEmail(email: string) {
    return this.#store.playerByEmail(email);
  }
  createCode(playerId: string, kind: CodeKind) {
    return this.#store.createCode(playerId, kind);
  }
  verify(email: string, code: string) {
    return this.#store.verify(email, code);
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
  setName(playerId: string, name: string) {
    return this.#store.setName(playerId, name);
  }
  setRomAccess(playerId: string, allowed: boolean) {
    return this.#store.setRomAccess(playerId, allowed);
  }
  revokePlayer(playerId: string) {
    return this.#store.revokePlayer(playerId);
  }
}
