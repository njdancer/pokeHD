import type { WorldData } from "@pokehd/rom";
import { buildChunk, deserializeGroup, type BuiltChunk, type ChunkJob, type SerializedGroup } from "./chunk.ts";

// Where live-world chunks get built: in a worker where the browser has them, so a build never
// stalls a frame, else in place.

export type ToChunkWorker = { type: "world"; world: WorldData } | { type: "build"; id: number; job: ChunkJob };
export type FromChunkWorker =
  | { type: "built"; id: number; group: SerializedGroup; rootX: number; rootY: number; ms: number }
  | { type: "failed"; id: number; error: string };

export interface ChunkResult extends BuiltChunk {
  /** Main-thread time spent on it, ms: the whole build in place, or turning the worker's result into objects. */
  mainMs: number;
  /** Time from asking to having it, ms. */
  totalMs: number;
}

export interface ChunkBuilder {
  /** Builds a chunk: at once (no worker), or in the background. */
  build(job: ChunkJob): ChunkResult | Promise<ChunkResult>;
  dispose(): void;
}

export function inPlaceBuilder(world: WorldData): ChunkBuilder {
  return {
    build(job) {
      const t0 = performance.now();
      const built = buildChunk(world, job);
      const ms = performance.now() - t0;
      return { ...built, mainMs: ms, totalMs: ms };
    },
    dispose() {},
  };
}

/** A worker-backed builder, or the in-place one where workers aren't available. */
export function createChunkBuilder(world: WorldData): ChunkBuilder {
  const local = inPlaceBuilder(world);
  if (typeof Worker === "undefined") return local;
  let worker: Worker;
  try {
    worker = new Worker(new URL("./chunk-worker.ts", import.meta.url), { type: "module", name: "pokehd-chunks" });
    // A few MB, cloned once; the worker keeps it.
    worker.postMessage({ type: "world", world } satisfies ToChunkWorker);
  } catch (e) {
    console.warn("[pokeHD] no chunk worker; building on the main thread", e);
    return local;
  }
  let broken = false;
  let nextId = 1;
  const waiting = new Map<number, { job: ChunkJob; at: number; resolve: (r: ChunkResult) => void; reject: (e: unknown) => void }>();
  const fallBack = (id: number, why: string) => {
    const w = waiting.get(id);
    if (!w) return;
    waiting.delete(id);
    console.warn(`[pokeHD] chunk worker couldn't build map ${w.job.map} (${why}); building it here`);
    try {
      w.resolve(local.build(w.job) as ChunkResult);
    } catch (e) {
      w.reject(e);
    }
  };
  worker.onmessage = ({ data }: MessageEvent<FromChunkWorker>) => {
    if (data.type === "failed") return fallBack(data.id, data.error);
    const w = waiting.get(data.id);
    if (!w) return;
    waiting.delete(data.id);
    const t0 = performance.now();
    const group = deserializeGroup(data.group);
    const now = performance.now();
    w.resolve({ group, rootX: data.rootX, rootY: data.rootY, mainMs: now - t0, totalMs: now - w.at });
  };
  worker.onerror = (e) => {
    // The worker didn't load (or died): everything from here on builds in place.
    e.preventDefault();
    broken = true;
    for (const id of [...waiting.keys()]) fallBack(id, e.message || "worker error");
  };
  return {
    build(job) {
      if (broken) return local.build(job);
      const id = nextId++;
      return new Promise((resolve, reject) => {
        waiting.set(id, { job, at: performance.now(), resolve, reject });
        worker.postMessage({ type: "build", id, job } satisfies ToChunkWorker);
      });
    },
    dispose() {
      worker.terminate();
      waiting.clear();
    },
  };
}
