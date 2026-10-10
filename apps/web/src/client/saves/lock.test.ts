// Two devices' SaveLocks against the lock service's own logic, on fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { heartbeat, release, type Lease, type LockStore } from "../../worker/locks/locks.ts";
import { deviceId, deviceName, SaveLock, type LockState } from "./lock.ts";

const KEY = "d7037c83e1ae5b39bde3c30787637ba1d4c48ce2";

function service() {
  const leases = new Map<string, Lease>();
  const store: LockStore = { get: (k) => leases.get(k), put: (k, l) => void leases.set(k, l), delete: (k) => void leases.delete(k) };
  let online = true;
  const f = (async (url: string, init?: RequestInit) => {
    if (!online) throw new TypeError("offline");
    const body = JSON.parse(String(init?.body));
    const key = url.split("/")[3]!;
    if (url.endsWith("/unlock")) {
      release(store, key, body.device, Date.now());
      return new Response(null, { status: 204 });
    }
    return Response.json(heartbeat(store, key, body, Date.now()));
  }) as typeof fetch;
  return { f, leases, setOnline: (on: boolean) => (online = on) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("SaveLock", () => {
  it("plays here when nobody else is, and when the service can't be reached", async () => {
    const { f, setOnline } = service();
    expect(await new SaveLock(KEY, { fetch: f, device: "phone0001", name: "iPhone" }).claim(() => {}).done).toEqual({ state: "held" });
    setOnline(false);
    expect(await new SaveLock(KEY, { fetch: f, device: "mac000001", name: "Mac" }).claim(() => {}).done).toEqual({ state: "free" });
  });

  it("hands a save over: the holder hears, keeps its progress, lets go; the taker plays", async () => {
    const { f } = service();
    const phone = new SaveLock(KEY, { fetch: f, device: "phone0001", name: "iPhone" });
    await phone.claim(() => {}).done;
    const lost: LockState[] = [];
    phone.keep((s) => {
      lost.push(s);
      void phone.release(); // after keeping its progress
    });

    const mac = new SaveLock(KEY, { fetch: f, device: "mac000001", name: "Mac" });
    const blocked: LockState[] = [];
    const claim = mac.claim((s) => blocked.push(s));
    await vi.advanceTimersByTimeAsync(0);
    expect(blocked).toEqual([{ state: "in-use", by: { name: "iPhone", since: expect.any(Number) } }]);
    claim.take();
    await vi.advanceTimersByTimeAsync(6000);
    expect(lost).toEqual([{ state: "lost", to: { name: "Mac", since: expect.any(Number) } }]);
    expect(await claim.done).toEqual({ state: "held" });
  });

  it("starts once the other device lets go, with no takeover", async () => {
    const { f } = service();
    const phone = new SaveLock(KEY, { fetch: f, device: "phone0001", name: "iPhone" });
    await phone.claim(() => {}).done;
    const mac = new SaveLock(KEY, { fetch: f, device: "mac000001", name: "Mac" });
    let done = false;
    const claim = mac.claim(() => {});
    void claim.done.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(6000);
    expect(done).toBe(false);
    await phone.release();
    await vi.advanceTimersByTimeAsync(6000);
    expect(done).toBe(true);
  });

  it("stops a device that went quiet and came back to find its save taken", async () => {
    const { f, setOnline } = service();
    const phone = new SaveLock(KEY, { fetch: f, device: "phone0001", name: "iPhone" });
    await phone.claim(() => {}).done;
    const lost: LockState[] = [];
    phone.keep((s) => lost.push(s));
    // Asleep in a pocket: its beats don't arrive, and it keeps playing meanwhile.
    setOnline(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(lost).toEqual([]);
    setOnline(true);
    const mac = new SaveLock(KEY, { fetch: f, device: "mac000001", name: "Mac" });
    // The Mac sees it busy until the phone's lease lapses, then plays.
    expect(await mac.claim(() => {}).done).toEqual({ state: "held" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(lost).toEqual([{ state: "in-use", by: { name: "Mac", since: expect.any(Number) } }]);
  });

  it("keeps a tab's ID across reloads, and names devices plainly", () => {
    const store = new Map<string, string>();
    const session = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(deviceId(session)).toBe(deviceId(session));
    expect(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5)).toBe("iPhone");
    expect(deviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe("iPad");
    expect(deviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe("Mac");
  });
});
