// Resume points: an emulator save state taken every minute and whenever the page is hidden, so
// closing the tab doesn't lose play since the last save. Kept next to the battery save. The
// emulator starts from one only while it holds exactly the stored save (see EmulatorHost's
// `resume`), so the save file always wins over a stale point; its SHA-1 is checked too, so a
// damaged copy is never loaded.
import { sha1Hex } from "@pokehd/rom";
import { run } from "../idb.ts";

interface StoredPoint {
  state: ArrayBuffer;
  sha1: string;
  /** Local time it was taken (ms), for display only. */
  takenAt: number;
}

const pointKey = (key: string) => `${key}:resume`;

/** The stored resume point, or null if there's none or it's damaged. */
export async function readResumePoint(key: string): Promise<Uint8Array | null> {
  const stored = await run<StoredPoint | undefined>("saves", "readonly", (s) => s.get(pointKey(key)));
  if (!stored) return null;
  const state = new Uint8Array(stored.state);
  return (await sha1Hex(state)) === stored.sha1 ? state : null;
}

export async function storeResumePoint(key: string, state: Uint8Array): Promise<void> {
  const point: StoredPoint = { state: state.slice().buffer, sha1: await sha1Hex(state), takenAt: Date.now() };
  await run("saves", "readwrite", (s) => s.put(point, pointKey(key)));
}

export const deleteResumePoint = (key: string) => run("saves", "readwrite", (s) => s.delete(pointKey(key)));

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
