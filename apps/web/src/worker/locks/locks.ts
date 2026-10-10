// One device per save (D41): a save is played on one tab or device at a time. The device
// playing it holds a lease that its heartbeat renews; a device that goes quiet (closed, asleep,
// offline) loses it after LEASE_MS. Another device may take a save over: the holder is told on
// its next heartbeat, keeps its progress, and lets go, or the save passes on after HANDOVER_MS
// anyway. Plain logic over a `LockStore` so tests can drive it with a fake clock; ./do.ts keeps
// it in a Durable Object, one per player, so each player's leases change one at a time.
import type { LockAnswer, LockHolder } from "@pokehd/protocol";

/** How long a lease lasts without a heartbeat. Devices beat every LOCK_BEAT_MS (protocol). */
export const LEASE_MS = 15_000;
/** How long a takeover waits for the holder to keep its progress and let go. */
export const HANDOVER_MS = 10_000;

export interface Lease {
  device: string;
  name: string;
  /** When this device started holding it. */
  since: number;
  /** When it lapses unless renewed. */
  until: number;
  /**
   * A device that asked to take the save over, and when; `told` once the holder has heard. Until
   * then the holder may still be playing, so the save can't pass on before its lease lapses.
   */
  handover?: { device: string; name: string; at: number; told?: boolean };
}

export interface LockStore {
  get(key: string): Lease | undefined;
  put(key: string, lease: Lease): void;
  delete(key: string): void;
}

export interface Beat {
  device: string;
  /** What the other device sees it called ("iPhone", "Mac"). */
  name: string;
  /** Take the save over from whoever has it. */
  take?: boolean;
}

const holder = (l: { name: string }, since: number): LockHolder => ({ name: l.name, since });

/** A heartbeat (or first claim) from `beat.device` for save `key`. */
export function heartbeat(store: LockStore, key: string, beat: Beat, now: number): LockAnswer {
  const lease = store.get(key);
  const grant = (): LockAnswer => {
    store.put(key, { device: beat.device, name: beat.name, since: now, until: now + LEASE_MS });
    return { state: "held" };
  };
  // Nobody has it, or whoever had it went quiet.
  if (!lease || lease.until <= now) return grant();
  if (lease.device === beat.device) {
    // Another device is taking over: keep your progress, then let go. The lease stays meanwhile.
    if (lease.handover) {
      store.put(key, { ...lease, until: now + LEASE_MS, handover: { ...lease.handover, told: true } });
      return { state: "lost", to: holder(lease.handover, lease.handover.at) };
    }
    store.put(key, { ...lease, name: beat.name, until: now + LEASE_MS });
    return { state: "held" };
  }
  // Someone else has it.
  const asked = lease.handover?.device === beat.device ? lease.handover : undefined;
  // The holder heard, has stopped playing, and never let go (it may have closed meanwhile).
  if (asked?.told && now - asked.at >= HANDOVER_MS) return grant();
  if (beat.take && !asked) {
    store.put(key, { ...lease, handover: { device: beat.device, name: beat.name, at: now } });
    return { state: "waiting", by: holder(lease, lease.since) };
  }
  if (asked) return { state: "waiting", by: holder(lease, lease.since) };
  return { state: "in-use", by: holder(lease, lease.since) };
}

/**
 * `device` is done with save `key` (closed it, or kept its progress after a takeover). The
 * device taking over, if any, has it now.
 */
export function release(store: LockStore, key: string, device: string, now: number): void {
  const lease = store.get(key);
  if (!lease || lease.device !== device) return;
  const next = lease.handover;
  if (next) store.put(key, { device: next.device, name: next.name, since: now, until: now + LEASE_MS });
  else store.delete(key);
}
