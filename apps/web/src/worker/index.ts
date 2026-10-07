import { Hono } from "hono";

type Bindings = Env & { DEV_ROM_TOKEN?: string };

const app = new Hono<{ Bindings: Bindings }>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));

/** Serves the private test ROM to the holder of DEV_ROM_TOKEN. */
app.get("/dev-rom", async (c) => {
  const expected = c.env.DEV_ROM_TOKEN;
  const given = c.req.header("authorization")?.replace(/^Bearer /, "");
  if (!expected || !given || !(await tokensMatch(given, expected))) return c.text("Not found", 404);
  const rom = await c.env.PRIVATE.get(c.env.DEV_ROM_KEY);
  if (!rom) return c.text("Not found", 404);
  return new Response(rom.body, {
    headers: { "content-type": "application/octet-stream", "cache-control": "private, no-store" },
  });
});

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
