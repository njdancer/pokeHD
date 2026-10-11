// The pieces of the game-hook FFI (custom UI calls the game's own code, never its menus). A
// hook at a routine's first instruction can stand in for the whole routine: it writes the
// routine's outputs where its callers read them and returns to the caller (`returnFrom`), or,
// while the page hasn't answered yet, sends the CPU round `DelayFrame` and back to the same
// instruction (`waitAFrame`), so the game idles a frame at a time with sound and sprites going.
import { SYMBOLS } from "@pokehd/rom";
import type { GameBoy, Registers } from "./core.ts";

export const CARRY = 0x10;
export const ZERO = 0x80;

/** The 16-bit word at `address`, little-endian as the CPU stores it. */
export const readWord = (gb: GameBoy, address: number) => gb.read(address) | (gb.read((address + 1) & 0xffff) << 8);

/** Pushes `value` as a `call` or `push` would. */
export function push(gb: GameBoy, value: number): void {
  const sp = (gb.registers.sp - 2) & 0xffff;
  gb.write(sp, value & 0xff);
  gb.write(sp + 1, (value >> 8) & 0xff);
  gb.setRegisters({ sp });
}

/**
 * Returns from the routine whose first instruction the CPU is at, as its `ret` would, with
 * `registers` set first. `carry` sets or clears the carry flag (most routines' "cancelled").
 */
export function returnFrom(gb: GameBoy, registers: Partial<Registers> = {}, carry?: boolean): void {
  gb.setRegisters(registers);
  if (carry !== undefined) {
    const af = gb.registers.af;
    gb.setRegisters({ af: carry ? af | CARRY : af & ~CARRY });
  }
  const sp = gb.registers.sp;
  gb.setRegisters({ pc: readWord(gb, sp), sp: (sp + 2) & 0xffff });
}

/**
 * Waits a frame and comes back to `routine` (where the CPU is now): `DelayFrame` returns there.
 * DelayFrame clobbers only a and the flags, so the caller's `af` is handed back to restore.
 */
export function waitAFrame(gb: GameBoy, routine: number): number {
  const { af } = gb.registers;
  push(gb, routine);
  gb.setRegisters({ pc: SYMBOLS.DelayFrame.address });
  return af;
}

/** A stand-in's outputs: registers and carry on return, or a routine to finish with (`then`). */
export interface Answer {
  registers?: Partial<Registers>;
  carry?: boolean;
  /** A home-bank routine to jump to instead of returning; its `ret` returns to the caller. */
  then?: keyof typeof SYMBOLS;
}

/**
 * A routine the page can stand in for. While `answer` returns undefined the game waits a frame
 * at a time at the routine's start; once it returns outputs, the routine returns to its caller
 * with them. The registers the routine was entered with are restored first, so a wait leaves no
 * trace.
 */
export class StandIn {
  readonly #remove: () => void;
  #entry: Registers | null = null;

  constructor(
    gb: GameBoy,
    routine: keyof typeof SYMBOLS,
    /** Whether to stand in this time (false lets the game's own routine run). */
    take: (gb: GameBoy) => boolean,
    /** The outputs, or undefined to wait. Writes to WRAM happen inside. */
    answer: (gb: GameBoy) => Answer | undefined,
  ) {
    const sym = SYMBOLS[routine];
    this.#remove = gb.addHook(routine, (g) => {
      if (!this.#entry && !take(g)) return;
      const entry = (this.#entry ??= g.registers);
      const out = answer(g);
      if (!out) {
        g.setRegisters({ af: entry.af });
        waitAFrame(g, sym.address);
        return;
      }
      this.#entry = null;
      g.setRegisters({ ...entry, pc: g.registers.pc, sp: g.registers.sp });
      if (!out.then) return returnFrom(g, out.registers, out.carry);
      // A tail call: the game's routine finishes the job and returns to our caller itself.
      g.setRegisters(out.registers ?? {});
      if (out.carry !== undefined) g.setRegisters({ af: out.carry ? g.registers.af | CARRY : g.registers.af & ~CARRY });
      g.setRegisters({ pc: SYMBOLS[out.then].address });
    });
  }

  /** True while the game waits at the routine for an answer. */
  get waiting(): boolean {
    return this.#entry !== null;
  }

  dispose(): void {
    this.#remove();
  }
}
