import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Player } from "./directory/store.ts";
import { PLAYER_ID_HEADER, PLAYER_NAME_HEADER } from "./room/do.ts";

export { Directory } from "./directory/do.ts";
export { Room } from "./room/do.ts";

type Bindings = Env & { DEV_ROM_TOKEN?: string; ADMIN_TOKEN?: string };
type Ctx = Context<{ Bindings: Bindings }>;

/** The session cookie. `__Host-` pins it to this origin, over HTTPS, for every path. */
const SESSION_COOKIE = "__Host-pokehd-session";
const SESSION_MAX_AGE = 400 * 24 * 60 * 60; // the most browsers allow

const app = new Hono<{ Bindings: Bindings }>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));

/** Serves the private test ROM to the holder of DEV_ROM_TOKEN. */
app.get("/dev-rom", async (c) => {
  if (!(await bearerMatches(c, c.env.DEV_ROM_TOKEN))) return c.text("Not found", 404);
  const rom = await c.env.PRIVATE.get(c.env.DEV_ROM_KEY);
  if (!rom) return c.text("Not found", 404);
  return new Response(rom.body, {
    headers: { "content-type": "application/octet-stream", "cache-control": "private, no-store" },
  });
});

// Friends (D19): an invite code makes a player; the session cookie says who you are after that.

/** Joins with an invite code (new player called `name`) or a device code (existing player). */
app.post("/join", async (c) => {
  const body = await c.req.json<{ code?: unknown; name?: unknown }>().catch(() => ({}) as never);
  if (typeof body.code !== "string") return c.json({ error: "invalid-code" }, 400);
  const name = typeof body.name === "string" ? body.name : "";
  const result = await directory(c).redeem(body.code, name);
  if (!result.ok) return c.json({ error: result.error }, result.error === "name-taken" ? 409 : 400);
  setCookie(c, SESSION_COOKIE, result.sessionToken, {
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Strict",
    maxAge: SESSION_MAX_AGE,
  });
  return c.json({ player: result.player });
});

app.get("/me", async (c) => {
  const player = await currentPlayer(c);
  return player ? c.json({ player }) : c.json({ error: "signed-out" }, 401);
});

/** A one-hour code that signs you in on another device. */
app.post("/me/device-code", async (c) => {
  const player = await currentPlayer(c);
  if (!player) return c.json({ error: "signed-out" }, 401);
  return c.json(await directory(c).createDeviceCode(player.id));
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

// Admin: Nick, holding ADMIN_TOKEN (a Worker secret). `pnpm invite` wraps these.

app.use("/admin/*", async (c, next) => {
  if (!(await bearerMatches(c, c.env.ADMIN_TOKEN))) return c.text("Not found", 404);
  await next();
});

app.post("/admin/invites", async (c) => {
  const body = await c.req.json<{ note?: unknown }>().catch(() => ({}) as never);
  const note = typeof body.note === "string" ? body.note.slice(0, 100) : "";
  return c.json(await directory(c).createInvite(note));
});

app.get("/admin/invites", async (c) => c.json({ invites: await directory(c).listInvites() }));
app.get("/admin/players", async (c) => c.json({ players: await directory(c).listPlayers() }));

app.delete("/admin/players/:id", async (c) => {
  const removed = await directory(c).revokePlayer(c.req.param("id"));
  return removed ? c.json({ ok: true }) : c.json({ error: "not-found" }, 404);
});

function directory(c: Ctx) {
  return c.env.DIRECTORY.getByName("friends");
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
