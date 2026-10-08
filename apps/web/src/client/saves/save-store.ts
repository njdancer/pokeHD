// Battery saves (the cartridge's SRAM), kept in IndexedDB per ROM and moved in and out as .sav
// files. A .sav is the raw SRAM image, the same format other emulators read and write.
import { sameTrainer, saveSummary } from "@pokehd/emu";
import { sha1Hex, type RomHeader } from "@pokehd/rom";
import { run } from "../idb.ts";
import { cloudBackup } from "./cloud-save.ts";
import { keepSave, type HistoryReason } from "./history.ts";

/** Saves are keyed by the ROM's SHA-1, so a different dump never picks up the wrong save. */
export const romKey = (rom: Uint8Array) => sha1Hex(rom);

export async function loadSave(key: string): Promise<Uint8Array | null> {
  const buf = await run<ArrayBuffer | undefined>("saves", "readonly", (s) => s.get(key));
  return buf ? new Uint8Array(buf) : null;
}
export const storeSave = (key: string, sram: Uint8Array) =>
  run("saves", "readwrite", (s) => s.put(sram.slice().buffer, key));
export const deleteSave = (key: string) => run("saves", "readwrite", (s) => s.delete(key));

/** Cartridge RAM size from header byte 0x149. */
export function sramSize(header: RomHeader): number {
  return [0, 2048, 8192, 32768, 131072, 65536][header.ramSizeCode] ?? 0;
}

export type SavCheck = { ok: true; sram: Uint8Array } | { ok: false; reason: string };

export function checkSav(file: Uint8Array, header: RomHeader): SavCheck {
  const size = sramSize(header);
  if (file.length === size) return { ok: true, sram: file };
  return {
    ok: false,
    reason: `That file is ${file.length.toLocaleString()} bytes; a save for this game is ${size.toLocaleString()} bytes.`,
  };
}

/** "POKEMON BLUE" → "pokeblue.sav", matching the usual ROM file name. */
export function savFileName(header: RomHeader): string {
  return `${header.title.replace(/^POKEMON /, "POKE").toLowerCase().replace(/[^a-z0-9]+/g, "") || "game"}.sav`;
}

/** Somewhere each stored save is also sent, such as the cloud backup. */
export interface SaveBackup {
  onSram(sram: Uint8Array): void;
}

/** Keeps an earlier save (see history.ts). */
export type KeepSave = (sram: Uint8Array, reason: HistoryReason) => Promise<unknown>;

/**
 * Wiring for an `EmulatorHost`: pass `sram` as its starting SRAM and `persist` as `onSram`.
 * Writes are queued so they commit in the order the emulator produced them, and each stored
 * save goes on to `backup` (in a browser, the player's cloud backup, which does nothing while
 * signed out) and to `keep`, the save history, which also gets the old save first whenever a
 * different trainer's replaces it.
 */
export async function openSaveSlot(
  key: string,
  backup: SaveBackup | null = defaultBackup(key),
  keep: KeepSave | null = defaultKeep(key),
) {
  let queue: Promise<unknown> = Promise.resolve();
  /** Runs `op` after every write queued before it. */
  const enqueue = <T>(op: () => Promise<T>): Promise<T> => {
    const next = queue.then(op);
    queue = next.catch((err) => console.error("[pokeHD] couldn't store the save", err));
    return next;
  };
  const sram = (await loadSave(key)) ?? undefined;
  let latest = sram;
  return {
    key,
    sram,
    /** The newest save handed to `persist` (it may still be committing). */
    get latest() {
      return latest;
    },
    persist(next: Uint8Array): Promise<void> {
      latest = next;
      return enqueue(async () => {
        if (keep) {
          const previous = await loadSave(key);
          if (previous && replacesTrainer(previous, next)) await keep(previous, "replaced").catch(() => {});
        }
        await storeSave(key, next);
      }).then(() => {
        backup?.onSram(next);
        void keep?.(next, "save").catch(() => {});
      });
    },
    enqueue,
    backup,
  };
}
export type SaveSlot = Awaited<ReturnType<typeof openSaveSlot>>;

/** Whether `next` holds no save, or another trainer's, where `previous` held one. */
function replacesTrainer(previous: Uint8Array, next: Uint8Array): boolean {
  const a = saveSummary(previous);
  if (!a) return false;
  const b = saveSummary(next);
  return !b || !sameTrainer(a, b);
}

function defaultKeep(key: string): KeepSave | null {
  return typeof window === "undefined" ? null : (sram, reason) => keepSave(key, sram, reason);
}

function defaultBackup(key: string): SaveBackup | null {
  return typeof window === "undefined" ? null : cloudBackup(key);
}
