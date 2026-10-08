// Tests only: an in-memory SaveBucket whose clock moves forward one second per write.
import type { SaveBucket } from "./saves.ts";

export function memoryBucket() {
  const objects = new Map<string, { body: ArrayBuffer; uploaded: Date; customMetadata?: Record<string, string> }>();
  let now = 1_700_000_000_000;
  const bucket: SaveBucket = {
    async get(key) {
      const o = objects.get(key);
      return o ? { ...o, arrayBuffer: async () => o.body.slice(0) } : null;
    },
    async put(key, value, options) {
      const o = { body: value.slice(0), uploaded: new Date((now += 1000)), ...options };
      objects.set(key, o);
      return { uploaded: o.uploaded };
    },
    async list({ prefix }) {
      return { objects: [...objects].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, uploaded: o.uploaded })) };
    },
    async delete(keys) {
      for (const k of keys) objects.delete(k);
    },
  };
  return { bucket, objects };
}
