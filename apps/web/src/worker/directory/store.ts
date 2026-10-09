// Who the friends are (D23): players with their emails, sign-in codes and sessions, in SQLite.
// This module is plain logic over a tiny SQL interface, so tests run it on node:sqlite; the
// Directory Durable Object (./do.ts) runs it on its own SQLite storage.
import { newEmailCode, newLinkCode, newSessionToken, normaliseCode, sha256Hex } from "./codes.ts";

export type SqlValue = string | number | null;

/** The subset of SQLite the store needs: run a statement, get its rows. */
export interface Sql {
  exec(query: string, ...params: SqlValue[]): Record<string, SqlValue>[];
}

export interface Player {
  id: string;
  name: string;
  /** Null only for players who joined with a D19 invite code and haven't had one added. */
  email: string | null;
  /** Whether they may load Nick's cartridge (D26). New players may; Nick can take it away. */
  romAccess: boolean;
}

export interface PlayerSummary extends Player {
  createdAt: number;
  revokedAt: number | null;
}

/** `email`: typed by the player, 6 digits. `link`: in a link Nick shares, 12 characters. */
export type CodeKind = "email" | "link";

export type AddPlayerResult =
  | { ok: true; player: Player }
  | { ok: false; error: "bad-email" | "bad-name" | "name-taken" | "email-taken" };

export type CodeResult =
  | { ok: true; code: string; expiresAt: number }
  | { ok: false; error: "not-found" | "too-soon" | "too-many" };

export type VerifyResult =
  | { ok: true; player: Player; sessionToken: string }
  | { ok: false; error: "invalid-code" };

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
/** A code sent by email is typed in straight away. */
export const EMAIL_CODE_TTL = 15 * MINUTE;
/** A link Nick shares may sit in a chat for a while before the friend taps it. */
export const LINK_CODE_TTL = 7 * DAY;
/** Wrong guesses at a player's emailed codes before they all stop working. */
export const MAX_ATTEMPTS = 5;
/** Emailed codes: at most one a minute and this many an hour per player, so nobody can spam. */
export const EMAIL_CODES_PER_HOUR = 5;
export const MAX_NAME_LENGTH = 16;
const MAX_EMAIL_LENGTH = 254;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS players_active_name
  ON players (name COLLATE NOCASE) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players (id),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_codes (
  code_hash TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players (id),
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS login_codes_player ON login_codes (player_id, created_at);
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

/** An email address, trimmed and lower-cased. Null if it doesn't look like one. */
export function cleanEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH) return null;
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email) ? email : null;
}

export class DirectoryStore {
  readonly #sql: Sql;
  readonly #now: () => number;

  constructor(sql: Sql, now: () => number = Date.now) {
    this.#sql = sql;
    this.#now = now;
    for (const statement of SCHEMA.split(";")) if (statement.trim()) sql.exec(statement);
    // Players from D19 had no email. SQLite has no ADD COLUMN IF NOT EXISTS, so look first.
    if (!sql.exec("PRAGMA table_info(players)").some((c) => c.name === "email")) {
      sql.exec("ALTER TABLE players ADD COLUMN email TEXT");
    }
    // D26: everyone Nick invited may load his cartridge unless he says otherwise.
    if (!sql.exec("PRAGMA table_info(players)").some((c) => c.name === "rom_access")) {
      sql.exec("ALTER TABLE players ADD COLUMN rom_access INTEGER NOT NULL DEFAULT 1");
    }
    sql.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS players_active_email ON players (email) WHERE revoked_at IS NULL",
    );
  }

  /** Adds a friend by email (Nick, from the game). They sign in by email from then on. */
  addPlayer(emailInput: string, nameInput: string): AddPlayerResult {
    const email = cleanEmail(emailInput);
    if (!email) return { ok: false, error: "bad-email" };
    const name = cleanName(nameInput);
    if (!name) return { ok: false, error: "bad-name" };
    if (this.playerByEmail(email)) return { ok: false, error: "email-taken" };
    if (this.#nameTaken(name)) return { ok: false, error: "name-taken" };
    const player = { id: crypto.randomUUID(), name, email, romAccess: true };
    this.#sql.exec(
      "INSERT INTO players (id, name, email, created_at) VALUES (?, ?, ?, ?)",
      player.id,
      player.name,
      player.email,
      this.#now(),
    );
    return { ok: true, player };
  }

  /**
   * The admin's player, made on first use. The admin is set in the repo, not in the database,
   * so this runs whenever they ask to sign in. A D19 player with their name and no email
   * becomes theirs, keeping its saves.
   */
  ensurePlayer(emailInput: string, nameInput: string): Player | null {
    const email = cleanEmail(emailInput);
    const name = cleanName(nameInput);
    if (!email || !name) return null;
    const existing = this.playerByEmail(email);
    if (existing) return existing;
    const legacy = this.#sql.exec(
      "SELECT id FROM players WHERE name = ? COLLATE NOCASE AND email IS NULL AND revoked_at IS NULL",
      name,
    )[0];
    if (legacy) {
      this.#sql.exec("UPDATE players SET email = ? WHERE id = ?", email, String(legacy.id));
      return this.#activePlayer(String(legacy.id));
    }
    const added = this.addPlayer(email, this.#nameTaken(name) ? `${name.slice(0, 14)} 2` : name);
    return added.ok ? added.player : null;
  }

  /** Gives a player an email, or changes it. */
  setEmail(playerId: string, emailInput: string): { ok: true } | { ok: false; error: "bad-email" | "email-taken" | "not-found" } {
    const email = cleanEmail(emailInput);
    if (!email) return { ok: false, error: "bad-email" };
    if (!this.#activePlayer(playerId)) return { ok: false, error: "not-found" };
    const owner = this.playerByEmail(email);
    if (owner && owner.id !== playerId) return { ok: false, error: "email-taken" };
    this.#sql.exec("UPDATE players SET email = ? WHERE id = ?", email, playerId);
    return { ok: true };
  }

  playerByEmail(emailInput: string): Player | null {
    const email = cleanEmail(emailInput);
    if (!email) return null;
    const row = this.#sql.exec(
      `SELECT ${PLAYER_COLUMNS} FROM players WHERE email = ? AND revoked_at IS NULL`,
      email,
    )[0];
    return row ? toPlayer(row) : null;
  }

  /**
   * A new single-use sign-in code for `playerId`. The code is returned once and only its hash
   * is kept. Emailed codes are rate limited per player.
   */
  async createCode(playerId: string, kind: CodeKind): Promise<CodeResult> {
    const code = kind === "email" ? newEmailCode() : newLinkCode();
    const hash = await codeHash(playerId, normaliseCode(code)!);
    const now = this.#now();
    if (!this.#activePlayer(playerId)) return { ok: false, error: "not-found" };
    if (kind === "email") {
      const recent = this.#sql
        .exec(
          "SELECT created_at FROM login_codes WHERE player_id = ? AND kind = 'email' AND created_at > ?",
          playerId,
          now - 60 * MINUTE,
        )
        .map((r) => Number(r.created_at));
      if (recent.some((t) => t > now - MINUTE)) return { ok: false, error: "too-soon" };
      if (recent.length >= EMAIL_CODES_PER_HOUR) return { ok: false, error: "too-many" };
    }
    const ttl = kind === "email" ? EMAIL_CODE_TTL : LINK_CODE_TTL;
    this.#sql.exec(
      "INSERT INTO login_codes (code_hash, player_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      hash,
      playerId,
      kind,
      now,
      now + ttl,
    );
    return { ok: true, code, expiresAt: now + ttl };
  }

  /** Signs in with an email and a code: the code is spent and a new session starts. */
  async verify(emailInput: string, codeInput: string): Promise<VerifyResult> {
    const fail = { ok: false, error: "invalid-code" } as const;
    const player = this.playerByEmail(emailInput);
    const code = normaliseCode(codeInput);
    if (!player || !code) return fail;
    // Hash everything up front: from here on the work is synchronous, so two sign-ins with the
    // same code can't interleave inside the Durable Object.
    const hash = await codeHash(player.id, code);
    const sessionToken = newSessionToken();
    const tokenHash = await sha256Hex(sessionToken);
    const now = this.#now();

    const row = this.#sql.exec(
      `SELECT kind FROM login_codes WHERE code_hash = ? AND player_id = ? AND used_at IS NULL
       AND expires_at > ? AND attempts < ?`,
      hash,
      player.id,
      now,
      MAX_ATTEMPTS,
    )[0];
    if (!row) {
      // Six digits are guessable given enough tries, so wrong ones count against them all.
      this.#sql.exec(
        "UPDATE login_codes SET attempts = attempts + 1 WHERE player_id = ? AND kind = 'email' AND used_at IS NULL",
        player.id,
      );
      return fail;
    }
    this.#sql.exec("UPDATE login_codes SET used_at = ? WHERE code_hash = ?", now, hash);
    if (row.kind === "email") {
      // Any other emailed code is stale now.
      this.#sql.exec(
        "UPDATE login_codes SET used_at = ? WHERE player_id = ? AND kind = 'email' AND used_at IS NULL",
        now,
        player.id,
      );
    }
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
      `SELECT p.id, p.name, p.email, p.rom_access FROM sessions s JOIN players p ON p.id = s.player_id
       WHERE s.token_hash = ? AND p.revoked_at IS NULL`,
      tokenHash,
    )[0];
    return row ? toPlayer(row) : null;
  }

  /** Ends one session (signing out on one device). */
  async endSession(sessionToken: string): Promise<void> {
    this.#sql.exec("DELETE FROM sessions WHERE token_hash = ?", await sha256Hex(sessionToken));
  }

  /** Everyone still in, oldest first. */
  listPlayers(): PlayerSummary[] {
    return this.#sql
      .exec(
        `SELECT ${PLAYER_COLUMNS}, created_at, revoked_at FROM players WHERE revoked_at IS NULL ORDER BY created_at`,
      )
      .map((r) => ({
        ...toPlayer(r),
        createdAt: Number(r.created_at),
        revokedAt: r.revoked_at === null ? null : Number(r.revoked_at),
      }));
  }

  /**
   * A player's new name (they changed it in the game, where Oak asks it). Names stay unique,
   * ignoring case, among players still in; a player may change the case of their own.
   */
  setName(playerId: string, nameInput: string): { ok: true; player: Player } | { ok: false; error: "bad-name" | "name-taken" | "not-found" } {
    const player = this.#activePlayer(playerId);
    if (!player) return { ok: false, error: "not-found" };
    const name = cleanName(nameInput);
    if (!name) return { ok: false, error: "bad-name" };
    if (name.toLowerCase() !== player.name.toLowerCase() && this.#nameTaken(name)) return { ok: false, error: "name-taken" };
    this.#sql.exec("UPDATE players SET name = ? WHERE id = ?", name, playerId);
    return { ok: true, player: { ...player, name } };
  }

  /** Lets a player load Nick's cartridge, or stops them (D26). */
  setRomAccess(playerId: string, allowed: boolean): boolean {
    if (!this.#activePlayer(playerId)) return false;
    this.#sql.exec("UPDATE players SET rom_access = ? WHERE id = ?", allowed ? 1 : 0, playerId);
    return true;
  }

  /** Removes a player: their sessions and codes end, and their name and email are free again. */
  revokePlayer(playerId: string): boolean {
    if (!this.#activePlayer(playerId)) return false;
    this.#sql.exec("UPDATE players SET revoked_at = ? WHERE id = ?", this.#now(), playerId);
    this.#sql.exec("DELETE FROM sessions WHERE player_id = ?", playerId);
    this.#sql.exec("DELETE FROM login_codes WHERE player_id = ?", playerId);
    return true;
  }

  #activePlayer(id: string): Player | null {
    const row = this.#sql.exec(
      `SELECT ${PLAYER_COLUMNS} FROM players WHERE id = ? AND revoked_at IS NULL`,
      id,
    )[0];
    return row ? toPlayer(row) : null;
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

const PLAYER_COLUMNS = "id, name, email, rom_access";

function toPlayer(row: Record<string, SqlValue>): Player {
  return {
    id: String(row.id),
    name: String(row.name),
    email: row.email === null ? null : String(row.email),
    romAccess: Number(row.rom_access) === 1,
  };
}

/** Codes are hashed with their player, so two players' identical six digits never collide. */
function codeHash(playerId: string, code: string): Promise<string> {
  return sha256Hex(`${playerId}:${code}`);
}
