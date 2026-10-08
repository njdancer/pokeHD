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
/** `shared`: the ROM is Nick's cartridge (D26), so it goes if he stops sharing it with this player. */
export async function storeRom(rom: Uint8Array, shared = false) {
  await run("rom", "readwrite", (s) => s.put(rom.slice().buffer, "rom"));
  if (shared) await run("rom", "readwrite", (s) => s.put(true, "shared"));
  else await run("rom", "readwrite", (s) => s.delete("shared"));
}

export async function storedRomIsShared(): Promise<boolean> {
  try {
    return (await run<boolean | undefined>("rom", "readonly", (s) => s.get("shared"))) === true;
  } catch {
    return false;
  }
}

export async function forgetRom() {
  await run("rom", "readwrite", (s) => s.delete("rom"));
  await run("rom", "readwrite", (s) => s.delete("shared"));
}
