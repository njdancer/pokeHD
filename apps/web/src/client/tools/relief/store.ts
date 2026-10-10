// Where the relief editor keeps its work: this device always, Nick's account when he's signed in.
// Training material only; the game never reads it.
import { decode, emptyDoc, encode, type Normal, type ReliefDoc } from "./normals.ts";

const LOCAL_KEY = "pokehd-relief";

export function loadLocal(): ReliefDoc | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const doc = raw ? (JSON.parse(raw) as ReliefDoc) : null;
    return doc?.version === 1 ? doc : null;
  } catch {
    return null;
  }
}

export function saveLocal(doc: ReliefDoc) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(doc));
  } catch {
    // Storage full or blocked: the server copy (if any) still has it.
  }
}

/** The account copy, or null when not signed in as Nick. */
export async function loadRemote(): Promise<ReliefDoc | null> {
  const res = await fetch("/api/admin/relief").catch(() => null);
  if (!res?.ok) return null;
  const doc = (await res.json()) as ReliefDoc;
  return doc.version === 1 ? doc : null;
}

export async function saveRemote(doc: ReliefDoc): Promise<boolean> {
  const res = await fetch("/api/admin/relief", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(doc) }).catch(() => null);
  return !!res?.ok;
}

/** The newer of two copies, by their `updatedAt`. */
export function newer(a: ReliefDoc | null, b: ReliefDoc | null): ReliefDoc {
  if (!a) return b ?? emptyDoc();
  if (!b) return a;
  return (a.updatedAt ?? "") >= (b.updatedAt ?? "") ? a : b;
}

export function download(doc: ReliefDoc) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 1)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `relief-normals-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The edits in memory while painting: decoded per tile and per picture, written back on save. */
export class EditStore {
  doc: ReliefDoc;
  private tiles = new Map<string, Normal[]>();
  private pics = new Map<number, { width: number; height: number; normals: Normal[] }>();
  constructor(doc: ReliefDoc) { this.doc = doc; }

  /** Replaces everything with another copy (e.g. the account's, when it's newer). */
  replace(doc: ReliefDoc) { this.doc = doc; this.tiles.clear(); this.pics.clear(); }

  /** A tile's 64 normals: as saved, or seeded on first use. */
  tile(tileset: string, id: number, seed: () => Normal): Normal[] {
    const key = `${tileset}:${id}`;
    let arr = this.tiles.get(key);
    if (!arr) {
      const stored = this.doc.tiles[tileset]?.[String(id)];
      arr = stored ? decode(stored) : Array.from({ length: 64 }, seed);
      this.tiles.set(key, arr);
    }
    return arr;
  }

  /** A Pokémon picture's normals: as saved (if the size matches), or seeded. */
  pic(dex: number, width: number, height: number, seed: () => Normal[]): Normal[] {
    let p = this.pics.get(dex);
    if (!p) {
      const stored = this.doc.pics[`mon:${dex}`];
      p = { width, height, normals: stored && stored.width === width && stored.height === height ? decode(stored.normals) : seed() };
      this.pics.set(dex, p);
    }
    return p.normals;
  }

  /** Writes everything touched back into the document and stamps it. */
  flush(): ReliefDoc {
    for (const [key, arr] of this.tiles) { const [name, id] = key.split(":") as [string, string]; (this.doc.tiles[name] ??= {})[id] = encode(arr); }
    for (const [dex, p] of this.pics) this.doc.pics[`mon:${dex}`] = { width: p.width, height: p.height, normals: encode(p.normals) };
    this.doc.updatedAt = new Date().toISOString();
    return this.doc;
  }
}
