import { describe, expect, it } from "vitest";
import { locksApi, type PlayerLocks } from "./api.ts";
import { HANDOVER_MS, heartbeat, LEASE_MS, release, type Lease, type LockStore } from "./locks.ts";

const KEY = "d7037c83e1ae5b39bde3c30787637ba1d4c48ce2";
const phone = { device: "phone0001", name: "iPhone" };
const mac = { device: "mac000001", name: "Mac" };

function memoryStore(): LockStore & { leases: Map<string, Lease> } {
  const leases = new Map<string, Lease>();
  return { leases, get: (k) => leases.get(k), put: (k, l) => void leases.set(k, l), delete: (k) => void leases.delete(k) };
}

describe("save locks", () => {
  it("lets one device hold a save and tells another it's in use", () => {
    const store = memoryStore();
    expect(heartbeat(store, KEY, phone, 0)).toEqual({ state: "held" });
    expect(heartbeat(store, KEY, mac, 1000)).toEqual({ state: "in-use", by: { name: "iPhone", since: 0 } });
    // Renewed by its heartbeat, it stays the phone's.
    expect(heartbeat(store, KEY, phone, 10_000)).toEqual({ state: "held" });
    expect(heartbeat(store, KEY, mac, 20_000)).toMatchObject({ state: "in-use" });
  });

  it("frees a save whose device went quiet", () => {
    const store = memoryStore();
    heartbeat(store, KEY, phone, 0);
    expect(heartbeat(store, KEY, mac, LEASE_MS - 1)).toMatchObject({ state: "in-use" });
    expect(heartbeat(store, KEY, mac, LEASE_MS)).toEqual({ state: "held" });
    // The phone wakes up: it's the Mac's now, and the phone must stop.
    expect(heartbeat(store, KEY, phone, LEASE_MS + 1)).toMatchObject({ state: "in-use", by: { name: "Mac" } });
  });

  it("keeps saves apart", () => {
    const store = memoryStore();
    heartbeat(store, KEY, phone, 0);
    expect(heartbeat(store, `${KEY}-abcd1234`, mac, 0)).toEqual({ state: "held" });
  });

  it("hands a save over once the holder has kept its progress", () => {
    const store = memoryStore();
    heartbeat(store, KEY, phone, 0);
    expect(heartbeat(store, KEY, { ...mac, take: true }, 1000)).toEqual({ state: "waiting", by: { name: "iPhone", since: 0 } });
    // The phone hears on its next beat, and keeps its lease while it saves.
    expect(heartbeat(store, KEY, phone, 4000)).toEqual({ state: "lost", to: { name: "Mac", since: 1000 } });
    expect(heartbeat(store, KEY, mac, 5000)).toMatchObject({ state: "waiting" });
    release(store, KEY, phone.device, 6000);
    expect(heartbeat(store, KEY, mac, 6000)).toEqual({ state: "held" });
    expect(heartbeat(store, KEY, phone, 7000)).toMatchObject({ state: "in-use", by: { name: "Mac" } });
  });

  it("takes a save anyway when the holder heard but doesn't let go", () => {
    const store = memoryStore();
    heartbeat(store, KEY, phone, 0);
    heartbeat(store, KEY, { ...mac, take: true }, 1000);
    for (let t = 2000; t < 1000 + HANDOVER_MS; t += 2000) {
      expect(heartbeat(store, KEY, phone, t)).toMatchObject({ state: "lost" });
      expect(heartbeat(store, KEY, mac, t)).toMatchObject({ state: "waiting" });
    }
    expect(heartbeat(store, KEY, mac, 1000 + HANDOVER_MS)).toEqual({ state: "held" });
  });

  it("waits out the lease of a holder that hasn't heard it's being taken over", () => {
    const store = memoryStore();
    heartbeat(store, KEY, phone, 0);
    heartbeat(store, KEY, { ...mac, take: true }, 1000);
    // The phone is still playing, as far as anyone knows, until its lease lapses.
    expect(heartbeat(store, KEY, mac, 1000 + HANDOVER_MS)).toMatchObject({ state: "waiting" });
    expect(heartbeat(store, KEY, mac, LEASE_MS)).toEqual({ state: "held" });
  });

  it("lets go of a save closed on its device, and ignores others' let-gos", () => {
    const store = memoryStore();
    heartbeat(store, KEY, phone, 0);
    release(store, KEY, mac.device, 100);
    expect(heartbeat(store, KEY, mac, 200)).toMatchObject({ state: "in-use" });
    release(store, KEY, phone.device, 300);
    expect(heartbeat(store, KEY, mac, 400)).toEqual({ state: "held" });
  });

  it("never lets two devices play a save at once, whatever they do (fuzz)", () => {
    for (let seed = 1; seed <= 200; seed++) {
      let a = seed;
      const rand = () => ((a = (a * 1103515245 + 12345) >>> 0) / 2 ** 32);
      const store = memoryStore();
      const devices = ["dev0000a", "dev0000b", "dev0000c"].map((device) => ({ device, name: device, playingUntil: -1 }));
      let now = 0;
      for (let step = 0; step < 300; step++) {
        now += Math.floor(rand() * 4000);
        const d = devices[Math.floor(rand() * devices.length)]!;
        const roll = rand();
        if (roll < 0.1) {
          release(store, KEY, d.device, now);
          d.playingUntil = -1;
          continue;
        }
        const answer = heartbeat(store, KEY, { device: d.device, name: d.name, take: roll < 0.3 }, now);
        // A device plays while it holds the save, and for one lease after its last "held" at
        // most: with no answer since, it stops when its lease would have lapsed.
        d.playingUntil = answer.state === "held" ? now + LEASE_MS : -1;
        const playing = devices.filter((x) => x.playingUntil > now);
        expect(playing.length, `seed ${seed} step ${step}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("lock routes", () => {
  const setup = () => {
    const stores = new Map<string, ReturnType<typeof memoryStore>>();
    const locksOf = (_: unknown, player: string): PlayerLocks => {
      const store = stores.get(player) ?? memoryStore();
      stores.set(player, store);
      return { beat: (key, beat) => heartbeat(store, key, beat, Date.now()), release: (key, device) => release(store, key, device, Date.now()) };
    };
    const api = locksApi<object>(async (c) => (c.req.header("x-player") ? { id: c.req.header("x-player")! } : null), locksOf);
    const post = (path: string, body: unknown, player?: string) =>
      api.request(path, { method: "POST", body: JSON.stringify(body), headers: player ? { "x-player": player } : {} });
    return { post };
  };

  it("needs a signed-in player and a save key", async () => {
    const { post } = setup();
    expect((await post(`/${KEY}/lock`, phone)).status).toBe(401);
    expect((await post(`/not-a-key/lock`, phone, "sam")).status).toBe(400);
    expect((await post(`/${KEY}/lock`, { device: "x" }, "sam")).status).toBe(400);
  });

  it("holds per player: friends playing their own copies don't block each other", async () => {
    const { post } = setup();
    expect(await (await post(`/${KEY}/lock`, phone, "sam")).json()).toEqual({ state: "held" });
    expect(await (await post(`/${KEY}/lock`, mac, "alex")).json()).toEqual({ state: "held" });
    expect(await (await post(`/${KEY}/lock`, mac, "sam")).json()).toMatchObject({ state: "in-use" });
    // A closing page's beacon lets go.
    expect((await post(`/${KEY}/unlock`, { device: phone.device }, "sam")).status).toBe(204);
    expect(await (await post(`/${KEY}/lock`, mac, "sam")).json()).toEqual({ state: "held" });
  });
});
