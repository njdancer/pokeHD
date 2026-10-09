// The Pokédex's journal (p2-dex): the places a trainer has been and the people they've met, which
// the game itself doesn't keep. Stored beside the battery save in IndexedDB, one journal per
// trainer (their trainer ID), so a new game starts a new one.
import { run } from "../idb.ts";
import type { DexProgress, PersonMet } from "./catalogue.ts";

interface JournalData {
  places: { map: number; at: number }[];
  people: PersonMet[];
}

/** Lines kept of what someone said: the first few, as the text box showed them. */
const SAID_LINES = 6;

export class DexJournal {
  readonly #key: string;
  #data: JournalData = { places: [], people: [] };
  #saving: ReturnType<typeof setTimeout> | undefined;
  /** Bumped on every change, so React can tell. */
  version = 0;

  private constructor(key: string) {
    this.#key = key;
  }

  static async open(romKey: string, trainerId: number): Promise<DexJournal> {
    const journal = new DexJournal(`${romKey}#dex:${trainerId}`);
    const stored = await run<JournalData | undefined>("saves", "readonly", (s) => s.get(journal.#key) as IDBRequest<JournalData | undefined>).catch(() => undefined);
    if (stored) journal.#data = stored;
    return journal;
  }

  get places(): readonly { map: number; at: number }[] {
    return this.#data.places;
  }
  get people(): readonly PersonMet[] {
    return this.#data.people;
  }

  /** The player is on this map. */
  visit(map: number): void {
    if (this.#data.places.some((p) => p.map === map)) return;
    this.#data.places.push({ map, at: Date.now() });
    this.#changed();
  }

  /** Someone on the map spoke to the player. */
  met(map: number, npc: number): void {
    if (this.#find(map, npc)) return;
    this.#data.people.push({ map, npc, at: Date.now() });
    this.#changed();
  }

  /** The player beat this trainer. */
  beat(map: number, npc: number): void {
    let person = this.#find(map, npc);
    if (!person) this.#data.people.push((person = { map, npc, at: Date.now() }));
    if (person.beaten) return;
    person.beaten = true;
    this.#changed();
  }

  /** What they said, the first time (kept once there's something). */
  said(map: number, npc: number, lines: readonly string[]): void {
    const person = this.#find(map, npc);
    if (!person || person.said || !lines.length) return;
    person.said = lines.slice(0, SAID_LINES).join("\n");
    this.#changed();
  }

  /** The Pokédex's state: the game's own seen and caught, plus this journal. */
  progress(seen: ReadonlySet<number>, owned: ReadonlySet<number>, rival?: string): DexProgress {
    return { seen, owned, rival, places: [...this.#data.places], people: this.#data.people.map((p) => ({ ...p })) };
  }

  #find(map: number, npc: number): PersonMet | undefined {
    return this.#data.people.find((p) => p.map === map && p.npc === npc);
  }

  #changed(): void {
    this.version++;
    clearTimeout(this.#saving);
    this.#saving = setTimeout(() => void this.flush(), 2000);
  }

  /** Writes it now (also done a couple of seconds after each change). */
  async flush(): Promise<void> {
    clearTimeout(this.#saving);
    this.#saving = undefined;
    await run("saves", "readwrite", (s) => s.put(this.#data, this.#key)).catch(() => {});
  }
}
