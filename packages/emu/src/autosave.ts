// Autosave: the game's own save (what the start menu's SAVE does), run at the overworld idle
// point every few minutes of play and soon after moments worth keeping (a battle ending, a new
// map, a gift landing). It writes a normal save file, so it's as good as saving by hand. It
// never replaces a different trainer's save: after NEW GAME over an existing save, autosave
// waits until the player saves the new game once themselves.
//
// Also here: loading a resume point (a save state the page takes while playing), which is
// trusted only while it holds exactly the stored save file.
import { SYMBOLS, type SymbolName } from "@pokehd/rom";
import { FRAME_RATE, type GameBoy } from "./core.ts";
import { saveCommits } from "./gifts/desk.ts";
import { saveGame } from "./gifts/gifts.ts";
import { SafePoint } from "./gifts/safepoint.ts";

export interface AutoSaveOptions {
  rom: Uint8Array;
  /** Frames of play between saves when nothing prompts one sooner. Default five minutes. */
  intervalFrames?: number;
  /** Fewest frames since the last save before a battle, map change or gift prompts another. Default one minute. */
  minGapFrames?: number;
  /** Called with the reason when an autosave was skipped (another trainer's save, …). */
  skipped?: (reason: string) => void;
}

const addr = (name: SymbolName) => SYMBOLS[name].address;

/** Offset of a save-RAM symbol in the battery RAM image (`GameBoy.saveSram()`). */
const sramOffset = (name: SymbolName) => SYMBOLS[name].bank * 0x2000 + SYMBOLS[name].address - 0xa000;

/** True if the battery RAM holds a save the game would load (its checksum matches). */
export function hasSave(sram: Uint8Array): boolean {
  const start = sramOffset("sGameData");
  const end = sramOffset("sGameDataEnd");
  if (sram.length < sramOffset("sMainDataCheckSum") + 1) return false;
  let sum = 0;
  for (let i = start; i < end; i++) sum = (sum + sram[i]!) & 0xff;
  return (~sum & 0xff) === sram[sramOffset("sMainDataCheckSum")];
}

/** Why saving now would replace a save that isn't this game's, or undefined if it's safe. */
export function otherTrainersSave(gb: GameBoy): string | undefined {
  const sram = gb.saveSram();
  if (!hasSave(sram)) return undefined;
  const idAt = sramOffset("sMainData") + addr("wPlayerID") - addr("wMainDataStart");
  // The save file opens with the player's name (sPlayerName).
  const nameAt = sramOffset("sGameData");
  const same = (at: number, wram: number, length: number) => gb.readBytes(wram, length).every((b, i) => b === sram[at + i]);
  if (same(idAt, addr("wPlayerID"), 2) && same(nameAt, addr("wPlayerName"), 11)) return undefined;
  return "the save file belongs to another trainer";
}

/**
 * Loads a resume point, or says why it can't be used. It must hold exactly the stored save
 * (`sram`): a save made after it, an imported .sav or a cloud restore all make it stale, and a
 * damaged one won't match.
 */
export function loadResumePoint(g: GameBoy, state: Uint8Array, sram: Uint8Array | undefined): string | undefined {
  try {
    g.loadState(state);
  } catch {
    return "the emulator couldn't read it";
  }
  const held = g.saveSram();
  const matches = sram ? held.length === sram.length && held.every((b, i) => b === sram[i]) : !hasSave(held);
  if (!matches) return "the save file has changed since";
  g.clearSramDirty();
  return undefined;
}

export class AutoSave {
  readonly #gb: GameBoy;
  readonly #safe: SafePoint;
  readonly #interval: number;
  readonly #minGap: number;
  readonly #skipped: ((reason: string) => void) | undefined;
  readonly #removeHook: () => void;
  #enabled = true;
  #sinceSave = 0;
  #prompted = false;
  #queued = false;
  #map = -1;
  #inBattle = 0;

  constructor(gb: GameBoy, options: AutoSaveOptions) {
    this.#gb = gb;
    this.#safe = SafePoint.of(gb);
    this.#interval = options.intervalFrames ?? Math.round(5 * 60 * FRAME_RATE);
    this.#minGap = options.minGapFrames ?? Math.round(60 * FRAME_RATE);
    this.#skipped = options.skipped;
    // Any save restarts the clock: by hand, a gift's, a trade's, or ours. SaveMainData's
    // checksum write is the one every full save passes.
    const main = saveCommits(options.rom)[0]!;
    this.#removeHook = gb.addHook(main.at, () => this.#saved());
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  set enabled(on: boolean) {
    this.#enabled = on;
  }

  /** Something worth keeping happened (a gift landed): save at the next chance after the gap. */
  prompt(): void {
    this.#prompted = true;
  }

  /** Call once per emulated frame. */
  frame(): void {
    const gb = this.#gb;
    this.#sinceSave++;
    const map = gb.read(addr("wCurMap"));
    if (map !== this.#map) {
      if (this.#map !== -1) this.#prompted = true;
      this.#map = map;
    }
    const inBattle = gb.read(addr("wIsInBattle"));
    if (this.#inBattle !== 0 && inBattle === 0) this.#prompted = true;
    this.#inBattle = inBattle;

    if (!this.#enabled || this.#queued) return;
    const due = this.#sinceSave >= this.#interval || (this.#prompted && this.#sinceSave >= this.#minGap);
    if (!due) return;
    this.#queued = true;
    let skip = "";
    this.#safe.enqueue({
      scratch: [],
      steps: [saveGame],
      check: (g) => {
        skip = this.#enabled ? (otherTrainersSave(g) ?? "") : "autosave is off";
        return skip ? { drop: skip } : undefined;
      },
      done: (completed) => {
        this.#queued = false;
        if (completed) return;
        // Try again after a full interval, unless the player saves first.
        this.#sinceSave = 0;
        this.#prompted = false;
        if (skip && this.#enabled) this.#skipped?.(skip);
      },
    });
  }

  dispose(): void {
    this.#removeHook();
  }

  #saved(): void {
    this.#sinceSave = 0;
    this.#prompted = false;
  }
}
