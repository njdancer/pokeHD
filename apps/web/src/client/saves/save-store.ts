// Battery saves (the cartridge's SRAM), kept in IndexedDB per ROM and moved in and out as .sav
// files. A .sav is the raw SRAM image, the same format other emulators read and write.
import { sha1Hex, type RomHeader } from "@pokehd/rom";
import { run } from "../idb.ts";

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

/**
 * Wiring for an `EmulatorHost`: pass `sram` as its starting SRAM and `persist` as `onSram`.
 * Writes are queued so they commit in the order the emulator produced them.
 */
export async function openSaveSlot(key: string) {
  let queue: Promise<unknown> = Promise.resolve();
  return {
    sram: (await loadSave(key)) ?? undefined,
    persist(sram: Uint8Array): Promise<void> {
      const next = queue.then(() => storeSave(key, sram));
      queue = next.catch((err) => console.error("[pokeHD] couldn't store the save", err));
      return next.then(() => undefined);
    },
  };
}
