// Fuzz test for the battery save, its earlier copies and resume points: saves from one or two
// tabs on one device (each its own module state over the same IndexedDB), NEW GAMEs over them,
// the erase question keeping the old save, resume points taken and picked, reloads, and the
// cloud going offline or signed out at any moment. However they interleave, no trainer's
// adventure is lost (it's the save, or in Earlier saves), and a resume point is only ever
// picked for the save it holds.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveData, saveSummary } from "@pokehd/emu";
import { SYMBOLS, type SymbolName } from "@pokehd/rom";
import { fuzzSeeds, fuzzSteps, rng } from "../../../../../packages/emu/src/fuzz.ts";
import { memoryBucket } from "../../worker/saves/memory-bucket.ts";
import { savesApi, type SaveBucket } from "../../worker/saves/saves.ts";

const KEY = "d7037c83e1ae5b39bde3c30787637ba1d4c48ce2";
const sramOffset = (name: SymbolName) => SYMBOLS[name].bank * 0x2000 + SYMBOLS[name].address - 0xa000;

/** A battery save the game would load: trainer `id`, `minutes` played, with a valid checksum. */
function gameSave(id: number, minutes: number): Uint8Array {
  const sram = new Uint8Array(32 * 1024);
  const main = sramOffset("sMainData");
  const at = (name: SymbolName) => main + SYMBOLS[name].address - SYMBOLS.wMainDataStart.address;
  sram.set([0x91, 0x84, 0x83, 0x50], sramOffset("sGameData")); // "RED"
  sram[at("wPlayerID")] = id >> 8;
  sram[at("wPlayerID") + 1] = id & 0xff;
  sram[at("wPlayTimeMinutes")] = minutes & 0xff;
  sram[at("wPlayTimeHours")] = minutes >> 8;
  // Picture scratch the game leaves behind: no part of the save.
  sram[0x100] = (minutes * 7) & 0xff;
  let sum = 0;
  for (let i = sramOffset("sGameData"); i < sramOffset("sGameDataEnd"); i++) sum = (sum + sram[i]!) & 0xff;
  sram[sramOffset("sMainDataCheckSum")] = ~sum & 0xff;
  return sram;
}
const trainerOf = (sram: Uint8Array) => saveSummary(sram)?.id;
const same = (a: Uint8Array, b: Uint8Array) => {
  const x = saveData(a);
  const y = saveData(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

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

/** A tab: the page's save modules loaded afresh (a reload), with its save slot open. */
async function openTab(fetch: typeof globalThis.fetch) {
  vi.resetModules();
  const [store, history, resume, cloud] = await Promise.all([
    import("./save-store.ts"),
    import("./history.ts"),
    import("./resume-store.ts"),
    import("./cloud-save.ts"),
  ]);
  const backup = new cloud.CloudBackup(KEY, { delayMs: 1, fetch });
  const slot = await store.openSaveSlot(KEY, backup, (sram, reason) => history.keepSave(KEY, sram, reason, fetch));
  return { store, history, resume, backup, slot };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  // Quiet the expected "couldn't copy to the cloud" warnings while offline.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("saves under random interleavings", () => {
  it.each(fuzzSeeds(8))("loses no adventure and pairs no point with the wrong save (seed %i)", async (seed) => {
    const r = rng(seed);
    const { fetch, net } = server();
    const tabCount = r.chance(0.5) ? 2 : 1;
    const tabs = [];
    for (let i = 0; i < tabCount; i++) tabs.push(await openTab(fetch));
    /** Each trainer's newest save handed to the page. */
    const newest = new Map<number, Uint8Array>();
    /** Each resume point taken, by its first bytes, and the save it held. */
    const truth = new Map<string, Uint8Array | undefined>();
    const inFlight: Promise<unknown>[] = [];
    let trainer = 1;
    let minutes = 1;
    let switches = 0;
    const steps = fuzzSteps(40);
    for (let step = 0; step < steps; step++) {
      const t = r.int(tabs.length);
      const tab = tabs[t]!;
      const op = r.int(8);
      const go = async (p: Promise<unknown>) => {
        const settled = p.catch(() => {});
        if (r.chance(0.5)) inFlight.push(settled);
        else await settled;
      };
      if (op <= 2) {
        // The game saves: the same trainer further on, or (now and then) a NEW GAME's first save.
        // Only one tab plays at a time in a household, so saves come in order.
        if (r.chance(0.15) && switches < 6) {
          switches++;
          trainer = 1 + ((trainer + r.int(2)) % 3);
          // The erase question keeps the old save first, as Game's onErasePrompt does.
          const old = await tab.store.loadSave(KEY);
          if (old) await tab.history.keepSave(KEY, old, "replaced", fetch);
        }
        const sram = gameSave(trainer, minutes++);
        newest.set(trainer, sram);
        await go(tab.slot.persist(sram));
      } else if (op === 3) {
        // A resume point: the state holds the save the page has (the worker flushes first).
        const save = tab.slot.latest;
        const state = Uint8Array.of(step, seed & 0xff, r.int(256));
        truth.set(state.join(","), save);
        await go(tab.resume.storeResumePoint(KEY, state, save));
      } else if (op === 4) {
        // Start-up: the point picked must hold the stored save.
        const stored = await tab.store.loadSave(KEY);
        const point = await tab.resume.pickResumePoint(stored ?? undefined, [await tab.resume.readResumePoint(KEY), await tab.resume.fetchCloudResumePoint(KEY, fetch)]);
        if (point) {
          const held = truth.get(point.state.join(","));
          expect(held && stored ? same(held, stored) : !held && !stored, `seed ${seed} step ${step} held ${!!held} stored ${!!stored} sha ${point.saveSha1}`).toBe(true);
        }
      } else if (op === 5) {
        const state = Uint8Array.of(step, 0xcc);
        const save = tab.slot.latest;
        if (save) {
          truth.set(state.join(","), save);
          await go(tab.resume.uploadResumePoint(KEY, state, save, false, fetch));
        }
      } else if (op === 6) {
        // Reload: what was on its way commits first, then fresh module state.
        await Promise.all(inFlight.splice(0));
        await tab.slot.enqueue(async () => {});
        tabs[t] = await openTab(fetch);
      } else {
        net.online = r.chance(0.7);
        net.signedIn = r.chance(0.8);
      }
    }
    await Promise.all(inFlight.splice(0));
    for (const tab of tabs) await tab.slot.enqueue(async () => {});
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Every trainer that ever saved is the save, or in this device's Earlier saves.
    net.online = false;
    const fresh = await openTab(fetch);
    const current = await fresh.store.loadSave(KEY);
    const kept = await fresh.history.listHistory(KEY, fetch);
    for (const id of newest.keys()) {
      const here = (current && trainerOf(current) === id) || kept.some((e) => e.summary?.id === id);
      expect(here, `seed ${seed}: trainer ${id} is lost`).toBe(true);
    }
    // In one tab the newest save made is the one stored. Two tabs on one save each store their
    // own game's saves in their own order (an older tab can still save over a newer one: there
    // is no lock between tabs), so only the check above holds there.
    if (tabCount === 1) expect(current && same(current, newest.get(trainer)!), `seed ${seed}`).toBe(true);
  }, 60_000);
});

describe("earlier saves from two tabs", () => {
  // Each keep reads the list and writes it back; the queue that makes them take turns is per
  // tab, so two tabs keeping at once dropped one of the two.
  it.each(fuzzSeeds(10))("keeps both when two tabs keep a save at once (seed %i)", async (seed) => {
    const r = rng(seed);
    const offline = (async () => {
      throw new TypeError("offline");
    }) as typeof globalThis.fetch;
    const a = await openTab(offline);
    const b = await openTab(offline);
    const saves = [gameSave(1, 1), gameSave(2, 2), gameSave(3, 3), gameSave(4, 4)];
    await Promise.all(saves.map((s, i) => (r.chance(0.5) ? a : b).history.keepSave(KEY, s, i % 2 ? "replaced" : "save", offline)));
    const kept = await a.history.listHistory(KEY, offline);
    expect(kept.map((e) => e.summary?.id).sort()).toEqual([1, 2, 3, 4]);
  });
});
