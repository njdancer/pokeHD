// Fuzz test for the cloud backup on one device: saves land while the network comes and goes and
// the player signs out and in, with reloads in between. Whatever happened, once the page is
// back online and signed in, its start-up check leaves the cloud holding this device's save,
// so a phone whose storage is cleared gets back the newest play, not an older one.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fuzzSeeds, fuzzSteps, rng } from "../../../../../packages/emu/src/fuzz.ts";
import { memoryBucket } from "../../worker/saves/memory-bucket.ts";
import { saveKey, savesApi, type SaveBucket } from "../../worker/saves/saves.ts";
import { closeDb } from "../idb.ts";
import { CloudBackup } from "./cloud-save.ts";
import { loadSave, openSaveSlot } from "./save-store.ts";

const KEY = "d7037c83e1ae5b39bde3c30787637ba1d4c48ce2";
const sram = (seed: number) => Uint8Array.from({ length: 32768 }, (_, i) => (i * 31 + seed) & 0xff);

function server() {
  const { bucket: SAVES, objects } = memoryBucket();
  const net = { online: true, signedIn: true };
  const api = savesApi<{ SAVES: SaveBucket }>(async () => (net.signedIn ? { id: "sam" } : null));
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!net.online) throw new TypeError("Failed to fetch");
    return api.request(String(input).replace("/api/saves", ""), init, { SAVES });
  }) as typeof globalThis.fetch;
  return { fetch, net, objects };
}

beforeEach(() => {
  closeDb();
  globalThis.indexedDB = new IDBFactory();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("cloud backup under a flaky network", () => {
  it.each(fuzzSeeds(10))("ends with the cloud holding this device's save (seed %i)", async (seed) => {
    const r = rng(seed);
    const { fetch, net, objects } = server();
    const open = async () => {
      const backup = new CloudBackup(KEY, { fetch, delayMs: 0 });
      return { backup, slot: await openSaveSlot(KEY, backup, null) };
    };
    let page = await open();
    let n = 1;
    for (let step = 0; step < fuzzSteps(30); step++) {
      const op = r.int(6);
      if (op <= 1) await page.slot.persist(sram(n++));
      else if (op === 2) await page.backup.flush();
      else if (op === 3) await page.backup.status();
      else if (op === 4) {
        // Reload: the page goes away (pagehide flushes) and comes back with fresh state.
        await page.backup.flush(true);
        closeDb();
        page = await open();
        // Game's start-up check.
        await page.backup.status();
      } else {
        net.online = r.chance(0.6);
        net.signedIn = r.chance(0.8);
      }
    }
    // Back online and signed in, the next start-up checks with the cloud.
    net.online = true;
    net.signedIn = true;
    closeDb();
    page = await open();
    await page.backup.status();
    await page.backup.flush();
    const local = await loadSave(KEY);
    const cloud = objects.get(saveKey("sam", KEY));
    if (!local) return;
    expect(cloud && new Uint8Array(cloud.body), `seed ${seed}`).toEqual(local);
  }, 30_000);
});
