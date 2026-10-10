// Fuzz test for the save slot list: random makes, copies, renames, bins and plays, from several
// tabs on one device (each its own module state over the same IndexedDB), reloads in between,
// and the cloud going offline or signed out at any moment. However they interleave, no slot is
// ever lost from the list.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fuzzSeeds, fuzzSteps, rng } from "../../../../../packages/emu/src/fuzz.ts";
import { memoryBucket } from "../../worker/saves/memory-bucket.ts";
import { savesApi, type SaveBucket } from "../../worker/saves/saves.ts";

const ROM = "d7037c83e1ae5b39bde3c30787637ba1d4c48ce2";

type Slots = typeof import("./slots.ts");
type Store = typeof import("./save-store.ts");

/** The real saves route over an in-memory bucket, which can go offline or sign the player out. */
function server() {
  const { bucket: SAVES } = memoryBucket();
  const net = { online: true, signedIn: true };
  const api = savesApi<{ SAVES: SaveBucket }>(async () => (net.signedIn ? { id: "sam" } : null));
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!net.online) throw new TypeError("Failed to fetch");
    return api.request(String(input).replace("/api/saves", ""), init, { SAVES });
  }) as typeof globalThis.fetch;
  return { fetch, net };
}

/** A tab: the page's modules loaded afresh (a reload), over the device's IndexedDB. */
async function openTab(): Promise<{ slots: Slots; store: Store }> {
  vi.resetModules();
  const [slots, store] = await Promise.all([import("./slots.ts"), import("./save-store.ts")]);
  return { slots, store };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
afterEach(() => vi.restoreAllMocks());

describe("save slots under random interleavings", () => {
  it.each(fuzzSeeds(6))("never loses a slot (seed %i)", async (seed) => {
    const r = rng(seed);
    const { fetch, net } = server();
    const tabs = [await openTab(), await openTab()];
    await tabs[0]!.store.storeSave(ROM, Uint8Array.of(1, 2, 3));
    /** Every slot made, and the main one, which holds a save. */
    const made = new Set<string>(["main"]);
    const inFlight: Promise<unknown>[] = [];
    const steps = fuzzSteps(40);
    for (let step = 0; step < steps; step++) {
      const t = r.int(tabs.length);
      const { slots } = tabs[t]!;
      const ids = [...made];
      const id = r.pick(ids);
      const op = r.int(9);
      const go = (p: Promise<unknown>) => {
        // Some calls are awaited, others overlap with the next ones (taps in quick succession).
        const settled = p.catch(() => {});
        if (r.chance(0.5)) inFlight.push(settled);
        else return settled;
      };
      if (op === 0) await go(slots.createSlot(ROM, r.chance(0.5) ? "New" : undefined, fetch).then((m) => made.add(m.id)));
      else if (op === 1) await go(slots.duplicateSlot(ROM, id, "Copy", fetch).then((m) => made.add(m.id)));
      else if (op === 2) await go(slots.renameSlot(ROM, id, r.pick(["", "Ash", "  Red run  "]), fetch));
      else if (op === 3) await go(slots.binSlot(ROM, id, fetch));
      else if (op === 4) await go(slots.unbinSlot(ROM, id, fetch));
      else if (op === 5) await go(slots.markPlayed(ROM, id, fetch));
      else if (op === 6) await go(slots.loadSlots(ROM, fetch));
      else if (op === 7) {
        // Reload: what was on its way finishes first (the browser commits it), then fresh state.
        await Promise.all(inFlight.splice(0));
        tabs[t] = await openTab();
      } else {
        net.online = r.chance(0.7);
        net.signedIn = r.chance(0.8);
      }
    }
    await Promise.all(inFlight.splice(0));
    // On this device, without the cloud, every slot made here is listed.
    const offline = await tabs[0]!.slots.loadSlots(ROM, (async () => {
      throw new TypeError("offline");
    }) as typeof globalThis.fetch);
    expect(offline.slots.map((s) => s.id).sort(), `seed ${seed}`).toEqual([...made].sort());
  }, 60_000);
});
