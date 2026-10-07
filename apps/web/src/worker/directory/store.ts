// Who the friends are (D19): invite codes, players and their sessions, in SQLite. This module is
// plain logic over a tiny SQL interface, so tests run it on node:sqlite; the Directory Durable
// Object (./do.ts) runs it on its own SQLite storage.
import { newInviteCode, newSessionToken, normaliseInviteCode, sha256Hex } from "./codes.ts";

export type SqlValue = string | number | null;

/** The subset of SQLite the store needs: run a statement, get its rows. */
export interface Sql {
  exec(query: string, ...params: SqlValue[]): Record<string, SqlValue>[];
}

export interface Player {
  id: string;
  name: string;
}

export interface InviteSummary {
  note: string;
  createdAt: number;
  expiresAt: number;
  /** When it was used, or null while still open. */
  usedAt: number | null;
  /** Who joined with it. */
  usedBy: string | null;
}

export type RedeemResult =
  | { ok: true; player: Player; sessionToken: string }
  | { ok: false; error: "invalid-code" | "bad-name" | "name-taken" };

const DAY = 24 * 60 * 60 * 1000;
export const INVITE_TTL = 7 * DAY;
/** A code to sign an existing player in on another device is only good for a short while. */
export const DEVICE_CODE_TTL = 60 * 60 * 1000;
export const MAX_NAME_LENGTH = 16;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS players_active_name
  ON players (name COLLATE NOCASE) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS invites (
  code_hash TEXT PRIMARY KEY,
  note TEXT NOT NULL,
  player_id TEXT REFERENCES players (id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by TEXT REFERENCES players (id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players (id),
  created_at INTEGER NOT NULL
);
`;

/**
 * A display name, trimmed, 1–16 characters of letters, digits, spaces and `_ - . '`. Null if
 * it doesn't fit.
 */
export function cleanName(input: string): string | null {
  const name = input.trim().replace(/\s+/g, " ");
  if (name.length === 0 || [...name].length > MAX_NAME_LENGTH) return null;
  return /^[\p{L}\p{N} _.'-]+$/u.test(name) ? name : null;
}

export class DirectoryStore {
  readonly #sql: Sql;
  readonly #now: () => number;

  constructor(sql: Sql, now: () => number = Date.now) {
    this.#sql = sql;
    this.#now = now;
    for (const statement of SCHEMA.split(";")) if (statement.trim()) sql.exec(statement);
  }

  /** A new single-use invite. The code is returned once and only its hash is kept. */
  async createInvite(note: string, ttl = INVITE_TTL): Promise<{ code: string; expiresAt: number }> {
    const code = newInviteCode();
    const hash = await sha256Hex(normaliseInviteCode(code)!);
    const now = this.#now();
    this.#sql.exec(
      "INSERT INTO invites (code_hash, note, created_at, expires_at) VALUES (?, ?, ?, ?)",
      hash,
      note,
      now,
      now + ttl,
    );
    return { code, expiresAt: now + ttl };
  }

  /** A short-lived code that signs `playerId` in on another device. */
  async createDeviceCode(playerId: string): Promise<{ code: string; expiresAt: number } | null> {
    if (!this.#activePlayer(playerId)) return null;
    const code = newInviteCode();
    const hash = await sha256Hex(normaliseInviteCode(code)!);
    const now = this.#now();
    this.#sql.exec(
      "INSERT INTO invites (code_hash, note, player_id, created_at, expires_at) VALUES (?, 'device', ?, ?, ?)",
      hash,
      playerId,
      now,
      now + DEVICE_CODE_TTL,
    );
    return { code, expiresAt: now + DEVICE_CODE_TTL };
  }

  /**
   * Uses a code. An invite creates a new player called `name`; a device code signs its player
   * in and ignores `name`. Either way the code is spent and a new session starts.
   */
  async redeem(codeInput: string, nameInput: string): Promise<RedeemResult> {
    const code = normaliseInviteCode(codeInput);
    if (!code) return { ok: false, error: "invalid-code" };
    // Hash everything up front: from here on the work is synchronous, so two redemptions of
    // the same code can't interleave inside the Durable Object.
    const codeHash = await sha256Hex(code);
    const sessionToken = newSessionToken();
    const tokenHash = await sha256Hex(sessionToken);
    const now = this.#now();

    const invite = this.#sql.exec(
      "SELECT player_id FROM invites WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?",
      codeHash,
      now,
    )[0];
    if (!invite) return { ok: false, error: "invalid-code" };

    let player: Player;
    if (invite.player_id !== null) {
      const existing = this.#activePlayer(String(invite.player_id));
      if (!existing) return { ok: false, error: "invalid-code" };
      player = existing;
    } else {
      const name = cleanName(nameInput);
      if (!name) return { ok: false, error: "bad-name" };
      if (this.#nameTaken(name)) return { ok: false, error: "name-taken" };
      player = { id: crypto.randomUUID(), name };
      this.#sql.exec(
        "INSERT INTO players (id, name, created_at) VALUES (?, ?, ?)",
        player.id,
        player.name,
        now,
      );
    }
    this.#sql.exec(
      "UPDATE invites SET used_at = ?, used_by = ? WHERE code_hash = ?",
      now,
      player.id,
      codeHash,
    );
    this.#sql.exec(
      "INSERT INTO sessions (token_hash, player_id, created_at) VALUES (?, ?, ?)",
      tokenHash,
      player.id,
      now,
    );
    return { ok: true, player, sessionToken };
  }

  /** The player a session token belongs to, or null if it's unknown or they were removed. */
  async authenticate(sessionToken: string): Promise<Player | null> {
    const tokenHash = await sha256Hex(sessionToken);
    const row = this.#sql.exec(
      `SELECT p.id, p.name FROM sessions s JOIN players p ON p.id = s.player_id
       WHERE s.token_hash = ? AND p.revoked_at IS NULL`,
      tokenHash,
    )[0];
    return row ? { id: String(row.id), name: String(row.name) } : null;
  }

  /** Ends one session (signing out on one device). */
  async endSession(sessionToken: string): Promise<void> {
    this.#sql.exec("DELETE FROM sessions WHERE token_hash = ?", await sha256Hex(sessionToken));
  }

  listPlayers(): (Player & { createdAt: number; revokedAt: number | null })[] {
    return this.#sql
      .exec("SELECT id, name, created_at, revoked_at FROM players ORDER BY created_at")
      .map((r) => ({
        id: String(r.id),
        name: String(r.name),
        createdAt: Number(r.created_at),
        revokedAt: r.revoked_at === null ? null : Number(r.revoked_at),
      }));
  }

  listInvites(): InviteSummary[] {
    return this.#sql
      .exec(
        `SELECT i.note, i.created_at, i.expires_at, i.used_at, p.name AS used_by
         FROM invites i LEFT JOIN players p ON p.id = i.used_by
         WHERE i.player_id IS NULL ORDER BY i.created_at`,
      )
      .map((r) => ({
        note: String(r.note),
        createdAt: Number(r.created_at),
        expiresAt: Number(r.expires_at),
        usedAt: r.used_at === null ? null : Number(r.used_at),
        usedBy: r.used_by === null ? null : String(r.used_by),
      }));
  }

  /** Removes a player: their sessions end and their name is free again. */
  revokePlayer(playerId: string): boolean {
    if (!this.#activePlayer(playerId)) return false;
    this.#sql.exec("UPDATE players SET revoked_at = ? WHERE id = ?", this.#now(), playerId);
    this.#sql.exec("DELETE FROM sessions WHERE player_id = ?", playerId);
    return true;
  }

  #activePlayer(id: string): Player | null {
    const row = this.#sql.exec(
      "SELECT id, name FROM players WHERE id = ? AND revoked_at IS NULL",
      id,
    )[0];
    return row ? { id: String(row.id), name: String(row.name) } : null;
  }

  #nameTaken(name: string): boolean {
    return (
      this.#sql.exec(
        "SELECT 1 FROM players WHERE name = ? COLLATE NOCASE AND revoked_at IS NULL",
        name,
      ).length > 0
    );
  }
}
