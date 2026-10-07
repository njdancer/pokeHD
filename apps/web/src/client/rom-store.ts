// Keeps the player's ROM in IndexedDB so it only has to be loaded once per browser.
const DB_NAME = "pokehd";
const STORE = "rom";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadStoredRom(): Promise<Uint8Array | null> {
  try {
    const buf = await run<ArrayBuffer | undefined>("readonly", (s) => s.get("rom"));
    return buf ? new Uint8Array(buf) : null;
  } catch {
    return null;
  }
}
export const storeRom = (rom: Uint8Array) => run("readwrite", (s) => s.put(rom.slice().buffer, "rom"));
export const forgetRom = () => run("readwrite", (s) => s.delete("rom"));
