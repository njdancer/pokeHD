// Calls the game's own routines from the overworld loop's idle point (D20). No ROM change: when
// the CPU reaches `OverworldLoop` and the player is standing still with no menu, text, script,
// battle or warp in progress, a job's steps run one by one as real `call`s. For each step the
// hook pushes `OverworldLoop` as the return address, sets the registers and jumps to the
// routine; when its `ret` lands back on `OverworldLoop` the hook fires again and the next step
// starts. After the last step the registers and every scratch byte the job declared are put
// back, and the loop carries on as if nothing had happened. Evidence: spikes/gifts/README.md.
import { SYMBOLS, type SymbolName } from "@pokehd/rom";
import type { GameBoy, Registers } from "../core.ts";

export interface Step {
  /** A home-bank routine (`Predef`, `AddItemToInventory`, `Bankswitch`, …). */
  routine: SymbolName;
  /** Registers on entry, computed when the step starts (so it can read earlier results). */
  registers?: (gb: GameBoy) => Partial<Registers>;
  /** Writes made just before the call, e.g. the routine's WRAM inputs. */
  before?: (gb: GameBoy) => void;
  /**
   * Words pushed after the return address, for a routine that pops what its caller pushed
   * (`CloseTextDisplay` pops the ROM bank `DisplayTextID` pushed).
   */
  push?: (gb: GameBoy) => number[];
  /** Reads the routine's result. Returning false abandons the job's remaining steps. */
  after?: (gb: GameBoy, out: Registers) => boolean | void;
}

export interface Job {
  steps: Step[];
  /** Scratch ranges the steps clobber, saved before the first step and restored after the last. */
  scratch: (readonly [address: number, length: number])[];
  /**
   * Checked at the idle point before the job starts. `hold` keeps the job queued (it's asked
   * again next time) with that reason; `drop` abandons it (`done(false)`). It may replace `steps`.
   */
  check?: (gb: GameBoy) => { hold: string } | { drop: string } | undefined;
  /** Called with the hold reason each time `check` holds the job. */
  held?: (reason: string) => void;
  /** Called once the job has run; `completed` is false if `check` or a step abandoned it. */
  done?: (completed: boolean) => void;
}

export const CARRY = 0x10;

const addr = (name: SymbolName) => SYMBOLS[name].address;

/** Why the player isn't at a safe idle point, or undefined if they are. */
export function busyReason(gb: GameBoy): string | undefined {
  const r = (name: SymbolName) => gb.read(addr(name));
  const bit = (name: SymbolName, b: number) => (r(name) >> b) & 1;
  if (r("wIsInBattle") !== 0 || r("wCurOpponent") !== 0) return "battle";
  if (r("wWalkCounter") !== 0) return "walking";
  if (r("wJoyIgnore") !== 0) return "input locked by a script";
  // Scripted NPC movement (0), joypad disabled (5), simulated joypad (7).
  if (bit("wStatusFlags5", 0) || bit("wStatusFlags5", 5) || bit("wStatusFlags5", 7)) return "scripted movement";
  if (r("wNPCMovementScriptPointerTableNum") !== 0) return "scripted movement";
  if (bit("wMovementFlags", 6) || bit("wMovementFlags", 7)) return "jumping, fishing or spinning";
  // Fly or dungeon warps (2–4), escape warp (6); a warp from a script; a forced warp.
  if (r("wStatusFlags6") & 0b0101_1100 || bit("wStatusFlags3", 3) || bit("wStatusFlags7", 2)) return "warping";
  if (bit("wStatusFlags4", 6)) return "linked";
  if (r("wSafariZoneGameOver") !== 0) return "safari zone ending";
  return undefined;
}

interface Running {
  job: Job;
  index: number;
  saved: Registers;
  scratch: Uint8Array[];
}

const shared = new WeakMap<GameBoy, SafePoint>();

/**
 * One GameBoy's queue of jobs for the overworld idle point. There is one per GameBoy
 * (`SafePoint.of`), so two queues never start calls over each other's.
 */
export class SafePoint {
  static of(gb: GameBoy): SafePoint {
    let safe = shared.get(gb);
    if (!safe) shared.set(gb, (safe = new SafePoint(gb)));
    return safe;
  }

  readonly #gb: GameBoy;
  readonly #queue: Job[] = [];
  readonly #remove: () => void;
  #running: Running | undefined;

  private constructor(gb: GameBoy) {
    this.#gb = gb;
    this.#remove = gb.addHook("OverworldLoop", () => this.#onLoop());
  }

  enqueue(job: Job): void {
    this.#queue.push(job);
  }

  /** Jobs queued or running. */
  get pending(): number {
    return this.#queue.length + (this.#running ? 1 : 0);
  }

  /** True while a job's routine is mid-call (the game is running our call, not its own code). */
  get calling(): boolean {
    return this.#running !== undefined;
  }

  /** Removes the hook; queued jobs never run. */
  dispose(): void {
    this.#remove();
    this.#queue.length = 0;
    if (shared.get(this.#gb) === this) shared.delete(this.#gb);
  }

  #onLoop(): void {
    const gb = this.#gb;
    const run = this.#running;
    if (run) {
      // Back from step `index`.
      const ok = run.job.steps[run.index]!.after?.(gb, gb.registers) ?? true;
      run.index++;
      if (ok === false || run.index >= run.job.steps.length) this.#finish(run, ok !== false);
      else this.#call(run);
      return;
    }
    if (this.#queue.length === 0 || busyReason(gb)) return;
    // Each queued job gets one look per idle pass; a held one goes to the back so it doesn't
    // block the rest.
    for (let tries = this.#queue.length; tries > 0; tries--) {
      const job = this.#queue.shift()!;
      const verdict = job.check?.(gb);
      if (verdict && "hold" in verdict) {
        this.#queue.push(job);
        job.held?.(verdict.hold);
        continue;
      }
      if (verdict || job.steps.length === 0) {
        job.done?.(false);
        continue;
      }
      const started: Running = {
        job,
        index: 0,
        saved: gb.registers,
        scratch: job.scratch.map(([a, n]) => gb.readBytes(a, n)),
      };
      this.#running = started;
      this.#call(started);
      return;
    }
  }

  #call(run: Running): void {
    const gb = this.#gb;
    const step = run.job.steps[run.index]!;
    step.before?.(gb);
    const loop = addr("OverworldLoop");
    let sp = (run.saved.sp - 2) & 0xffff;
    gb.write(sp, loop & 0xff);
    gb.write(sp + 1, loop >> 8);
    for (const word of step.push?.(gb) ?? []) {
      sp = (sp - 2) & 0xffff;
      gb.write(sp, word & 0xff);
      gb.write(sp + 1, (word >> 8) & 0xff);
    }
    gb.setRegisters({ ...step.registers?.(gb), sp, pc: addr(step.routine) });
  }

  #finish(run: Running, completed: boolean): void {
    const gb = this.#gb;
    run.job.scratch.forEach(([a], i) => run.scratch[i]!.forEach((value, j) => gb.write(a + j, value)));
    gb.setRegisters(run.saved);
    this.#running = undefined;
    run.job.done?.(completed);
  }
}
