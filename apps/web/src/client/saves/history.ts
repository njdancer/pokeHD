// Earlier saves (p1-kidproof): so a lost adventure can always come back. The page keeps a copy
// of the battery save every so often while playing, and always before anything replaces it
// with a different trainer's save (NEW GAME), an imported .sav, a cloud restore or a roll back.
// Kept in IndexedDB next to the save, and copied to the cloud for signed-in players, where the
// server keeps the newest few dozen. Settings lists both, newest first.
import { saveSummary, type SaveSummary } from "@pokehd/emu";
import { decodeText, sha1Hex } from "@pokehd/rom";
import { run } from "../idb.ts";

/** Why a save was kept. "save" is the periodic copy; the others come before a replacement. */
export type HistoryReason = "save" | "replaced" | "before-import" | "before-restore" | "before-rollback";

interface StoredEntry {
  takenAt: number;
  reason: HistoryReason;
  sram: ArrayBuffer;
  sha1: string;
}

export interface HistoryEntry {
  /** `<takenAt>-<reason>`, the same here and in the cloud. */
  id: string;
  takenAt: number;
  reason: string;
  summary: SaveSummary | null;
  /** On this device; otherwise fetched from the cloud when chosen. */
  sram?: Uint8Array;
  cloud: boolean;
}

/** A periodic copy is kept once this long has passed since the last one. */
export const HISTORY_SPACING_MS = 30 * 60_000;
/** Periodic copies kept on the device, and copies kept before a replacement. */
export const KEEP_PERIODIC = 20;
export const KEEP_BEFORE = 10;

type Fetch = typeof fetch;
const historyKey = (key: string) => `${key}:history`;
const entryId = (e: { takenAt: number; reason: string }) => `${e.takenAt}-${e.reason}`;

async function readLocal(key: string): Promise<StoredEntry[]> {
  return (await run<StoredEntry[] | undefined>("saves", "readonly", (s) => s.get(historyKey(key)))) ?? [];
}

/** Keeps the newest of each kind, oldest first. */
export function prune(entries: StoredEntry[]): StoredEntry[] {
  const sorted = [...entries].sort((a, b) => a.takenAt - b.takenAt);
  const periodic = sorted.filter((e) => e.reason === "save").slice(-KEEP_PERIODIC);
  const before = sorted.filter((e) => e.reason !== "save").slice(-KEEP_BEFORE);
  return [...periodic, ...before].sort((a, b) => a.takenAt - b.takenAt);
}

/**
 * Whether a save should be kept: before a replacement always (unless that exact save is kept
 * already); periodically when the last periodic copy is old enough or another trainer's.
 */
export function shouldKeep(entries: StoredEntry[], reason: HistoryReason, sha1: string, sram: Uint8Array, now: number): boolean {
  if (entries.some((e) => e.sha1 === sha1)) return false;
  if (reason !== "save") return true;
  const last = entries.filter((e) => e.reason === "save").at(-1);
  if (!last) return true;
  if (now - last.takenAt >= HISTORY_SPACING_MS) return true;
  const a = saveSummary(new Uint8Array(last.sram));
  const b = saveSummary(sram);
  return !a || !b || a.id !== b.id || !a.name.every((v, i) => v === b.name[i]);
}

/**
 * Keeps a copy of `sram` if the policy says so, and sends it to the cloud. Saves without a
 * valid game in them (a blank cartridge) are never kept.
 */
export async function keepSave(key: string, sram: Uint8Array, reason: HistoryReason, f: Fetch = fetch): Promise<boolean> {
  if (!saveSummary(sram)) return false;
  const sha1 = await sha1Hex(sram);
  const now = Date.now();
  const entries = await readLocal(key);
  if (!shouldKeep(entries, reason, sha1, sram, now)) return false;
  // Ids are `<takenAt>-<reason>`, so no two entries share a millisecond.
  const takenAt = Math.max(now, ...entries.map((e) => e.takenAt + 1));
  const entry: StoredEntry = { takenAt, reason, sram: sram.slice().buffer, sha1 };
  await run("saves", "readwrite", (s) => s.put(prune([...entries, entry]), historyKey(key)));
  void uploadEntry(key, entry, f).catch((err) => console.warn("[pokeHD] couldn't copy an earlier save to the cloud", err));
  return true;
}

async function uploadEntry(key: string, entry: StoredEntry, f: Fetch): Promise<void> {
  const res = await f(`/api/saves/${key}/history?reason=${entry.reason}&at=${entry.takenAt}`, {
    method: "POST",
    body: entry.sram,
    headers: { "content-type": "application/octet-stream" },
  });
  if (!res.ok && res.status !== 401) throw new Error(`POST history: ${res.status}`);
}

/** Every earlier save, here and in the cloud, newest first. Cloud ones are fetched for their summaries. */
export async function listHistory(key: string, f: Fetch = fetch): Promise<HistoryEntry[]> {
  const local = await readLocal(key);
  const byId = new Map<string, HistoryEntry>();
  for (const e of local) {
    const sram = new Uint8Array(e.sram);
    byId.set(entryId(e), { id: entryId(e), takenAt: e.takenAt, reason: e.reason, summary: saveSummary(sram), sram, cloud: false });
  }
  try {
    const res = await f(`/api/saves/${key}/history`, { cache: "no-store" });
    if (res.ok) {
      const { saves } = (await res.json()) as { saves: { id: string; savedAt: number; reason: string }[] };
      await Promise.all(
        saves.map(async (s) => {
          const here = byId.get(s.id);
          if (here) return void (here.cloud = true);
          const got = await f(`/api/saves/${key}/history/${s.id}`, { cache: "no-store" });
          if (!got.ok) return;
          const sram = new Uint8Array(await got.arrayBuffer());
          byId.set(s.id, { id: s.id, takenAt: s.savedAt, reason: s.reason, summary: saveSummary(sram), sram, cloud: true });
        }),
      );
    }
  } catch {
    // Offline: this device's copies are still listed.
  }
  return [...byId.values()].filter((e) => e.summary).sort((a, b) => b.takenAt - a.takenAt);
}

const REASON_TEXT: Record<string, string> = {
  replaced: "before a new game saved over it",
  "before-import": "before a save file was imported",
  "before-restore": "before the cloud save replaced it",
  "before-rollback": "before going back to an earlier save",
};

/** "RED · 3 badges · 41 caught · 12:05 played", for a list of saves. */
export function describeSave(summary: SaveSummary): string {
  const badges = summary.badges === 1 ? "1 badge" : `${summary.badges} badges`;
  const time = `${summary.hours}:${String(summary.minutes).padStart(2, "0")} played`;
  return `${decodeText(summary.name)} · ${badges} · ${summary.owned} caught · ${time}`;
}

export const reasonText = (reason: string) => REASON_TEXT[reason];
