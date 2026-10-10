// The lock service's routes (D40): `POST /:key/lock` with a heartbeat, `POST /:key/unlock` when
// a device is done with a save. Unlock is sent with sendBeacon as a page closes, so it takes a
// text body too.
import { Hono, type Context } from "hono";
import { parseLockBeat, parseLockRelease, SLOT_KEY, type LockAnswer, type LockBeat } from "@pokehd/protocol";

/** One player's leases: the SaveLocks Durable Object, or a stand-in in tests. */
export interface PlayerLocks {
  beat(key: string, beat: LockBeat): LockAnswer | Promise<LockAnswer>;
  release(key: string, device: string): void | Promise<void>;
}

type Env<B> = { Bindings: B };

/** A small JSON body read as `parse` says, or null. */
async function body<T>(c: Context, parse: (json: unknown) => T | null): Promise<T | null> {
  const text = await c.req.text();
  if (text.length > 1024) return null;
  try {
    return parse(JSON.parse(text));
  } catch {
    return null;
  }
}

export function locksApi<B extends object>(
  playerOf: (c: Context<Env<B>>) => Promise<{ id: string } | null>,
  locksOf: (c: Context<Env<B>>, playerId: string) => PlayerLocks,
) {
  const api = new Hono<Env<B>>();

  api.post("/:key/lock", async (c) => {
    const key = c.req.param("key");
    if (!SLOT_KEY.test(key)) return c.json({ error: "bad-rom" }, 400);
    const player = await playerOf(c);
    if (!player) return c.json({ error: "signed-out" }, 401);
    const beat = await body(c, parseLockBeat);
    if (!beat) return c.json({ error: "bad-message" }, 400);
    return c.json(await locksOf(c, player.id).beat(key, beat));
  });

  api.post("/:key/unlock", async (c) => {
    const key = c.req.param("key");
    if (!SLOT_KEY.test(key)) return c.json({ error: "bad-rom" }, 400);
    const player = await playerOf(c);
    if (!player) return c.json({ error: "signed-out" }, 401);
    const release = await body(c, parseLockRelease);
    if (!release) return c.json({ error: "bad-message" }, 400);
    await locksOf(c, player.id).release(key, release.device);
    return c.body(null, 204);
  });

  return api;
}
