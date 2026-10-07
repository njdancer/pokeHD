// Cloud backup of battery saves (p1-saves-cloud): one SRAM image per player per ROM, in the
// private SAVES bucket. A battery save is game data the player made, not Nintendo's data.
// Last writer wins; the bucket's upload time is the version both devices compare.
import { Hono, type Context } from "hono";

/** The largest cartridge RAM we accept: Pokémon Blue's is exactly 32 KB. */
export const MAX_SAVE_BYTES = 32 * 1024;
/** Response header carrying the server time (ms since epoch) the returned save was stored. */
export const SAVED_AT_HEADER = "x-saved-at";

/** The slice of R2Bucket this route uses, so tests can pass a plain object. */
export interface SaveBucket {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; uploaded: Date } | null>;
  put(key: string, value: ArrayBuffer): Promise<{ uploaded: Date } | null>;
}

type Env<B> = { Bindings: B };

/** Saves are keyed by the player and the ROM's SHA-1 (lower-case hex), like the local store. */
export const saveKey = (playerId: string, romSha1: string) => `saves/${playerId}/${romSha1}.sav`;
const SHA1 = /^[0-9a-f]{40}$/;

/**
 * `GET` and `PUT /:romSha1` for the signed-in player. `playerOf` resolves the session cookie
 * (D19); everything here is 401 without one.
 */
export function savesApi<B extends { SAVES: SaveBucket }>(
  playerOf: (c: Context<Env<B>>) => Promise<{ id: string } | null>,
) {
  const api = new Hono<Env<B>>();

  api.use("/:romSha1", async (c, next) => {
    if (!SHA1.test(c.req.param("romSha1"))) return c.json({ error: "bad-rom" }, 400);
    await next();
  });

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
    const declared = Number(c.req.header("content-length") ?? 0);
    if (declared > MAX_SAVE_BYTES) return c.json({ error: "too-large" }, 413);
    const body = await c.req.arrayBuffer();
    if (body.byteLength > MAX_SAVE_BYTES) return c.json({ error: "too-large" }, 413);
    if (body.byteLength === 0) return c.json({ error: "empty" }, 400);
    const stored = await c.env.SAVES.put(saveKey(player.id, c.req.param("romSha1")), body);
    return c.json({ savedAt: stored?.uploaded.getTime() ?? Date.now() });
  });

  return api;
}
