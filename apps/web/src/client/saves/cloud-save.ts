// Cloud backup of the battery save (p1-saves-cloud), for players signed in with an invite (D19).
// Each in-game save is uploaded a few seconds after it lands; on start-up, a cloud copy that
// another device stored since this one last synced is offered as "restore from cloud".
// Versions are the server's upload times, so device clocks never matter.
import { run } from "../idb.ts";
import { loadSave, storeSave } from "./save-store.ts";

export interface CloudSave {
  sram: Uint8Array;
  /** Server time (ms) the cloud copy was stored. */
  savedAt: number;
}

export type CloudStatus =
  | { kind: "signed-out" }
  | { kind: "offline" }
  /** No cloud copy yet (a local one, if any, is being uploaded). */
  | { kind: "none" }
  | { kind: "in-sync" }
  /** Another device stored a save since this one last synced, and it differs from local. */
  | { kind: "newer"; cloud: CloudSave };

type Fetch = typeof fetch;
const url = (key: string) => `/api/saves/${key}`;

export async function fetchCloudSave(key: string, f: Fetch = fetch): Promise<CloudSave | null | "signed-out"> {
  const res = await f(url(key), { cache: "no-store" });
  if (res.status === 401) return "signed-out";
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${url(key)}: ${res.status}`);
  return { sram: new Uint8Array(await res.arrayBuffer()), savedAt: Number(res.headers.get("x-saved-at")) };
}

export async function uploadCloudSave(key: string, sram: Uint8Array, f: Fetch = fetch, keepalive = false): Promise<number | "signed-out"> {
  const res = await f(url(key), {
    method: "PUT",
    body: sram.slice().buffer,
    headers: { "content-type": "application/octet-stream" },
    keepalive,
  });
  if (res.status === 401) return "signed-out";
  if (!res.ok) throw new Error(`PUT ${url(key)}: ${res.status}`);
  return ((await res.json()) as { savedAt: number }).savedAt;
}

/** The cloud version this device last uploaded or restored, kept next to the save itself. */
const markerKey = (key: string) => `${key}:cloud`;
export const readSynced = (key: string) =>
  run<{ savedAt: number } | undefined>("saves", "readonly", (s) => s.get(markerKey(key))).then((m) => m?.savedAt);
export const writeSynced = (key: string, savedAt: number) => run("saves", "readwrite", (s) => s.put({ savedAt }, markerKey(key)));

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

export interface CloudBackupOptions {
  /** How long a save waits for another before uploading. The game writes SRAM in bursts. */
  delayMs?: number;
  fetch?: Fetch;
}

export class CloudBackup {
  private pending: Uint8Array | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  /** Set on a 401: nothing uploads until `status()` finds the player signed in again. */
  private signedOut = false;
  private readonly delayMs: number;
  private readonly fetch: Fetch;

  readonly key: string;

  constructor(key: string, options: CloudBackupOptions = {}) {
    this.key = key;
    this.delayMs = options.delayMs ?? 3000;
    this.fetch = options.fetch ?? ((...args) => fetch(...args));
  }

  /** Pass every new SRAM image here (an `EmulatorHost`'s `onSram`). */
  onSram(sram: Uint8Array): void {
    if (this.signedOut) return;
    this.pending = sram.slice();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  /** Uploads a waiting save now. `keepalive` lets it finish while the page unloads. */
  flush(keepalive = false): Promise<void> {
    clearTimeout(this.timer);
    const sram = this.pending;
    this.pending = undefined;
    if (!sram) return this.queue.then(() => undefined);
    const next = this.queue.then(async () => {
      const savedAt = await uploadCloudSave(this.key, sram, this.fetch, keepalive);
      if (savedAt === "signed-out") this.signedOut = true;
      else await writeSynced(this.key, savedAt);
    });
    this.queue = next.catch((err) => console.warn("[pokeHD] cloud backup failed", err));
    return this.queue.then(() => undefined);
  }

  /** Compares the cloud copy with this device's save. Backs up a local save the cloud lacks. */
  async status(): Promise<CloudStatus> {
    await this.flush();
    let cloud: CloudSave | null | "signed-out";
    try {
      cloud = await fetchCloudSave(this.key, this.fetch);
    } catch {
      return { kind: "offline" };
    }
    this.signedOut = cloud === "signed-out";
    if (cloud === "signed-out") return { kind: "signed-out" };
    const local = await loadSave(this.key);
    if (!cloud) {
      if (local) {
        this.onSram(local);
        await this.flush();
      }
      return { kind: "none" };
    }
    const synced = await readSynced(this.key);
    if (synced !== undefined && cloud.savedAt <= synced) return { kind: "in-sync" };
    if (local && sameBytes(local, cloud.sram)) {
      await writeSynced(this.key, cloud.savedAt);
      return { kind: "in-sync" };
    }
    return { kind: "newer", cloud };
  }

  /** Replaces this device's save with the cloud copy. Restart the emulator on it afterwards. */
  async restore(cloud: CloudSave): Promise<void> {
    clearTimeout(this.timer);
    this.pending = undefined;
    await this.queue;
    await storeSave(this.key, cloud.sram);
    await writeSynced(this.key, cloud.savedAt);
  }
}

const backups = new Map<string, CloudBackup>();

/**
 * The page's one backup for a ROM, shared by the save slot and the save controls so a restore
 * cancels an upload that's waiting. Uploads what's waiting when the page is hidden or closed.
 */
export function cloudBackup(key: string): CloudBackup {
  let backup = backups.get(key);
  if (!backup) {
    const b = (backup = new CloudBackup(key));
    backups.set(key, b);
    addEventListener("pagehide", () => void b.flush(true));
    addEventListener("visibilitychange", () => document.visibilityState === "hidden" && void b.flush(true));
  }
  return backup;
}
