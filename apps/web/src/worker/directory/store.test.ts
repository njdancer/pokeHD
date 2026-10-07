import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { normaliseInviteCode } from "./codes.ts";
import { cleanName, DEVICE_CODE_TTL, DirectoryStore, INVITE_TTL, type SqlValue } from "./store.ts";

function makeStore() {
  const db = new DatabaseSync(":memory:");
  let now = 1_000_000;
  const store = new DirectoryStore(
    { exec: (q, ...p) => db.prepare(q).all(...p) as Record<string, SqlValue>[] },
    () => now,
  );
  return { store, advance: (ms: number) => (now += ms) };
}

async function joined(store: DirectoryStore, name: string) {
  const { code } = await store.createInvite(name);
  const result = await store.redeem(code, name);
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe("invite codes", () => {
  it("normalises what people type", () => {
    expect(normaliseInviteCode("abcd-efgh-jkmn")).toBe("ABCDEFGHJKMN");
    expect(normaliseInviteCode(" o1il 2345 6789 ")).toBe("011123456789");
    expect(normaliseInviteCode("ABCD-EFGH-JKM")).toBeNull();
    expect(normaliseInviteCode("ABCD-EFGH-JKMU")).toBeNull();
  });
});

describe("names", () => {
  it("trims, and allows letters in any script", () => {
    expect(cleanName("  Sam  ")).toBe("Sam");
    expect(cleanName("Zoë O'Neil")).toBe("Zoë O'Neil");
    expect(cleanName("レッド")).toBe("レッド");
  });
  it("rejects empty, long or odd names", () => {
    expect(cleanName("   ")).toBeNull();
    expect(cleanName("x".repeat(17))).toBeNull();
    expect(cleanName("<script>")).toBeNull();
  });
});

describe("DirectoryStore", () => {
  it("joins with an invite, then knows the session", async () => {
    const { store } = makeStore();
    const { code } = await store.createInvite("for Sam");
    const result = await store.redeem(code.toLowerCase(), "Sam");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.player.name).toBe("Sam");
    expect(await store.authenticate(result.sessionToken)).toEqual(result.player);
    expect(await store.authenticate("nope")).toBeNull();
    expect(store.listInvites()).toMatchObject([{ note: "for Sam", usedBy: "Sam" }]);
  });

  it("uses an invite only once", async () => {
    const { store } = makeStore();
    const { code } = await store.createInvite("");
    expect((await store.redeem(code, "Sam")).ok).toBe(true);
    expect(await store.redeem(code, "Alex")).toEqual({ ok: false, error: "invalid-code" });
  });

  it("refuses expired and made-up codes", async () => {
    const { store, advance } = makeStore();
    const { code } = await store.createInvite("");
    expect(await store.redeem("AAAA-BBBB-CCCC", "Sam")).toEqual({ ok: false, error: "invalid-code" });
    advance(INVITE_TTL);
    expect(await store.redeem(code, "Sam")).toEqual({ ok: false, error: "invalid-code" });
  });

  it("keeps names unique, ignoring case, and leaves the invite unspent on a clash", async () => {
    const { store } = makeStore();
    await joined(store, "Sam");
    const { code } = await store.createInvite("");
    expect(await store.redeem(code, "sam")).toEqual({ ok: false, error: "name-taken" });
    expect(await store.redeem(code, "")).toEqual({ ok: false, error: "bad-name" });
    expect((await store.redeem(code, "Alex")).ok).toBe(true);
  });

  it("signs the same player in on another device", async () => {
    const { store, advance } = makeStore();
    const sam = await joined(store, "Sam");
    const device = (await store.createDeviceCode(sam.player.id))!;
    const second = await store.redeem(device.code, "ignored");
    expect(second).toMatchObject({ ok: true, player: sam.player });
    if (!second.ok) return;
    expect(second.sessionToken).not.toBe(sam.sessionToken);
    expect(await store.authenticate(sam.sessionToken)).toEqual(sam.player);
    // Device codes aren't invites, and don't last.
    expect(store.listInvites()).toHaveLength(1);
    const late = (await store.createDeviceCode(sam.player.id))!;
    advance(DEVICE_CODE_TTL);
    expect((await store.redeem(late.code, "")).ok).toBe(false);
  });

  it("revoking a player ends their sessions and frees the name", async () => {
    const { store } = makeStore();
    const sam = await joined(store, "Sam");
    expect(store.revokePlayer(sam.player.id)).toBe(true);
    expect(await store.authenticate(sam.sessionToken)).toBeNull();
    expect(await store.createDeviceCode(sam.player.id)).toBeNull();
    expect(store.listPlayers()).toMatchObject([{ name: "Sam", revokedAt: expect.any(Number) }]);
    await joined(store, "Sam");
  });

  it("signing out ends only that session", async () => {
    const { store } = makeStore();
    const sam = await joined(store, "Sam");
    const other = await store.redeem((await store.createDeviceCode(sam.player.id))!.code, "");
    await store.endSession(sam.sessionToken);
    expect(await store.authenticate(sam.sessionToken)).toBeNull();
    if (other.ok) expect(await store.authenticate(other.sessionToken)).toEqual(sam.player);
  });
});
