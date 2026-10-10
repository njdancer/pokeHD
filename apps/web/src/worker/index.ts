import { Hono, type Context } from "hono";
import { ERROR_REPORT_MAX_BYTES, parseErrorReport } from "@pokehd/protocol";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sendSignIn, signInLink } from "./directory/mail.ts";
import { cleanEmail, type CodeKind, type Player } from "./directory/store.ts";
import { PLAYER_ID_HEADER, PLAYER_NAME_HEADER } from "./room/do.ts";
import { locksApi } from "./locks/api.ts";
import { savesApi } from "./saves/saves.ts";

export { Directory } from "./directory/do.ts";
export { Room } from "./room/do.ts";
export { SaveLocks } from "./locks/do.ts";
export { Reports } from "./reports/do.ts";

type Bindings = Env & { DEV_ROM_TOKEN?: string; ADMIN_TOKEN?: string };
type Ctx = Context<{ Bindings: Bindings }>;

/** The session cookie. `__Host-` pins it to this origin, over HTTPS, for every path. */
const SESSION_COOKIE = "__Host-pokehd-session";
const SESSION_MAX_AGE = 400 * 24 * 60 * 60; // the most browsers allow

const app = new Hono<{ Bindings: Bindings }>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));

/**
 * Serves Nick's cartridge (D26): to Nick, to friends he invited and hasn't stopped (romAccess),
 * and to tools with DEV_ROM_TOKEN (`pnpm rom:fetch` in a sandbox with no browser). `/dev-rom`
 * is its old name, kept for tools.
 */
app.on("GET", ["/rom", "/dev-rom"], async (c) => {
  const allowed = (await bearerMatches(c, c.env.DEV_ROM_TOKEN)) || romAccess(c, await currentPlayer(c));
  if (!allowed) return c.text("Not found", 404);
  const rom = await c.env.PRIVATE.get(c.env.DEV_ROM_KEY);
  if (!rom) return c.text("Not found", 404);
  return new Response(rom.body, {
    headers: { "content-type": "application/octet-stream", "cache-control": "private, no-store" },
  });
});

// Friends (D23): a player is an email address. Signing in sends a code to it; the session cookie
// says who you are after that. Nick (ADMIN_EMAIL) adds friends from the game.

/** Emails a sign-in code, if the address belongs to a player. The answer doesn't say which. */
app.post("/auth/request", async (c) => {
  const body = await c.req.json<{ email?: unknown }>().catch(() => ({}) as never);
  const email = typeof body.email === "string" ? cleanEmail(body.email) : null;
  if (!email) return c.json({ error: "bad-email" }, 400);
  const dir = directory(c);
  const player =
    email === adminEmail(c) ? await dir.ensurePlayer(email, c.env.ADMIN_NAME) : await dir.playerByEmail(email);
  if (!player) return c.json({ ok: true });
  const code = await dir.createCode(player.id, "email");
  if (!code.ok) return c.json({ ok: true }); // Rate limited: the last code is still on its way.
  try {
    await sendSignIn(c.env, {
      to: email,
      code: code.code,
      link: signInLink(new URL(c.req.url).origin, email, code.code),
      invite: false,
    });
  } catch (error) {
    console.error("sign-in email failed", error);
    return c.json({ error: "send-failed" }, 502);
  }
  return c.json({ ok: true });
});

/** Signs in with the emailed code, or the code in a sign-in link. */
app.post("/auth/verify", async (c) => {
  const body = await c.req.json<{ email?: unknown; code?: unknown }>().catch(() => ({}) as never);
  if (typeof body.email !== "string" || typeof body.code !== "string") {
    return c.json({ error: "invalid-code" }, 400);
  }
  const result = await directory(c).verify(body.email, body.code);
  if (!result.ok) return c.json({ error: result.error }, 400);
  setSession(c, result.sessionToken);
  return c.json(account(c, result.player));
});

app.get("/me", async (c) => {
  const player = await currentPlayer(c);
  if (!player) return c.json({ error: "signed-out" }, 401);
  // Every visit pushes the cookie's expiry out again, so a player who keeps playing stays in.
  setSession(c, getCookie(c, SESSION_COOKIE)!);
  return c.json(account(c, player));
});

/** The player renames themselves: the name Oak asks in the game, kept the same as this one. */
app.patch("/me", async (c) => {
  const player = await currentPlayer(c);
  if (!player) return c.json({ error: "signed-out" }, 401);
  const body = await c.req.json<{ name?: unknown }>().catch(() => ({}) as never);
  const result = await directory(c).setName(player.id, typeof body.name === "string" ? body.name : "");
  if (!result.ok) return c.json({ error: result.error }, result.error === "name-taken" ? 409 : 400);
  return c.json(account(c, result.player));
});

/** Everyone else on the server: the Pokédex menu's friends, names only (who's online comes from the room). */
app.get("/friends", async (c) => {
  const player = await currentPlayer(c);
  if (!player) return c.json({ error: "signed-out" }, 401);
  const players = await directory(c).listPlayers();
  return c.json({ friends: players.filter((p) => p.id !== player.id).map((p) => ({ id: p.id, name: p.name })) });
});

app.post("/sign-out", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await directory(c).endSession(token);
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
  return c.json({ ok: true });
});

/** The shared world: a WebSocket to the room, for signed-in players only. */
app.get("/room", async (c) => {
  if (c.req.header("upgrade") !== "websocket") return c.text("Expected a WebSocket upgrade", 426);
  // Browsers send Origin on WebSocket upgrades; a page on another site can't open this one.
  const origin = c.req.header("origin");
  if (origin && new URL(origin).host !== new URL(c.req.url).host) return c.text("Forbidden", 403);
  const player = await currentPlayer(c);
  if (!player) return c.text("Signed out", 401);
  const headers = new Headers(c.req.raw.headers);
  headers.set(PLAYER_ID_HEADER, player.id);
  headers.set(PLAYER_NAME_HEADER, encodeURIComponent(player.name));
  const room = c.env.ROOM.getByName("world");
  return room.fetch(new Request(c.req.raw, { headers }));
});

/** One device per save (D41): leases on the player's saves, kept by their own SaveLocks object. */
app.route("/saves", locksApi<Bindings>(currentPlayer, (c, id) => c.env.LOCKS.getByName(id)));
/** Cloud backup of the player's battery saves, per ROM. */
app.route("/saves", savesApi<Bindings>(currentPlayer));

/**
 * Crash reports from the game, signed in or not (a crash can come before sign-in). Read at
 * /admin/errors. Sent with fetch keepalive or sendBeacon, so the body may be text/plain.
 */
app.post("/errors", async (c) => {
  const origin = c.req.header("origin");
  if (origin && new URL(origin).host !== new URL(c.req.url).host) return c.text("Forbidden", 403);
  const text = await c.req.text();
  if (text.length > ERROR_REPORT_MAX_BYTES) return c.json({ error: "too-big" }, 413);
  let report;
  try {
    report = parseErrorReport(JSON.parse(text));
  } catch {
    report = null;
  }
  if (!report) return c.json({ error: "bad-report" }, 400);
  const player = await currentPlayer(c).catch(() => null);
  // Also in the Worker's logs (Workers Observability), next to whatever the server was doing.
  console.warn("client error", report.kind, report.message, player?.name ?? "signed out");
  const stored = await reports(c).add(report, player && { id: player.id, name: player.name });
  return c.json({ ok: true, stored });
});

// Admin: Nick, signed in as ADMIN_EMAIL, from the game. ADMIN_TOKEN (a Worker secret) is for
// scripts and tests: `pnpm invite` wraps these routes. The session cookie is SameSite=Strict, so
// another site can't make Nick's browser call them.

app.use("/admin/*", async (c, next) => {
  const allowed =
    (await bearerMatches(c, c.env.ADMIN_TOKEN)) ||
    isAdmin(c, await currentPlayer(c)) ||
    // Claude's cloud sandboxes only have DEV_ROM_TOKEN; Nick let it read crash reports (`pnpm errors`).
    (c.req.method === "GET" && c.req.path.startsWith("/api/admin/errors") && (await bearerMatches(c, c.env.DEV_ROM_TOKEN)));
  if (!allowed) return c.text("Not found", 404);
  await next();
});

app.get("/admin/players", async (c) => {
  const players = await directory(c).listPlayers();
  return c.json({ players: players.map((p) => ({ ...p, admin: isAdmin(c, p) })) });
});

/** Adds a friend by email, and makes them a sign-in link (emailed to them if `send`). */
app.post("/admin/players", async (c) => {
  const body = await c.req.json<{ email?: unknown; name?: unknown; send?: unknown }>().catch(() => ({}) as never);
  const email = typeof body.email === "string" ? body.email : "";
  const name = typeof body.name === "string" ? body.name : "";
  const added = await directory(c).addPlayer(email, name);
  if (!added.ok) return c.json({ error: added.error }, added.error.endsWith("-taken") ? 409 : 400);
  return c.json({ player: added.player, ...(await invite(c, added.player, body.send === true)) });
});

/** Crash reports grouped by problem, the most recently seen first. */
app.get("/admin/errors", async (c) => c.json({ groups: await reports(c).groups() }));

/** The newest reports of one problem (`?fp=`, a group's fingerprint). */
app.get("/admin/errors/reports", async (c) => c.json({ reports: await reports(c).reports(c.req.query("fp") ?? "") }));

/** Forgets one problem (`?fp=`), or every report. */
app.delete("/admin/errors", async (c) => {
  await reports(c).clear(c.req.query("fp") || undefined);
  return c.json({ ok: true });
});

// The relief editor's painted normals (/tools/relief). Training material only: the game never reads
// them. Kept in the private bucket so Nick's phone and Mac see the same work; scripts export them
// with ADMIN_TOKEN.
const RELIEF_KEY = "relief/normals.json";
const RELIEF_MAX_BYTES = 8 * 1024 * 1024;

app.get("/admin/relief", async (c) => {
  const doc = await c.env.PRIVATE.get(RELIEF_KEY);
  if (!doc) return c.json({ version: 1, tiles: {}, pics: {} });
  return new Response(doc.body, { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
});

app.put("/admin/relief", async (c) => {
  const text = await c.req.text();
  if (text.length > RELIEF_MAX_BYTES) return c.json({ error: "too-large" }, 413);
  let doc: { version?: unknown; tiles?: unknown; pics?: unknown };
  try { doc = JSON.parse(text); } catch { return c.json({ error: "not-json" }, 400); }
  if (doc.version !== 1 || typeof doc.tiles !== "object" || typeof doc.pics !== "object") return c.json({ error: "bad-shape" }, 400);
  await c.env.PRIVATE.put(RELIEF_KEY, text, { httpMetadata: { contentType: "application/json" } });
  return c.json({ ok: true, savedAt: new Date().toISOString() });
});

/** A fresh sign-in link for a player, e.g. when the first one expired. */
app.post("/admin/players/:id/link", async (c) => {
  const body = await c.req.json<{ send?: unknown }>().catch(() => ({}) as never);
  const player = (await directory(c).listPlayers()).find((p) => p.id === c.req.param("id"));
  if (!player?.email) return c.json({ error: "not-found" }, 404);
  return c.json(await invite(c, player, body.send === true));
});

/**
 * Changes a player: `email` gives one to a friend who joined with a D19 invite code;
 * `romAccess` lets them load Nick's cartridge or stops them (D26).
 */
app.patch("/admin/players/:id", async (c) => {
  const body = await c.req.json<{ email?: unknown; romAccess?: unknown }>().catch(() => ({}) as never);
  if (typeof body.romAccess === "boolean") {
    const changed = await directory(c).setRomAccess(c.req.param("id"), body.romAccess);
    return changed ? c.json({ ok: true }) : c.json({ error: "not-found" }, 404);
  }
  const result = await directory(c).setEmail(c.req.param("id"), typeof body.email === "string" ? body.email : "");
  if (result.ok) return c.json({ ok: true });
  return c.json({ error: result.error }, result.error === "not-found" ? 404 : result.error === "email-taken" ? 409 : 400);
});

app.delete("/admin/players/:id", async (c) => {
  const dir = directory(c);
  const player = (await dir.listPlayers()).find((p) => p.id === c.req.param("id"));
  if (player && isAdmin(c, player)) return c.json({ error: "is-admin" }, 400);
  const removed = await dir.revokePlayer(c.req.param("id"));
  return removed ? c.json({ ok: true }) : c.json({ error: "not-found" }, 404);
});

/** Makes a link code for `player` and, if `send`, emails it. The link comes back either way. */
async function invite(c: Ctx, player: Player, send: boolean) {
  const code = await directory(c).createCode(player.id, "link" satisfies CodeKind);
  if (!code.ok || !player.email) throw new Error(`no link code for ${player.id}`);
  const link = signInLink(new URL(c.req.url).origin, player.email, code.code);
  let sent = false;
  if (send) {
    try {
      await sendSignIn(c.env, { to: player.email, name: player.name, code: code.code, link, invite: true });
      sent = true;
    } catch (error) {
      console.error("invite email failed", error);
    }
  }
  return { link, expiresAt: code.expiresAt, sent };
}

function directory(c: Ctx) {
  return c.env.DIRECTORY.getByName("friends");
}

function reports(c: Ctx) {
  return c.env.REPORTS.getByName("errors");
}

function adminEmail(c: Ctx): string | null {
  // Missing only in test Workers with a config of their own.
  return c.env.ADMIN_EMAIL ? cleanEmail(c.env.ADMIN_EMAIL) : null;
}

function isAdmin(c: Ctx, player: Player | null): boolean {
  return !!player?.email && player.email === adminEmail(c);
}

/** Whether `player` may load Nick's cartridge: Nick, or a friend he hasn't stopped (D26). */
function romAccess(c: Ctx, player: Player | null): boolean {
  return !!player && (isAdmin(c, player) || player.romAccess);
}

/** What the browser learns about the signed-in player. */
function account(c: Ctx, player: Player) {
  return {
    player: { id: player.id, name: player.name },
    email: player.email,
    admin: isAdmin(c, player),
    romAccess: romAccess(c, player),
  };
}

function setSession(c: Ctx, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Strict",
    maxAge: SESSION_MAX_AGE,
  });
}

async function currentPlayer(c: Ctx): Promise<Player | null> {
  const token = getCookie(c, SESSION_COOKIE);
  return token ? directory(c).authenticate(token) : null;
}

/** Whether the request carries `Authorization: Bearer <expected>`. False if no secret is set. */
async function bearerMatches(c: Ctx, expected: string | undefined): Promise<boolean> {
  const given = c.req.header("authorization")?.replace(/^Bearer /, "");
  return !!expected && !!given && (await tokensMatch(given, expected));
}

/** Constant-time comparison of SHA-256 digests, so timing never reveals the token. */
async function tokensMatch(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(da, db);
}

export default app satisfies ExportedHandler<Bindings>;
