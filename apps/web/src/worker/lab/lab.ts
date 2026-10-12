// The relief lab's file store (docs/relief-ml/LAB-CONTRACT.md): the trainer on Nick's Mac mirrors
// its run tree into the private bucket under `lab/`, and /admin/lab reads it. Mounted under the
// admin routes, so only Nick's session or ADMIN_TOKEN gets here. Files may be derived from the ROM:
// they stay private, never public (CLAUDE.md, D37).
import { Hono } from "hono";
import { LAB_FILE_MAX_BYTES, labContentType } from "@pokehd/protocol";

const PREFIX = "lab/";

/** The slice of R2Bucket this route uses, so tests can pass a plain object. */
export interface LabBucket {
  get(key: string, options?: { onlyIf?: { etagDoesNotMatch?: string } }): Promise<
    { etag: string; httpEtag: string; size: number; uploaded: Date; body?: ReadableStream } | null
  >;
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<{ httpEtag: string; uploaded: Date } | null>;
  list(options: { prefix: string; delimiter?: string; cursor?: string; limit?: number }): Promise<{
    objects: { key: string; size: number; uploaded: Date }[];
    delimitedPrefixes: string[];
    truncated: boolean;
    cursor?: string;
  }>;
  delete(keys: string | string[]): Promise<void>;
}

type Env<B> = { Bindings: B };

export function labApi<B extends { PRIVATE: LabBucket }>() {
  const api = new Hono<Env<B>>();

  api.get("/*", async (c) => {
    const path = pathOf(c.req.path);
    // A trailing slash (or nothing) lists a folder.
    if (path === "" || path.endsWith("/")) {
      if (path && !labContentType(`${path}x.json`)) return c.json({ error: "bad-path" }, 400);
      const listed = await c.env.PRIVATE.list({ prefix: PREFIX + path, delimiter: "/", cursor: c.req.query("cursor"), limit: 1000 });
      return c.json(
        {
          files: listed.objects.map((o) => ({ path: o.key.slice(PREFIX.length), size: o.size, uploaded: o.uploaded.toISOString() })),
          dirs: listed.delimitedPrefixes.map((p) => p.slice(PREFIX.length)),
          ...(listed.truncated && listed.cursor ? { cursor: listed.cursor } : {}),
        },
        200,
        { "cache-control": "private, no-store" },
      );
    }
    const type = labContentType(path);
    if (!type) return c.json({ error: "bad-path" }, 400);
    const ifNoneMatch = c.req.header("if-none-match")?.replace(/^W\//, "").replace(/"/g, "");
    const object = await c.env.PRIVATE.get(PREFIX + path, ifNoneMatch ? { onlyIf: { etagDoesNotMatch: ifNoneMatch } } : undefined);
    if (!object) return c.json({ error: "not-found" }, 404);
    const headers = { etag: object.httpEtag, "cache-control": "private, no-cache", "last-modified": object.uploaded.toUTCString() };
    // R2 leaves the body out when the condition fails: the browser's copy is current.
    if (!object.body) return new Response(null, { status: 304, headers });
    return new Response(object.body, { headers: { ...headers, "content-type": type, "content-length": String(object.size) } });
  });

  api.put("/*", async (c) => {
    const path = pathOf(c.req.path);
    const type = labContentType(path);
    if (!type) return c.json({ error: "bad-type" }, 415);
    if (Number(c.req.header("content-length") ?? 0) > LAB_FILE_MAX_BYTES) return c.json({ error: "too-large" }, 413);
    const body = await c.req.arrayBuffer();
    if (body.byteLength > LAB_FILE_MAX_BYTES) return c.json({ error: "too-large" }, 413);
    if (type === "application/json") {
      try {
        JSON.parse(new TextDecoder().decode(body));
      } catch {
        return c.json({ error: "not-json" }, 400);
      }
    }
    const put = await c.env.PRIVATE.put(PREFIX + path, body, { httpMetadata: { contentType: type } });
    return c.json({ ok: true, etag: put?.httpEtag, uploaded: put?.uploaded.toISOString() });
  });

  api.delete("/*", async (c) => {
    const path = pathOf(c.req.path);
    if (path.endsWith("/") && c.req.query("recursive") === "1") {
      if (!labContentType(`${path}x.json`)) return c.json({ error: "bad-path" }, 400);
      let removed = 0, cursor: string | undefined;
      do {
        const listed = await c.env.PRIVATE.list({ prefix: PREFIX + path, cursor, limit: 1000 });
        if (listed.objects.length) await c.env.PRIVATE.delete(listed.objects.map((o) => o.key));
        removed += listed.objects.length;
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);
      return c.json({ ok: true, removed });
    }
    if (!labContentType(path)) return c.json({ error: "bad-path" }, 400);
    await c.env.PRIVATE.delete(PREFIX + path);
    return c.json({ ok: true });
  });

  return api;
}

/** The path under `lab/` from the request path (`/api/admin/lab/runs/x/run.json` → `runs/x/run.json`). */
function pathOf(requestPath: string): string {
  const i = requestPath.indexOf("/lab/");
  return i < 0 ? "" : decodeURIComponent(requestPath.slice(i + "/lab/".length));
}
