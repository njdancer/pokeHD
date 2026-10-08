// Cloud backup of battery saves (p1-saves-cloud): one SRAM image per player per ROM, in the
// private SAVES bucket. A battery save is game data the player made, not Nintendo's data.
// Last writer wins; the bucket's upload time is the version both devices compare.
import { Hono, type Context } from "hono";

/** The largest cartridge RAM we accept: Pokémon Blue's is exactly 32 KB. */
export const MAX_SAVE_BYTES = 32 * 1024;
/** Response header carrying the server time (ms since epoch) the returned save was stored. */
export const SAVED_AT_HEADER = "x-saved-at";
/** A resume point's headers: the SHA-1 of the save it holds, and of the state itself (ungzipped). */
export const SAVE_SHA1_HEADER = "x-save-sha1";
export const STATE_SHA1_HEADER = "x-state-sha1";

/** A resume point is a gzipped save state: a few KB, well under this. */
export const MAX_RESUME_BYTES = 256 * 1024;
/** Earlier saves kept per player per ROM (p1-kidproof): the oldest go first. */
export const HISTORY_KEEP = 30;
/** Why an earlier save was kept: lower-case words and dashes ("save", "replaced", …). */
const REASON = /^[a-z-]{1,24}$/;

type Metadata = Record<string, string>;

/** The slice of R2Bucket this route uses, so tests can pass a plain object. */
export interface SaveBucket {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; uploaded: Date; customMetadata?: Metadata } | null>;
  put(key: string, value: ArrayBuffer, options?: { customMetadata?: Metadata }): Promise<{ uploaded: Date } | null>;
  list(options: { prefix: string }): Promise<{
    objects: { key: string; uploaded: Date; customMetadata?: Metadata }[];
  }>;
  delete(keys: string[]): Promise<void>;
}

type Env<B> = { Bindings: B };

/** Saves are keyed by the player and the ROM's SHA-1 (lower-case hex), like the local store. */
export const saveKey = (playerId: string, romSha1: string) => `saves/${playerId}/${romSha1}.sav`;
/** The player's latest resume point for a ROM (p1-kidproof). */
export const resumeKey = (playerId: string, romSha1: string) => `saves/${playerId}/${romSha1}.resume`;
/** Earlier saves: `…/history/<savedAt>-<reason>.sav`, so keys sort oldest first. */
const historyPrefix = (playerId: string, romSha1: string) => `saves/${playerId}/${romSha1}/history/`;
const SHA1 = /^[0-9a-f]{40}$/;
const HISTORY_ID = /^\d{13}-[a-z-]{1,24}$/;

/** Reads a body up to `max` bytes: the body, or the error response. */
async function readBody(c: Context, max: number): Promise<ArrayBuffer | Response> {
  if (Number(c.req.header("content-length") ?? 0) > max) return c.json({ error: "too-large" }, 413);
  const body = await c.req.arrayBuffer();
  if (body.byteLength > max) return c.json({ error: "too-large" }, 413);
  if (body.byteLength === 0) return c.json({ error: "empty" }, 400);
  return body;
}

/**
 * `GET` and `PUT /:romSha1` for the signed-in player. `playerOf` resolves the session cookie
 * (D19); everything here is 401 without one.
 */
export function savesApi<B extends { SAVES: SaveBucket }>(
  playerOf: (c: Context<Env<B>>) => Promise<{ id: string } | null>,
) {
  const api = new Hono<Env<B>>();

  const checkRom = async (c: Context<Env<B>>, next: () => Promise<void>) => {
    if (!SHA1.test(c.req.param("romSha1") ?? "")) return c.json({ error: "bad-rom" }, 400);
    await next();
  };
  api.use("/:romSha1", checkRom);
  api.use("/:romSha1/*", checkRom);

  api.get("/:romSha1", async (c) => {
    const player = await playerOf(c);
    if (!player) return c.json({ error: "signed-out" }, 401);
    const save = await c.env.SAVES.get(saveKey(player.id, c.req.param("romSha1")));
    if (!save) return c.json({ error: "no-save" }, 404);
    return new Response(await save.arrayBuffer(), {
      headers: {
        "content-type": "application/octet-stream",
        "cache-control": "private, no-store",
        [SAVED_AT_HEADER]: String(save.uploaded.getTime()),
      },
    });
  });

  api.put("/:romSha1", async (c) => {
    const player = await playerOf(c);
    if (!player) return c.json({ error: "signed-out" }, 401);
    const body = await readBody(c, MAX_SAVE_BYTES);
    if (body instanceof Response) return body;
    const stored = await c.env.SAVES.put(saveKey(player.id, c.req.param("romSha1")), body);
    return c.json({ savedAt: stored?.uploaded.getTime() ?? Date.now() });
  });

  // Resume points (p1-kidproof): the page's latest, gzipped, with the SHA-1 of the save it
  // holds so another device uses it only on that same save.
  api.get("/:romSha1/resume", async (c) => {
    const player = await playerOf(c);
    if (!player) return c.json({ error: "signed-out" }, 401);
    const point = await c.env.SAVES.get(resumeKey(player.id, c.req.param("romSha1")));
    if (!point) return c.json({ error: "no-resume" }, 404);
    const meta = point.customMetadata ?? {};
    return new Response(await point.arrayBuffer(), {
      headers: {
        "content-type": "application/gzip",
        "cache-control": "private, no-store",
        [SAVED_AT_HEADER]: String(point.uploaded.getTime()),
        [SAVE_SHA1_HEADER]: meta["saveSha1"] ?? "",
        [STATE_SHA1_HEADER]: meta["stateSha1"] ?? "",
      },
    });
  });

  api.put("/:romSha1/resume", async (c) => {
    const player = await playerOf(c);
    if (!player) return c.json({ error: "signed-out" }, 401);
    const saveSha1 = c.req.header(SAVE_SHA1_HEADER) ?? "";
    const stateSha1 = c.req.header(STATE_SHA1_HEADER) ?? "";
    if (!SHA1.test(saveSha1) || !SHA1.test(stateSha1)) return c.json({ error: "bad-sha1" }, 400);
    const body = await readBody(c, MAX_RESUME_BYTES);
    if (body instanceof Response) return body;
    const stored = await c.env.SAVES.put(resumeKey(player.id, c.req.param("romSha1")), body, {
      customMetadata: { saveSha1, stateSha1 },
    });
    return c.json({ savedAt: stored?.uploaded.getTime() ?? Date.now() });
  });

  // Earlier saves (p1-kidproof): the page keeps a save every so often and before anything
  // replaces it; each is copied here too. Only the newest HISTORY_KEEP stay.
  api.get("/:romSha1/history", async (c) => {
    const player = await playerOf(c);
    if (!player) return c.json({ error: "signed-out" }, 401);
    const prefix = historyPrefix(player.id, c.req.param("romSha1"));
    const { objects } = await c.env.SAVES.list({ prefix });
    const saves = objects
      .map((o) => o.key.slice(prefix.length).replace(/\.sav$/, ""))
      .filter((id) => HISTORY_ID.test(id))
      .map((id) => ({ id, savedAt: Number(id.slice(0, 13)), reason: id.slice(14) }))
      .sort((a, b) => b.savedAt - a.savedAt);
    return c.json({ saves });
  });

  api.get("/:romSha1/history/:id", async (c) => {
    const player = await playerOf(c);
    if (!player) return c.json({ error: "signed-out" }, 401);
    const id = c.req.param("id");
    if (!HISTORY_ID.test(id)) return c.json({ error: "bad-id" }, 400);
    const save = await c.env.SAVES.get(`${historyPrefix(player.id, c.req.param("romSha1"))}${id}.sav`);
    if (!save) return c.json({ error: "no-save" }, 404);
    return new Response(await save.arrayBuffer(), {
      headers: { "content-type": "application/octet-stream", "cache-control": "private, no-store" },
    });
  });

  api.post("/:romSha1/history", async (c) => {
    const player = await playerOf(c);
    if (!player) return c.json({ error: "signed-out" }, 401);
    const reason = c.req.query("reason") ?? "save";
    // The page's own clock: it's only for ordering and display, and keeps a device's ids stable.
    const takenAt = Number(c.req.query("at"));
    if (!REASON.test(reason) || !Number.isInteger(takenAt) || takenAt < 1e12 || takenAt >= 1e13) {
      return c.json({ error: "bad-entry" }, 400);
    }
    const body = await readBody(c, MAX_SAVE_BYTES);
    if (body instanceof Response) return body;
    const prefix = historyPrefix(player.id, c.req.param("romSha1"));
    const id = `${takenAt}-${reason}`;
    await c.env.SAVES.put(`${prefix}${id}.sav`, body);
    const { objects } = await c.env.SAVES.list({ prefix });
    const old = objects.map((o) => o.key).sort().slice(0, -HISTORY_KEEP);
    if (old.length > 0) await c.env.SAVES.delete(old);
    return c.json({ id });
  });

  return api;
}
