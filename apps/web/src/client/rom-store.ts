// Keeps the player's ROM in IndexedDB so it only has to be loaded once per browser.
import { run } from "./idb.ts";

export async function loadStoredRom(): Promise<Uint8Array | null> {
  try {
    const buf = await run<ArrayBuffer | undefined>("rom", "readonly", (s) => s.get("rom"));
    return buf ? new Uint8Array(buf) : null;
  } catch {
    return null;
  }
}
export const storeRom = (rom: Uint8Array) => run("rom", "readwrite", (s) => s.put(rom.slice().buffer, "rom"));
export const forgetRom = () => run("rom", "readwrite", (s) => s.delete("rom"));
