// A step debugger over GameBoy for the ROM explorer: one instruction at a time, with breakpoints,
// a trace of recent instructions, a call stack and a record of which ROM bytes have run. It only
// observes; the game runs exactly as it would anyway.
import type { GameBoy, Registers } from "./core.ts";

const ROM_BANK_SIZE = 0x4000;
/** HRAM byte where the game keeps the number of the ROM bank it has switched in. */
const H_LOADED_ROM_BANK = 0xffb8;
const INTERRUPT_VECTORS = new Set([0x40, 0x48, 0x50, 0x58, 0x60]);
const TRACE_LENGTH = 4096;
const MAX_STACK = 128;

const isCall = (op: number) => op === 0xcd || (op & 0xe7) === 0xc4 || (op & 0xc7) === 0xc7;
const isRet = (op: number) => op === 0xc9 || op === 0xd9 || (op & 0xe7) === 0xc0;

/** A place in the ROM: the bank matters for $4000–$7FFF only (0 elsewhere). */
export interface Place {
  bank: number;
  pc: number;
}

export interface Frame {
  /** Where the call was made from (the call instruction). */
  from: Place;
  /** Where it went. */
  to: Place;
  /** SP just after the return address was pushed; the frame ends when SP rises above it. */
  sp: number;
  kind: "call" | "rst" | "interrupt";
}

export type StopReason = "frame" | "breakpoint" | "budget" | "returned";

export const placeKey = (bank: number, pc: number) => (pc >= ROM_BANK_SIZE && pc < 2 * ROM_BANK_SIZE ? bank : 0) * 0x10000 + pc;

export class Debugger {
  readonly gb: GameBoy;
  readonly rom: Uint8Array;
  /** Breakpoints by `placeKey`. */
  readonly breakpoints = new Set<number>();
  /** How many times each ROM byte started an instruction (saturates at 255). */
  readonly coverage: Uint8Array;
  readonly stack: Frame[] = [];
  /** Instructions stepped since this debugger started. */
  steps = 0;
  /** Frames completed while stepping. */
  frames = 0;
  readonly #trace = new Float64Array(TRACE_LENGTH);
  #traceHead = 0;
  #traceSize = 0;

  constructor(gb: GameBoy, rom: Uint8Array) {
    this.gb = gb;
    this.rom = rom;
    this.coverage = new Uint8Array(rom.length);
  }

  /**
   * The ROM bank switched in at $4000–$7FFF. The game mirrors it in hLoadedROMBank; this checks
   * that against the bytes the CPU sees around `pc` and searches the ROM if they disagree.
   */
  currentBank(pc = this.gb.registers.pc): number {
    const claimed = this.gb.read(H_LOADED_ROM_BANK) || 1;
    if (pc < ROM_BANK_SIZE || pc >= 2 * ROM_BANK_SIZE) return claimed;
    if (this.#matches(claimed, pc)) return claimed;
    for (let bank = 1; bank < this.rom.length / ROM_BANK_SIZE; bank++) if (this.#matches(bank, pc)) return bank;
    return claimed;
  }

  #matches(bank: number, pc: number): boolean {
    const base = bank * ROM_BANK_SIZE - ROM_BANK_SIZE;
    for (let i = 0; i < 8; i++) {
      const a = Math.min(pc + i, 2 * ROM_BANK_SIZE - 1);
      if (this.gb.read(a) !== this.rom[base + a]) return false;
    }
    return true;
  }

  /** Where the CPU is now. */
  get place(): Place {
    const pc = this.gb.registers.pc;
    return { bank: pc >= ROM_BANK_SIZE && pc < 2 * ROM_BANK_SIZE ? this.currentBank(pc) : 0, pc };
  }

  /** Runs one instruction. Returns true if it finished a frame. */
  step(): boolean {
    const before = this.gb.registers;
    const pc0 = before.pc;
    const op = this.gb.read(pc0);
    const bank0 = this.#fastBank(pc0);
    this.#record(bank0, pc0);
    const frame = this.gb.runCycles(1);
    this.steps++;
    if (frame) this.frames++;
    this.#track(before, op, bank0, this.gb.registers);
    return frame;
  }

  /** The bank for a ROMX pc from hLoadedROMBank alone, cheap enough for every step. */
  #fastBank(pc: number): number {
    return pc >= ROM_BANK_SIZE && pc < 2 * ROM_BANK_SIZE ? this.gb.read(H_LOADED_ROM_BANK) || 1 : 0;
  }

  #record(bank: number, pc: number): void {
    const key = placeKey(bank, pc);
    // A halted CPU sits on one instruction for thousands of steps; the trace keeps it once.
    if (this.#traceSize === 0 || this.#trace[(this.#traceHead + TRACE_LENGTH - 1) % TRACE_LENGTH] !== key) {
      this.#trace[this.#traceHead] = key;
      this.#traceHead = (this.#traceHead + 1) % TRACE_LENGTH;
      if (this.#traceSize < TRACE_LENGTH) this.#traceSize++;
    }
    if (pc < 2 * ROM_BANK_SIZE) {
      const offset = pc < ROM_BANK_SIZE ? pc : bank * ROM_BANK_SIZE + pc - ROM_BANK_SIZE;
      if (this.coverage[offset]! < 255) this.coverage[offset]!++;
    }
  }

  #track(before: Registers, op: number, bank0: number, after: Registers): void {
    // Anything that lifted SP above a frame's return address has left that frame.
    while (this.stack.length && this.stack[this.stack.length - 1]!.sp < after.sp) this.stack.pop();
    if (after.sp !== ((before.sp - 2) & 0xffff)) return;
    const from = { bank: bank0, pc: before.pc };
    const to = { bank: this.#fastBank(after.pc), pc: after.pc };
    // An interrupt can be taken instead of the instruction at PC; nothing calls the vectors.
    let kind: Frame["kind"] | undefined;
    if (INTERRUPT_VECTORS.has(after.pc) && !isRet(op)) kind = "interrupt";
    else if (isCall(op)) kind = (op & 0xc7) === 0xc7 ? "rst" : "call";
    if (!kind) return;
    this.stack.push({ from, to, sp: after.sp, kind });
    if (this.stack.length > MAX_STACK) this.stack.shift();
  }

  /**
   * Steps until a frame completes, a breakpoint is reached, `stop` says so, or `budget`
   * instructions have run. The instruction under PC always runs first, so continuing from a
   * breakpoint moves on.
   */
  run(budget = 200_000, stop?: () => boolean): StopReason {
    for (let i = 0; i < budget; i++) {
      const frame = this.step();
      if (this.breakpoints.size && this.breakpoints.has(this.#here())) return "breakpoint";
      if (stop?.()) return "returned";
      if (frame) return "frame";
    }
    return "budget";
  }

  #here(): number {
    const pc = this.gb.registers.pc;
    return placeKey(this.#fastBank(pc), pc);
  }

  /** Steps over a call or rst: runs until the instruction after it (at the same stack depth). */
  stepOver(budget = 2_000_000): StopReason {
    const { pc, sp } = this.gb.registers;
    const op = this.gb.read(pc);
    if (!isCall(op)) return this.step() ? "frame" : "returned";
    const next = (pc + ((op & 0xc7) === 0xc7 ? 1 : 3)) & 0xffff;
    return this.#runUntil(budget, () => {
      const r = this.gb.registers;
      return r.pc === next && r.sp >= sp;
    });
  }

  /** Runs until the current routine returns to its caller. */
  stepOut(budget = 2_000_000): StopReason {
    const top = this.stack[this.stack.length - 1];
    const sp = top ? top.sp : this.gb.registers.sp;
    return this.#runUntil(budget, () => this.gb.registers.sp > sp);
  }

  /** Like run, but keeps going through frame ends. */
  #runUntil(budget: number, done: () => boolean): StopReason {
    let left = budget;
    while (left > 0) {
      const chunk = Math.min(left, 100_000);
      const reason = this.run(chunk, done);
      left -= chunk;
      if (reason !== "frame" && reason !== "budget") return reason;
    }
    return "budget";
  }

  /** Recent instructions as places, oldest first (an instruction repeated in place counts once). */
  trace(limit = TRACE_LENGTH): Place[] {
    const n = Math.min(limit, this.#traceSize);
    const out: Place[] = [];
    for (let i = n; i > 0; i--) {
      const key = this.#trace[(this.#traceHead - i + TRACE_LENGTH) % TRACE_LENGTH]!;
      out.push({ bank: Math.floor(key / 0x10000), pc: key % 0x10000 });
    }
    return out;
  }

  clearCoverage(): void {
    this.coverage.fill(0);
  }
}
