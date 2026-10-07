// Calls the game's own routines from the overworld loop's idle point, through a PC hook (D14).
// No ROM change: when the CPU reaches `OverworldLoop` and the player is standing still with no
// script, text, battle or warp in progress, a job's steps run one by one as real `call`s. For
// each step the hook pushes `OverworldLoop` as the return address, sets the registers and jumps
// to the routine; when the routine's `ret` lands back on `OverworldLoop` the hook fires again
// and the next step starts. After the last step the registers and every scratch byte a job
// declared are put back, and the overworld loop carries on as if nothing had happened.
import { readFileSync } from "node:fs";
import type { GameBoy, Registers } from "../../packages/emu/src/core.ts";

export interface Sym {
  bank: number;
  address: number;
}

/** Every label in `pokeblue.sym`. Spike only: the app would add these to the symbol allowlist. */
export function loadSymbols(path: string): Map<string, Sym> {
  const symbols = new Map<string, Sym>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([0-9a-f]{2}):([0-9a-f]{4}) (\S+)$/i.exec(line.trim());
    if (m) symbols.set(m[3]!, { bank: parseInt(m[1]!, 16), address: parseInt(m[2]!, 16) });
  }
  return symbols;
}

export class Symbols {
  constructor(readonly map: Map<string, Sym>) {}
  get(name: string): Sym {
    const sym = this.map.get(name);
    if (!sym) throw new Error(`No symbol ${name}`);
    return sym;
  }
  addr(name: string): number {
    return this.get(name).address;
  }
}

export interface Step {
  /** A home-bank routine (`Predef`, `AddItemToInventory`, `Bankswitch`, …). */
  routine: string;
  /** Registers on entry, computed when the step starts (so it can read earlier results). */
  registers?: (gb: GameBoy) => Partial<Registers>;
  /** Writes made just before the call, e.g. the routine's WRAM inputs. */
  before?: (gb: GameBoy) => void;
  /** Reads the routine's result. Returning false abandons the job's remaining steps. */
  after?: (gb: GameBoy, out: Registers) => boolean | void;
}

export interface Job {
  steps: Step[];
  /** Scratch ranges the steps clobber, saved before the first step and restored after the last. */
  scratch: [address: number, length: number][];
  /**
   * Checked at the idle point before the job starts. Returning a string holds the job (it stays
   * queued and is asked again next time) with that string as the reason.
   */
  check?: (gb: GameBoy) => string | undefined;
  done?: (completed: boolean) => void;
}

export const CARRY = 0x10;

/** Why the player isn't at a safe idle point, or undefined if they are. */
export function busyReason(gb: GameBoy, s: Symbols): string | undefined {
  const r = (name: string) => gb.read(s.addr(name));
  const bit = (name: string, b: number) => (r(name) >> b) & 1;
  if (r("wIsInBattle") !== 0 || r("wCurOpponent") !== 0) return "battle";
  if (r("wWalkCounter") !== 0) return "walking";
  if (r("wJoyIgnore") !== 0) return "input locked by a script";
  if (bit("wStatusFlags5", 0) || bit("wStatusFlags5", 7) || bit("wStatusFlags5", 5)) return "scripted movement";
  if (bit("wMovementFlags", 6) || bit("wMovementFlags", 7)) return "jumping, fishing or spinning";
  if (r("wStatusFlags6") & 0b0101_1100) return "warping";
  if (bit("wStatusFlags3", 3) || bit("wStatusFlags7", 2)) return "warping";
  if (bit("wStatusFlags4", 6)) return "linked";
  if (r("wSafariZoneGameOver") !== 0) return "safari zone ending";
  if (r("wNPCMovementScriptPointerTableNum") !== 0) return "NPC movement script";
  return undefined;
}

interface Running {
  job: Job;
  index: number;
  saved: Registers;
  scratch: Uint8Array[];
}

export class SafePoint {
  readonly #gb: GameBoy;
  readonly #s: Symbols;
  readonly #queue: Job[] = [];
  readonly #remove: () => void;
  #running: Running | undefined;
  /** Last reason the head job was held or the player was busy, for tests and UI. */
  lastHold: string | undefined;
  /** Overworld-loop passes seen while a job was queued but the player was busy. */
  busyPasses = 0;

  constructor(gb: GameBoy, symbols: Symbols) {
    this.#gb = gb;
    this.#s = symbols;
    this.#remove = gb.addHook(symbols.get("OverworldLoop"), () => this.#onLoop());
  }

  enqueue(job: Job): void {
    this.#queue.push(job);
  }

  get pending(): number {
    return this.#queue.length + (this.#running ? 1 : 0);
  }

  dispose(): void {
    this.#remove();
  }

  #onLoop(): void {
    const gb = this.#gb;
    let run = this.#running;
    if (run) {
      // Back from step `index`.
      const ok = run.job.steps[run.index]!.after?.(gb, gb.registers) ?? true;
      run.index++;
      if (ok === false || run.index >= run.job.steps.length) {
        this.#finish(run, ok !== false);
        return;
      }
      this.#call(run);
      return;
    }
    const job = this.#queue[0];
    if (!job) return;
    const busy = busyReason(gb, this.#s);
    if (busy) {
      this.lastHold = busy;
      this.busyPasses++;
      return;
    }
    const held = job.check?.(gb);
    if (held) {
      this.lastHold = held;
      // A held job doesn't block the ones behind it: move it to the back.
      this.#queue.push(this.#queue.shift()!);
      return;
    }
    this.#queue.shift();
    run = {
      job,
      index: 0,
      saved: gb.registers,
      scratch: job.scratch.map(([a, n]) => gb.readBytes(a, n)),
    };
    this.#running = run;
    this.#call(run);
  }

  #call(run: Running): void {
    const gb = this.#gb;
    const step = run.job.steps[run.index]!;
    step.before?.(gb);
    const loop = this.#s.addr("OverworldLoop");
    const sp = (run.saved.sp - 2) & 0xffff;
    gb.write(sp, loop & 0xff);
    gb.write(sp + 1, loop >> 8);
    gb.setRegisters({ ...step.registers?.(gb), sp, pc: this.#s.addr(step.routine) });
  }

  #finish(run: Running, completed: boolean): void {
    const gb = this.#gb;
    run.job.scratch.forEach(([a], i) => run.scratch[i]!.forEach((v, j) => gb.write(a + j, v)));
    gb.setRegisters(run.saved);
    this.#running = undefined;
    run.job.done?.(completed);
  }
}
