import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { normaliseCode } from "./codes.ts";
import {
  cleanEmail,
  cleanName,
  DirectoryStore,
  EMAIL_CODE_TTL,
  EMAIL_CODES_PER_HOUR,
  LINK_CODE_TTL,
  MAX_ATTEMPTS,
  type Sql,
  type SqlValue,
} from "./store.ts";

function makeStore(db = new DatabaseSync(":memory:")) {
  let now = 1_000_000;
  const sql: Sql = { exec: (q, ...p) => db.prepare(q).all(...p) as Record<string, SqlValue>[] };
  const store = new DirectoryStore(sql, () => now);
  return { store, db, advance: (ms: number) => (now += ms) };
}

function added(store: DirectoryStore, email: string, name: string) {
  const result = store.addPlayer(email, name);
  if (!result.ok) throw new Error(result.error);
  return result.player;
}

async function code(store: DirectoryStore, playerId: string, kind: "email" | "link") {
  const result = await store.createCode(playerId, kind);
  if (!result.ok) throw new Error(result.error);
  return result.code;
}

async function signedIn(store: DirectoryStore, email: string, name: string) {
  const player = added(store, email, name);
  const result = await store.verify(email, await code(store, player.id, "link"));
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe("codes", () => {
  it("normalises what people type", () => {
    expect(normaliseCode("abcd-efgh-jkmn")).toBe("ABCDEFGHJKMN");
    expect(normaliseCode(" o1il 2345 6789 ")).toBe("011123456789");
    expect(normaliseCode("123 456")).toBe("123456");
    expect(normaliseCode("12345")).toBeNull();
    expect(normaliseCode("ABC123")).toBeNull();
    expect(normaliseCode("ABCD-EFGH-JKM")).toBeNull();
    expect(normaliseCode("ABCD-EFGH-JKMU")).toBeNull();
  });
});

describe("names and emails", () => {
  it("trims names, and allows letters in any script", () => {
    expect(cleanName("  Sam  ")).toBe("Sam");
    expect(cleanName("Zoë O'Neil")).toBe("Zoë O'Neil");
    expect(cleanName("レッド")).toBe("レッド");
  });
  it("rejects empty, long or odd names", () => {
    expect(cleanName("   ")).toBeNull();
    expect(cleanName("x".repeat(17))).toBeNull();
    expect(cleanName("<script>")).toBeNull();
  });
  it("lower-cases emails and rejects non-emails", () => {
    expect(cleanEmail(" Sam@Example.COM ")).toBe("sam@example.com");
    expect(cleanEmail("sam")).toBeNull();
    expect(cleanEmail("sam@example")).toBeNull();
    expect(cleanEmail("a b@example.com")).toBeNull();
  });
});

describe("DirectoryStore", () => {
  it("signs in with an emailed code, then knows the session", async () => {
    const { store } = makeStore();
    const sam = added(store, "sam@example.com", "Sam");
    const emailed = await code(store, sam.id, "email");
    expect(emailed).toMatch(/^\d{6}$/);
    const result = await store.verify("SAM@example.com", emailed);
    expect(result).toMatchObject({ ok: true, player: sam });
    if (!result.ok) return;
    expect(await store.authenticate(result.sessionToken)).toEqual(sam);
    expect(await store.authenticate("nope")).toBeNull();
  });

  it("uses a code only once, and only for its own player", async () => {
    const { store } = makeStore();
    const sam = added(store, "sam@example.com", "Sam");
    added(store, "alex@example.com", "Alex");
    const link = await code(store, sam.id, "link");
    expect(await store.verify("alex@example.com", link)).toEqual({ ok: false, error: "invalid-code" });
    expect((await store.verify("sam@example.com", link.toLowerCase())).ok).toBe(true);
    expect(await store.verify("sam@example.com", link)).toEqual({ ok: false, error: "invalid-code" });
  });

  it("expires codes: emailed ones quickly, links after a week", async () => {
    const { store, advance } = makeStore();
    const sam = added(store, "sam@example.com", "Sam");
    const emailed = await code(store, sam.id, "email");
    const link = await code(store, sam.id, "link");
    advance(EMAIL_CODE_TTL);
    expect((await store.verify("sam@example.com", emailed)).ok).toBe(false);
    expect((await store.verify("sam@example.com", link)).ok).toBe(true);
    const late = await code(store, sam.id, "link");
    advance(LINK_CODE_TTL);
    expect((await store.verify("sam@example.com", late)).ok).toBe(false);
  });

  it("stops emailed codes after too many wrong guesses", async () => {
    const { store } = makeStore();
    const sam = added(store, "sam@example.com", "Sam");
    const emailed = await code(store, sam.id, "email");
    const wrong = emailed === "000000" ? "111111" : "000000";
    for (let i = 0; i < MAX_ATTEMPTS; i++) await store.verify("sam@example.com", wrong);
    expect((await store.verify("sam@example.com", emailed)).ok).toBe(false);
  });

  it("rate limits emailed codes", async () => {
    const { store, advance } = makeStore();
    const sam = added(store, "sam@example.com", "Sam");
    await code(store, sam.id, "email");
    expect(await store.createCode(sam.id, "email")).toEqual({ ok: false, error: "too-soon" });
    for (let i = 1; i < EMAIL_CODES_PER_HOUR; i++) {
      advance(61_000);
      await code(store, sam.id, "email");
    }
    advance(61_000);
    expect(await store.createCode(sam.id, "email")).toEqual({ ok: false, error: "too-many" });
    // Nick's links aren't limited.
    expect((await store.createCode(sam.id, "link")).ok).toBe(true);
  });

  it("keeps names and emails unique, ignoring case", () => {
    const { store } = makeStore();
    added(store, "sam@example.com", "Sam");
    expect(store.addPlayer("other@example.com", "sam")).toEqual({ ok: false, error: "name-taken" });
    expect(store.addPlayer("SAM@example.com", "Alex")).toEqual({ ok: false, error: "email-taken" });
    expect(store.addPlayer("nope", "Alex")).toEqual({ ok: false, error: "bad-email" });
    expect(store.addPlayer("alex@example.com", "")).toEqual({ ok: false, error: "bad-name" });
  });

  it("lets a player rename themselves, keeping names unique", async () => {
    const { store } = makeStore();
    added(store, "alex@example.com", "Alex");
    const sam = await signedIn(store, "sam@example.com", "Sam");
    expect(store.setName(sam.player.id, "Alex")).toEqual({ ok: false, error: "name-taken" });
    expect(store.setName(sam.player.id, "  ")).toEqual({ ok: false, error: "bad-name" });
    expect(store.setName(sam.player.id, "SAM")).toMatchObject({ ok: true, player: { name: "SAM" } });
    expect(store.setName(sam.player.id, "Sammy")).toMatchObject({ ok: true });
    expect(await store.authenticate(sam.sessionToken)).toMatchObject({ name: "Sammy" });
    expect(store.setName("nobody", "Kim")).toEqual({ ok: false, error: "not-found" });
  });

  it("makes the admin's player on first use, adopting their old invite-code player", () => {
    const { store, db } = makeStore();
    db.prepare("INSERT INTO players (id, name, created_at) VALUES ('old', 'Nick', 1)").run();
    const nick = store.ensurePlayer("nick@example.com", "Nick");
    expect(nick).toEqual({ id: "old", name: "Nick", email: "nick@example.com", romAccess: true });
    expect(store.ensurePlayer("nick@example.com", "Nick")).toEqual(nick);

    const fresh = makeStore().store;
    expect(fresh.ensurePlayer("nick@example.com", "Nick")).toMatchObject({ name: "Nick", email: "nick@example.com" });
  });

  it("upgrades a D19 database, keeping players and sessions", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE players (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER);
      CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL, created_at INTEGER NOT NULL);
      INSERT INTO players VALUES ('p1', 'Sam', 1, NULL);
    `);
    const { store } = makeStore(db);
    expect(store.listPlayers()).toMatchObject([{ id: "p1", name: "Sam", email: null, romAccess: true }]);
    expect(store.setEmail("p1", "sam@example.com")).toEqual({ ok: true });
    const link = await code(store, "p1", "link");
    expect((await store.verify("sam@example.com", link)).ok).toBe(true);
    // Opening it again (a new Durable Object instance) is harmless.
    expect(makeStore(db).store.listPlayers()).toHaveLength(1);
  });

  it("removing a player ends their sessions and codes, and frees the name and email", async () => {
    const { store } = makeStore();
    const sam = await signedIn(store, "sam@example.com", "Sam");
    const link = await code(store, sam.player.id, "link");
    expect(store.revokePlayer(sam.player.id)).toBe(true);
    expect(await store.authenticate(sam.sessionToken)).toBeNull();
    expect((await store.verify("sam@example.com", link)).ok).toBe(false);
    expect(await store.createCode(sam.player.id, "link")).toEqual({ ok: false, error: "not-found" });
    expect(store.listPlayers()).toEqual([]);
    added(store, "sam@example.com", "Sam");
  });

  it("shares Nick's cartridge with new players until he stops it", async () => {
    const { store } = makeStore();
    const sam = await signedIn(store, "sam@example.com", "Sam");
    expect(sam.player.romAccess).toBe(true);
    expect(store.setRomAccess(sam.player.id, false)).toBe(true);
    expect(await store.authenticate(sam.sessionToken)).toMatchObject({ romAccess: false });
    expect(store.listPlayers()).toMatchObject([{ romAccess: false }]);
    expect(store.setRomAccess(sam.player.id, true)).toBe(true);
    expect(await store.authenticate(sam.sessionToken)).toMatchObject({ romAccess: true });
    expect(store.setRomAccess("nobody", true)).toBe(false);
  });

  it("signing out ends only that session", async () => {
    const { store } = makeStore();
    const sam = await signedIn(store, "sam@example.com", "Sam");
    const other = await store.verify("sam@example.com", await code(store, sam.player.id, "link"));
    await store.endSession(sam.sessionToken);
    expect(await store.authenticate(sam.sessionToken)).toBeNull();
    if (other.ok) expect(await store.authenticate(other.sessionToken)).toEqual(sam.player);
  });
});
