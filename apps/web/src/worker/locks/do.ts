import { DurableObject } from "cloudflare:workers";
import type { LockAnswer, LockBeat } from "@pokehd/protocol";
import { heartbeat, release, type Lease, type LockStore } from "./locks.ts";

/**
 * One player's save leases (D40), one object per player: a Durable Object runs one request at a
 * time, so two devices' heartbeats for a save can't both be granted it. Leases live in its
 * SQLite-backed storage and outlast the object being evicted.
 */
export class SaveLocks extends DurableObject<Env> {
  readonly #store: LockStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const kv = ctx.storage.kv;
    this.#store = {
      get: (key) => kv.get<Lease>(`lease:${key}`),
      put: (key, lease) => kv.put(`lease:${key}`, lease),
      delete: (key) => void kv.delete(`lease:${key}`),
    };
  }

  beat(key: string, beat: LockBeat): LockAnswer {
    return heartbeat(this.#store, key, beat, Date.now());
  }

  release(key: string, device: string): void {
    release(this.#store, key, device, Date.now());
  }
}
