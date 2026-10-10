// One device per save (D40): the messages between a device playing a save and the lock service
// (`POST /api/saves/:key/lock`, `/unlock`). A device beats every LOCK_BEAT_MS while it plays.
import * as v from "valibot";

/** How often a device playing a save renews its lease. The lease lapses after three missed. */
export const LOCK_BEAT_MS = 5_000;

const device = v.pipe(v.string(), v.regex(/^[0-9a-z]{8,32}$/));
const name = v.pipe(v.string(), v.maxLength(40));

export const LockBeatSchema = v.strictObject({
  device,
  name,
  /** Take the save over from the device that has it. */
  take: v.optional(v.boolean()),
});
export type LockBeat = v.InferOutput<typeof LockBeatSchema>;

export const LockReleaseSchema = v.strictObject({ device });

/** The other device: what it's called, and since when (server time). */
export interface LockHolder {
  name: string;
  since: number;
}

/**
 * - `held`: this device has the save; beat again within the lease.
 * - `in-use`: another device has it (`take` to ask for it).
 * - `waiting`: asked to take over; the other device is keeping its progress. Beat again.
 * - `lost`: another device is taking over this one's save: keep progress, then `/unlock`.
 */
export type LockAnswer =
  | { state: "held" }
  | { state: "in-use"; by: LockHolder }
  | { state: "waiting"; by: LockHolder }
  | { state: "lost"; to: LockHolder };

const HolderSchema = v.strictObject({ name, since: v.number() });
const LockAnswerSchema = v.variant("state", [
  v.strictObject({ state: v.literal("held") }),
  v.strictObject({ state: v.literal("in-use"), by: HolderSchema }),
  v.strictObject({ state: v.literal("waiting"), by: HolderSchema }),
  v.strictObject({ state: v.literal("lost"), to: HolderSchema }),
]);

export function parseLockAnswer(json: unknown): LockAnswer | null {
  const parsed = v.safeParse(LockAnswerSchema, json);
  return parsed.success ? parsed.output : null;
}

/** A heartbeat's body from JSON, or null if it isn't one. */
export function parseLockBeat(json: unknown): LockBeat | null {
  const parsed = v.safeParse(LockBeatSchema, json);
  return parsed.success ? parsed.output : null;
}

export function parseLockRelease(json: unknown): { device: string } | null {
  const parsed = v.safeParse(LockReleaseSchema, json);
  return parsed.success ? parsed.output : null;
}
