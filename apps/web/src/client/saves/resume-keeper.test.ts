import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../idb.ts";
import { ResumeKeeper } from "./resume-keeper.ts";
import { gameLeaving, gameLeft, pickResumePoint, readResumePoint } from "./resume-store.ts";
import { loadSave, openSaveSlot } from "./save-store.ts";

const KEY = "rom-sha1";
/** A full-size battery RAM image; `seed` makes it a different save. */
const sram = (seed: number) => Uint8Array.from({ length: 32768 }, (_, i) => (i * 13 + seed) & 0xff);
const state = (n: number) => Uint8Array.from({ length: 4096 }, (_, i) => (i + n) & 0xff);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  closeDb();
  globalThis.indexedDB = new IDBFactory();
});

describe("resume keeper", () => {
  it("stores each point it takes, paired with the save the emulator handed over before it", async () => {
    const slot = await openSaveSlot(KEY, null, null);
    const keeper = new ResumeKeeper({ key: KEY, take: async () => state(1), save: () => slot.latest, enqueue: slot.enqueue });
    // The worker hands over a newer save before the point (a save it made since the last one).
    void slot.persist(sram(1));
    const point = await keeper.take();
    expect(point?.state).toEqual(state(1));

    // What a reload finds: the save and the point that holds it, so it resumes from the point.
    const save = (await loadSave(KEY)) ?? undefined;
    expect(save).toEqual(sram(1));
    const stored = await readResumePoint(KEY);
    expect(stored?.state).toEqual(state(1));
    expect((await pickResumePoint(save, [stored]))?.state).toEqual(state(1));
  });

  it("never stores an older point over a newer one, however the answers come back", async () => {
    const slot = await openSaveSlot(KEY, null, null);
    const answers = [deferred<Uint8Array | null>(), deferred<Uint8Array | null>(), deferred<Uint8Array | null>()];
    let asked = 0;
    const keeper = new ResumeKeeper({ key: KEY, take: () => answers[asked++]!.promise, save: () => slot.latest, enqueue: slot.enqueue });
    const first = keeper.take();
    const second = keeper.take();
    const third = keeper.take();
    // One at a time: the second is asked for only once the first is stored.
    await Promise.resolve();
    expect(asked).toBe(1);
    answers[0]!.resolve(state(1));
    await first;
    expect((await readResumePoint(KEY))?.state).toEqual(state(1));
    answers[1]!.resolve(null); // not a moment for one: the stored point stays
    expect(await second).toBeNull();
    answers[2]!.resolve(state(3));
    await third;
    expect((await readResumePoint(KEY))?.state).toEqual(state(3));
    expect(keeper.latest?.state).toEqual(state(3));
  });

  it("writes a point only after the save queued before it", async () => {
    const order: string[] = [];
    let queue: Promise<unknown> = Promise.resolve();
    const enqueue = <T,>(op: () => Promise<T>) => {
      const next = queue.then(op);
      queue = next.catch(() => {});
      return next;
    };
    const saveWritten = deferred<void>();
    void enqueue(async () => {
      await saveWritten.promise;
      order.push("save");
    });
    const keeper = new ResumeKeeper({
      key: KEY,
      take: async () => state(1),
      save: () => sram(1),
      enqueue,
      write: async () => void order.push("point"),
    });
    const taking = keeper.take();
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([]);
    saveWritten.resolve();
    await taking;
    expect(order).toEqual(["save", "point"]);
  });

  it("sends each point to the cloud once, and stops once signed out", async () => {
    const sent: boolean[] = [];
    let signedIn = true;
    let n = 0;
    const keeper = new ResumeKeeper({
      key: KEY,
      take: async () => state(++n),
      save: () => sram(1),
      enqueue: (op) => op(),
      write: async () => {},
      upload: async (_state, _save, keepalive) => {
        sent.push(keepalive);
        return signedIn;
      },
    });
    await keeper.upload();
    expect(sent).toEqual([]); // nothing taken yet
    await keeper.take();
    await keeper.upload(true);
    await keeper.upload();
    expect(sent).toEqual([true]);
    signedIn = false;
    await keeper.take();
    await keeper.upload();
    await keeper.take();
    await keeper.upload();
    expect(sent).toEqual([true, false]);
  });

  it("starts a remounted game only once the one before it has stored its last point", async () => {
    await gameLeft(KEY); // nothing going
    const last = deferred<void>();
    gameLeaving(KEY, last.promise);
    let started = false;
    const starting = gameLeft(KEY).then(() => (started = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(started).toBe(false);
    last.resolve();
    await starting;
    expect(started).toBe(true);
    // Another key never waits.
    await gameLeft("other");
  });
});
