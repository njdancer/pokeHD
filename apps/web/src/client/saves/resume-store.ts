// Resume points: an emulator save state taken every couple of seconds of play (resume-keeper.ts),
// so closing the tab or reloading doesn't lose play since the last save. Kept next to the battery save. The
// emulator starts from one only while it holds exactly the stored save (see EmulatorHost's
// `resume`), so the save file always wins over a stale point; its SHA-1 is checked too, so a
// damaged copy is never loaded.
//
// Signed-in players' points also go to the cloud (p1-kidproof), gzipped, with the SHA-1 of the
// save they hold: a phone whose storage was cleared, or another device on the same save, picks
// up from the exact spot.
import { saveData } from "@pokehd/emu";
import { sha1Hex } from "@pokehd/rom";
import { run } from "../idb.ts";

/** A save's identity for matching points: picture scratch space doesn't count (see `saveData`). */
const saveHash = (save: Uint8Array) => sha1Hex(saveData(save));
/**
 * What a point taken with no save stored records as its save, so it's never picked for one
 * made since (a new game's first save): left out, it would pass as a point from before points
 * recorded their save.
 */
const NO_SAVE = "none";

interface StoredPoint {
  state: ArrayBuffer;
  sha1: string;
  /** Local time it was taken (ms), for display only. */
  takenAt: number;
  /**
   * SHA-1 of the battery save the state holds, picture scratch blanked, or NO_SAVE (missing on
   * points from before p1-kidproof).
   */
  saveSha1?: string;
}

/** A resume point and the save it belongs with. */
export interface ResumePoint {
  state: Uint8Array;
  /** SHA-1 of the battery save it holds, when known. */
  saveSha1?: string;
  takenAt: number;
}

const pointKey = (key: string) => `${key}:resume`;

/** The stored resume point, or null if there's none or it's damaged. */
export async function readResumePoint(key: string): Promise<ResumePoint | null> {
  const stored = await run<StoredPoint | undefined>("saves", "readonly", (s) => s.get(pointKey(key)));
  if (!stored) return null;
  const state = new Uint8Array(stored.state);
  if ((await sha1Hex(state)) !== stored.sha1) return null;
  return { state, takenAt: stored.takenAt, ...(stored.saveSha1 ? { saveSha1: stored.saveSha1 } : {}) };
}

/** A point hashed and paired with its save, ready to store with no more waiting. */
export interface PreparedPoint {
  state: Uint8Array;
  sha1: string;
  /** The battery save the state holds (the page's newest when it was taken), if any. */
  save: Uint8Array | undefined;
  /** Its SHA-1, picture scratch blanked, or NO_SAVE. */
  saveSha1: string;
  /** When the emulator was asked for it (ms). */
  takenAt: number;
}

/** Hashes a point taken at `takenAt` while `save` was the newest battery save. */
export async function prepareResumePoint(state: Uint8Array, save: Uint8Array | undefined, takenAt = Date.now()): Promise<PreparedPoint> {
  const [sha1, saveSha1] = await Promise.all([sha1Hex(state), save ? saveHash(save) : NO_SAVE]);
  return { state, sha1, save, saveSha1, takenAt };
}

/** Stores a prepared point in place of the one there. */
export async function writeResumePoint(key: string, point: PreparedPoint): Promise<void> {
  const stored: StoredPoint = { state: point.state.slice().buffer, sha1: point.sha1, takenAt: point.takenAt, saveSha1: point.saveSha1 };
  await run("saves", "readwrite", (s) => s.put(stored, pointKey(key)));
}

/** Stores a point taken while `save` was the stored battery save. Returns its state's SHA-1. */
export async function storeResumePoint(key: string, state: Uint8Array, save?: Uint8Array): Promise<string> {
  const point = await prepareResumePoint(state, save);
  await writeResumePoint(key, point);
  return point.sha1;
}

type Fetch = typeof fetch;

async function gzip(bytes: Uint8Array): Promise<ArrayBuffer> {
  return new Response(new Blob([bytes.slice().buffer]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
}
async function gunzip(bytes: ArrayBuffer): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
}

/**
 * Sends a point to the cloud. `keepalive` lets it finish while the page goes away (bodies up to
 * 64 KB; a gzipped point is a few KB). False if signed out.
 */
export async function uploadResumePoint(key: string, state: Uint8Array, save: Uint8Array, keepalive = false, f: Fetch = fetch): Promise<boolean> {
  const [body, stateSha1, saveSha1] = await Promise.all([gzip(state), sha1Hex(state), saveHash(save)]);
  const res = await f(`/api/saves/${key}/resume`, {
    method: "PUT",
    body,
    keepalive: keepalive && body.byteLength < 60_000,
    headers: { "content-type": "application/gzip", "x-save-sha1": saveSha1, "x-state-sha1": stateSha1 },
  });
  if (res.status === 401) return false;
  if (!res.ok) throw new Error(`PUT resume: ${res.status}`);
  return true;
}

/** The cloud's point, or null if there's none, it's damaged, or the player is signed out or offline. */
export async function fetchCloudResumePoint(key: string, f: Fetch = fetch): Promise<ResumePoint | null> {
  try {
    const res = await f(`/api/saves/${key}/resume`, { cache: "no-store" });
    if (!res.ok) return null;
    const state = await gunzip(await res.arrayBuffer());
    if ((await sha1Hex(state)) !== res.headers.get("x-state-sha1")) return null;
    return { state, saveSha1: res.headers.get("x-save-sha1") ?? "", takenAt: Number(res.headers.get("x-saved-at")) };
  } catch {
    return null;
  }
}

/**
 * Which point to resume from: the newest that holds this exact save. A local point from before
 * points recorded their save is still tried (the emulator checks it anyway).
 */
export async function pickResumePoint(save: Uint8Array | undefined, points: (ResumePoint | null)[]): Promise<ResumePoint | null> {
  const saveSha1 = save ? await saveHash(save) : NO_SAVE;
  const fits = points.filter((p): p is ResumePoint => !!p && (p.saveSha1 === undefined || p.saveSha1 === saveSha1));
  return fits.sort((a, b) => b.takenAt - a.takenAt)[0] ?? null;
}

export const deleteResumePoint = (key: string) => run("saves", "readwrite", (s) => s.delete(pointKey(key)));

/**
 * Games being put away, by key: the last point a game takes as it goes (`finish` in Game) is
 * stored a moment after its page component unmounts. A game starting on the same key (a
 * remount: hot reload, another boot) waits for it, so it resumes from that point rather than the
 * one before, and the late write can't land over the new game's own points afterwards.
 */
const leaving = new Map<string, Promise<unknown>>();

/** Records that the game on `key` is going; `done` settles once its last point is stored. */
export function gameLeaving(key: string, done: Promise<unknown>): void {
  const settled = done.then(
    () => {},
    () => {},
  );
  leaving.set(key, settled);
  void settled.then(() => leaving.get(key) === settled && leaving.delete(key));
}

/** Settles once any game going on `key` has stored its last point. */
export const gameLeft = (key: string): Promise<unknown> => leaving.get(key) ?? Promise.resolve();

const AUTOSAVE_KEY = "pokehd.autosave.v1";

/** The player's autosave choice (on unless they turned it off). */
export function loadAutosave(): boolean {
  try {
    return localStorage.getItem(AUTOSAVE_KEY) !== "off";
  } catch {
    return true;
  }
}
export function saveAutosave(on: boolean) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, on ? "on" : "off");
  } catch {
    // Storage blocked (some private windows): the choice lasts until reload.
  }
}
