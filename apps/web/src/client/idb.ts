// The app's one IndexedDB database. Each store holds a few large values by key.
const DB_NAME = "pokehd";
const VERSION = 2;
/** v1: the player's ROM. v2: battery saves (SRAM), keyed by ROM SHA-1. */
const STORES = ["rom", "saves"] as const;
export type Store = (typeof STORES)[number];

let db: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      for (const name of STORES) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
    };
    req.onsuccess = () => {
      // Let a newer version of the app (another tab) upgrade the database.
      req.result.onversionchange = () => {
        req.result.close();
        db = undefined;
      };
      resolve(req.result);
    };
    req.onerror = () => {
      db = undefined;
      reject(req.error);
    };
  });
  return db;
}

export async function run<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const tx = (await open()).transaction(store, mode);
  const req = fn(tx.objectStore(store));
  // Resolve once the transaction commits, so a write is durable before callers move on.
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? req.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/** Tests only: drop the cached connection so the next call opens afresh. */
export function closeDb(): void {
  void db?.then((d) => d.close());
  db = undefined;
}
