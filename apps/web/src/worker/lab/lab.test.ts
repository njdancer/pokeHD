import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { labApi, type LabBucket } from "./lab.ts";

function memoryLab() {
  const objects = new Map<string, { body: ArrayBuffer; etag: string; uploaded: Date; type?: string }>();
  let n = 0;
  const bucket: LabBucket = {
    async get(key, options) {
      const o = objects.get(key);
      if (!o) return null;
      const meta = { etag: o.etag, httpEtag: `"${o.etag}"`, size: o.body.byteLength, uploaded: o.uploaded };
      if (options?.onlyIf?.etagDoesNotMatch === o.etag) return meta;
      return { ...meta, body: new Response(o.body.slice(0)).body! };
    },
    async put(key, value, options) {
      const o = { body: value.slice(0), etag: `e${++n}`, uploaded: new Date(1_700_000_000_000 + n * 1000), type: options?.httpMetadata?.contentType };
      objects.set(key, o);
      return { httpEtag: `"${o.etag}"`, uploaded: o.uploaded };
    },
    async list({ prefix, delimiter }) {
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const dirs = new Set<string>(), files: string[] = [];
      for (const k of keys) {
        const rest = k.slice(prefix.length), cut = delimiter ? rest.indexOf(delimiter) : -1;
        if (cut >= 0) dirs.add(prefix + rest.slice(0, cut + 1));
        else files.push(k);
      }
      return { objects: files.map((key) => ({ key, size: objects.get(key)!.body.byteLength, uploaded: objects.get(key)!.uploaded })), delimitedPrefixes: [...dirs], truncated: false };
    },
    async delete(keys) {
      for (const k of [keys].flat()) objects.delete(k);
    },
  };
  const app = new Hono<{ Bindings: { PRIVATE: LabBucket } }>().basePath("/api").route("/admin/lab", labApi());
  const call = (path: string, init?: RequestInit) => app.request(`/api/admin/lab/${path}`, init, { PRIVATE: bucket });
  return { call, objects };
}

describe("lab file store", () => {
  it("round-trips files under lab/ with their type", async () => {
    const { call, objects } = memoryLab();
    const run = JSON.stringify({ schema: 1, id: "r1" });
    expect((await call("runs/r1/run.json", { method: "PUT", body: run })).status).toBe(200);
    expect(objects.get("lab/runs/r1/run.json")?.type).toBe("application/json");
    const got = await call("runs/r1/run.json");
    expect(got.headers.get("content-type")).toBe("application/json");
    expect(await got.text()).toBe(run);
    const png = new Uint8Array([137, 80, 78, 71]);
    await call("runs/r1/preds/real/map:PALLET_TOWN:0,0,4,3/pred.png", { method: "PUT", body: png });
    expect(new Uint8Array(await (await call("runs/r1/preds/real/map:PALLET_TOWN:0,0,4,3/pred.png")).arrayBuffer())).toEqual(png);
  });

  it("answers 304 when the browser's copy is current", async () => {
    const { call } = memoryLab();
    await call("index.json", { method: "PUT", body: "{}" });
    const first = await call("index.json");
    const etag = first.headers.get("etag")!;
    expect((await call("index.json", { headers: { "if-none-match": etag } })).status).toBe(304);
    await call("index.json", { method: "PUT", body: '{"a":1}' });
    expect((await call("index.json", { headers: { "if-none-match": etag } })).status).toBe(200);
  });

  it("lists folders", async () => {
    const { call } = memoryLab();
    for (const p of ["index.json", "runs/a/run.json", "runs/a/metrics.jsonl", "runs/b/run.json"]) await call(p, { method: "PUT", body: "{}" });
    expect(await (await call("")).json()).toMatchObject({ files: [{ path: "index.json" }], dirs: ["runs/"] });
    expect(await (await call("runs/")).json()).toMatchObject({ dirs: ["runs/a/", "runs/b/"] });
    const a = (await (await call("runs/a/")).json()) as { files: { path: string }[] };
    expect(a.files.map((f) => f.path)).toEqual(["runs/a/metrics.jsonl", "runs/a/run.json"]);
  });

  it("refuses bad paths, unknown types and broken JSON", async () => {
    const { call, objects } = memoryLab();
    expect((await call("runs/.hidden.json", { method: "PUT", body: "{}" })).status).toBe(415);
    expect((await call("x.exe", { method: "PUT", body: "x" })).status).toBe(415);
    expect((await call("x.json", { method: "PUT", body: "{" })).status).toBe(400);
    expect(objects.size).toBe(0);
  });

  it("deletes a file or a whole folder", async () => {
    const { call, objects } = memoryLab();
    for (const p of ["runs/a/run.json", "runs/a/x/y.png", "runs/b/run.json"]) await call(p, { method: "PUT", body: "{}" });
    await call("runs/b/run.json", { method: "DELETE" });
    expect(objects.has("lab/runs/b/run.json")).toBe(false);
    expect(await (await call("runs/a/?recursive=1", { method: "DELETE" })).json()).toMatchObject({ removed: 2 });
    expect(objects.size).toBe(0);
  });
});
