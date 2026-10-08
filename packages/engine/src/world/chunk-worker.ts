/// <reference lib="webworker" />
import type { WorldData } from "@pokehd/rom";
import { buildChunk, serializeGroup } from "./chunk.ts";
import type { FromChunkWorker, ToChunkWorker } from "./chunk-builder.ts";

// Builds live-world chunks off the main thread (see ./chunk.ts).

let world: WorldData | null = null;
const post = (message: FromChunkWorker, transfer: Transferable[] = []) => self.postMessage(message, transfer);

self.onmessage = ({ data }: MessageEvent<ToChunkWorker>) => {
  if (data.type === "world") {
    world = data.world;
    return;
  }
  const t0 = performance.now();
  try {
    const built = buildChunk(world!, data.job);
    const { data: group, transfer } = serializeGroup(built.group);
    post({ type: "built", id: data.id, group, rootX: built.rootX, rootY: built.rootY, ms: performance.now() - t0 }, transfer);
  } catch (e) {
    post({ type: "failed", id: data.id, error: String(e) });
  }
};
