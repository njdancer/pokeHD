// A disassembler for the Game Boy's CPU (the Sharp SM83), for the ROM explorer. It decodes one
// instruction at a time into structured operands, with timing, flags and a plain-English
// explanation, so the explorer can teach what each instruction does. It never executes anything:
// execution is the emulator's job.

/** 8-bit registers by the 3-bit code the opcodes use; 6 is the byte at [hl]. */
const R8 = ["b", "c", "d", "e", "h", "l", "[hl]", "a"] as const;
const R16 = ["bc", "de", "hl", "sp"] as const;
const R16_STACK = ["bc", "de", "hl", "af"] as const;
const CONDITIONS = ["nz", "z", "nc", "c"] as const;
const ALU = ["add", "adc", "sub", "sbc", "and", "xor", "or", "cp"] as const;
const ROT = ["rlc", "rrc", "rl", "rr", "sla", "sra", "swap", "srl"] as const;
const ACC_OPS = ["rlca", "rrca", "rla", "rra", "daa", "cpl", "scf", "ccf"] as const;

export type Operand =
  /** A register or register pair, or a memory operand through one: `[hl]`, `[hli]`, `[c]`… */
  | { t: "reg"; v: string }
  | { t: "cond"; v: string }
  /** An 8-bit immediate. */
  | { t: "n8"; v: number }
  /** A 16-bit immediate; may be a pointer, which is why the explorer tries to name it. */
  | { t: "n16"; v: number }
  /** `[a16]`: memory at a 16-bit address. */
  | { t: "mem16"; v: number }
  /** `[$ff00 + a8]` for ldh: an I/O register or HRAM. `v` is the full address. */
  | { t: "high"; v: number }
  /** A jump or call target (also the resolved target of a relative jump). */
  | { t: "target"; v: number }
  /** `sp + e8` (signed). */
  | { t: "sp+"; v: number }
  /** Signed 8-bit for `add sp, e8`. */
  | { t: "e8"; v: number }
  /** A bit number for bit/res/set. */
  | { t: "bit"; v: number }
  /** An rst vector. */
  | { t: "vec"; v: number };

export type Flow = "none" | "jump" | "call" | "ret" | "rst" | "halt" | "invalid";

export interface Instruction {
  address: number;
  bytes: number[];
  mnemonic: string;
  operands: Operand[];
  /** Master-clock cycles (T-states); for conditional instructions, when the branch is taken. */
  cycles: number;
  /** Cycles when a conditional branch is not taken. */
  cyclesNotTaken?: number;
  /** Effect on Z N H C, one character each: the flag letter if computed, 0/1 if forced, - if untouched. */
  flags: string;
  flow: Flow;
  conditional: boolean;
  /** Jump, call or rst target, when it's known statically. */
  target?: number;
}

const s8 = (b: number) => (b < 0x80 ? b : b - 0x100);

/** Decodes the instruction at `address`, reading bytes through `read` (CPU address space). */
export function decode(read: (address: number) => number, address: number): Instruction {
  const at = (i: number) => read((address + i) & 0xffff) & 0xff;
  const op = at(0);
  const n8 = () => at(1);
  const n16 = () => at(1) | (at(2) << 8);
  const make = (
    length: number,
    mnemonic: string,
    operands: Operand[],
    cycles: number,
    flags = "----",
    extra: Partial<Instruction> = {},
  ): Instruction => ({
    address,
    bytes: Array.from({ length }, (_, i) => at(i)),
    mnemonic,
    operands,
    cycles,
    flags,
    flow: "none",
    conditional: false,
    ...extra,
  });
  const reg = (v: string): Operand => ({ t: "reg", v });
  const x = op >> 6;
  const y = (op >> 3) & 7;
  const z = op & 7;
  const p = y >> 1;
  const q = y & 1;

  if (op === 0xcb) {
    const cb = at(1);
    const cx = cb >> 6;
    const cy = (cb >> 3) & 7;
    const cz = cb & 7;
    const hl = cz === 6;
    const target = reg(R8[cz]!);
    if (cx === 0) {
      const flags = ROT[cy] === "swap" ? "Z000" : "Z00C";
      return make(2, ROT[cy]!, [target], hl ? 16 : 8, flags);
    }
    if (cx === 1) return make(2, "bit", [{ t: "bit", v: cy }, target], hl ? 12 : 8, "Z01-");
    return make(2, cx === 2 ? "res" : "set", [{ t: "bit", v: cy }, target], hl ? 16 : 8);
  }

  if (x === 1) {
    if (op === 0x76) return make(1, "halt", [], 4, "----", { flow: "halt" });
    const mem = y === 6 || z === 6;
    return make(1, "ld", [reg(R8[y]!), reg(R8[z]!)], mem ? 8 : 4);
  }
  if (x === 2) return alu(y, reg(R8[z]!), z === 6 ? 8 : 4, 1);

  function alu(kind: number, src: Operand, cycles: number, length: number): Instruction {
    const name = ALU[kind]!;
    const flags = { add: "Z0HC", adc: "Z0HC", sub: "Z1HC", sbc: "Z1HC", and: "Z010", xor: "Z000", or: "Z000", cp: "Z1HC" }[name];
    // rgbds style: `add a, b` but `sub b`, `and b`…
    const ops = name === "add" || name === "adc" || name === "sbc" ? [reg("a"), src] : [src];
    return make(length, name, ops, cycles, flags);
  }

  if (x === 0) {
    switch (z) {
      case 0:
        if (y === 0) return make(1, "nop", [], 4);
        if (y === 1) return make(3, "ld", [{ t: "mem16", v: n16() }, reg("sp")], 20);
        if (y === 2) return make(2, "stop", [], 4, "----", { flow: "halt" });
        {
          const target = (address + 2 + s8(n8())) & 0xffff;
          if (y === 3) return make(2, "jr", [{ t: "target", v: target }], 12, "----", { flow: "jump", target });
          return make(2, "jr", [{ t: "cond", v: CONDITIONS[y - 4]! }, { t: "target", v: target }], 12, "----", {
            flow: "jump",
            conditional: true,
            cyclesNotTaken: 8,
            target,
          });
        }
      case 1:
        if (q === 0) return make(3, "ld", [reg(R16[p]!), { t: "n16", v: n16() }], 12);
        return make(1, "add", [reg("hl"), reg(R16[p]!)], 8, "-0HC");
      case 2: {
        const ptr = ["[bc]", "[de]", "[hli]", "[hld]"][p]!;
        return make(1, "ld", q === 0 ? [reg(ptr), reg("a")] : [reg("a"), reg(ptr)], 8);
      }
      case 3:
        return make(1, q === 0 ? "inc" : "dec", [reg(R16[p]!)], 8);
      case 4:
      case 5:
        return make(1, z === 4 ? "inc" : "dec", [reg(R8[y]!)], y === 6 ? 12 : 4, z === 4 ? "Z0H-" : "Z1H-");
      case 6:
        return make(2, "ld", [reg(R8[y]!), { t: "n8", v: n8() }], y === 6 ? 12 : 8);
      default: {
        const name = ACC_OPS[y]!;
        const flags = { rlca: "000C", rrca: "000C", rla: "000C", rra: "000C", daa: "Z-0C", cpl: "-11-", scf: "-001", ccf: "-00C" }[name];
        return make(1, name, [], 4, flags);
      }
    }
  }

  // x === 3
  switch (z) {
    case 0:
      if (y < 4) {
        return make(1, "ret", [{ t: "cond", v: CONDITIONS[y]! }], 20, "----", { flow: "ret", conditional: true, cyclesNotTaken: 8 });
      }
      if (y === 4) return make(2, "ldh", [{ t: "high", v: 0xff00 | n8() }, reg("a")], 12);
      if (y === 5) return make(2, "add", [reg("sp"), { t: "e8", v: s8(n8()) }], 16, "00HC");
      if (y === 6) return make(2, "ldh", [reg("a"), { t: "high", v: 0xff00 | n8() }], 12);
      return make(2, "ld", [reg("hl"), { t: "sp+", v: s8(n8()) }], 12, "00HC");
    case 1:
      if (q === 0) return make(1, "pop", [reg(R16_STACK[p]!)], 12, p === 3 ? "ZNHC" : "----");
      if (p === 0) return make(1, "ret", [], 16, "----", { flow: "ret" });
      if (p === 1) return make(1, "reti", [], 16, "----", { flow: "ret" });
      if (p === 2) return make(1, "jp", [reg("hl")], 4, "----", { flow: "jump" });
      return make(1, "ld", [reg("sp"), reg("hl")], 8);
    case 2:
      if (y < 4) {
        const target = n16();
        return make(3, "jp", [{ t: "cond", v: CONDITIONS[y]! }, { t: "target", v: target }], 16, "----", {
          flow: "jump",
          conditional: true,
          cyclesNotTaken: 12,
          target,
        });
      }
      if (y === 4) return make(1, "ldh", [reg("[c]"), reg("a")], 8);
      if (y === 5) return make(3, "ld", [{ t: "mem16", v: n16() }, reg("a")], 16);
      if (y === 6) return make(1, "ldh", [reg("a"), reg("[c]")], 8);
      return make(3, "ld", [reg("a"), { t: "mem16", v: n16() }], 16);
    case 3:
      if (y === 0) {
        const target = n16();
        return make(3, "jp", [{ t: "target", v: target }], 16, "----", { flow: "jump", target });
      }
      if (y === 6) return make(1, "di", [], 4);
      if (y === 7) return make(1, "ei", [], 4);
      return invalid();
    case 4:
      if (y < 4) {
        const target = n16();
        return make(3, "call", [{ t: "cond", v: CONDITIONS[y]! }, { t: "target", v: target }], 24, "----", {
          flow: "call",
          conditional: true,
          cyclesNotTaken: 12,
          target,
        });
      }
      return invalid();
    case 5:
      if (q === 0) return make(1, "push", [reg(R16_STACK[p]!)], 16);
      if (p === 0) {
        const target = n16();
        return make(3, "call", [{ t: "target", v: target }], 24, "----", { flow: "call", target });
      }
      return invalid();
    case 6:
      return alu(y, { t: "n8", v: n8() }, 8, 2);
    default:
      return make(1, "rst", [{ t: "vec", v: y * 8 }], 16, "----", { flow: "rst", target: y * 8 });
  }

  function invalid(): Instruction {
    return make(1, "db", [{ t: "n8", v: op }], 4, "----", { flow: "invalid" });
  }
}

const hex = (n: number, width: number) => `$${n.toString(16).padStart(width, "0")}`;

/** Names an address for display (a label), or returns undefined to print it as hex. */
export type Namer = (address: number, operand: Operand) => string | undefined;

/** One operand as rgbds-style assembly text. */
export function operandText(o: Operand, name: Namer = () => undefined): string {
  switch (o.t) {
    case "reg":
    case "cond":
      return o.v;
    case "n8":
      return hex(o.v, 2);
    case "n16":
      return name(o.v, o) ?? hex(o.v, 4);
    case "mem16":
      return `[${name(o.v, o) ?? hex(o.v, 4)}]`;
    case "high":
      return `[${name(o.v, o) ?? hex(o.v, 4)}]`;
    case "target":
      return name(o.v, o) ?? hex(o.v, 4);
    case "sp+":
      return `sp ${o.v < 0 ? "-" : "+"} ${Math.abs(o.v)}`;
    case "e8":
      return String(o.v);
    case "bit":
      return String(o.v);
    case "vec":
      return hex(o.v, 2);
  }
}

export function instructionText(ins: Instruction, name?: Namer): string {
  if (!ins.operands.length) return ins.mnemonic;
  return `${ins.mnemonic} ${ins.operands.map((o) => operandText(o, name)).join(", ")}`;
}

const CONDITION_WORDS: Record<string, string> = {
  nz: "the Z flag is clear (the last result wasn't zero)",
  z: "the Z flag is set (the last result was zero, or a compare was equal)",
  nc: "the C flag is clear (no carry: for cp, A was greater or equal)",
  c: "the C flag is set (a carry: for cp, A was smaller)",
};

function place(o: Operand, name: Namer): string {
  if (o.t === "reg") {
    if (o.v === "[hl]") return "the byte at the address in HL";
    if (o.v === "[hli]") return "the byte at HL (then HL goes up by 1)";
    if (o.v === "[hld]") return "the byte at HL (then HL goes down by 1)";
    if (o.v === "[bc]" || o.v === "[de]") return `the byte at the address in ${o.v.slice(1, 3).toUpperCase()}`;
    if (o.v === "[c]") return "the I/O port at $FF00 + C";
    return o.v.toUpperCase();
  }
  if (o.t === "n8") return `the number ${hex(o.v, 2)} (${o.v})`;
  if (o.t === "n16") return `the number ${operandText(o, name)}${name(o.v, o) ? ` (${hex(o.v, 4)})` : ""}`;
  if (o.t === "mem16") return `the byte at ${operandText(o, name).slice(1, -1)}`;
  if (o.t === "high") return `${operandText(o, name).slice(1, -1)} (high memory at ${hex(o.v, 4)})`;
  return operandText(o, name);
}

/** One or two sentences on what the instruction does, for people learning the CPU. */
export function explain(ins: Instruction, name: Namer = () => undefined): string {
  const [a, b] = ins.operands;
  const P = (o: Operand | undefined) => (o ? place(o, name) : "");
  const cond = ins.conditional && a?.t === "cond" ? `If ${CONDITION_WORDS[a.v]}, ` : "";
  const target = ins.operands.find((o) => o.t === "target");
  const targetText = target ? operandText(target, name) : "";
  switch (ins.mnemonic) {
    case "nop":
      return "Does nothing for one machine cycle.";
    case "halt":
      return "Stops the CPU until an interrupt arrives. The game uses this to wait for the next screen refresh (VBlank) without burning power.";
    case "stop":
      return "Stops the CPU and screen until a button is pressed. Games almost never use it.";
    case "ld":
    case "ldh":
      if (a?.t === "reg" && b?.t === "sp+") return `Sets HL to SP ${b.v < 0 ? "-" : "+"} ${Math.abs(b.v)}.`;
      if (a?.t === "reg" && a.v === "sp") return "Sets the stack pointer SP to HL.";
      if (b?.t === "n16") return `Loads ${P(b)} into ${P(a)}. 16-bit loads like this often set up a pointer.`;
      if (a?.t === "reg" && !a.v.startsWith("[")) return `Copies ${P(b)} into ${P(a)}.`;
      return `Stores ${P(b)} into ${P(a)}.`;
    case "push":
      return `Pushes ${P(a)} onto the stack: SP goes down by 2 and the pair is written there.`;
    case "pop":
      return `Pops 2 bytes off the stack into ${P(a)}; SP goes up by 2.${a?.t === "reg" && a.v === "af" ? " Popping AF also restores the flags." : ""}`;
    case "add":
      if (a?.t === "reg" && a.v === "hl") return `Adds ${P(b)} to HL (16-bit). Sets H and C on carries; leaves Z alone.`;
      if (a?.t === "reg" && a.v === "sp") return `Adds ${ins.operands[1]?.t === "e8" ? (b as { v: number }).v : 0} to the stack pointer.`;
      return `Adds ${P(b)} to A. Z is set if the result is 0; H and C report carries.`;
    case "adc":
      return `Adds ${P(b)} plus the carry flag to A, for adding numbers bigger than a byte.`;
    case "sub":
      return `Subtracts ${P(a)} from A. C is set if it borrowed (A was smaller).`;
    case "sbc":
      return `Subtracts ${P(b)} and the carry flag from A.`;
    case "and":
      if (a?.t === "reg" && a.v === "a") return "ANDs A with itself: A stays the same, but Z now says whether A is 0. A common way to test A.";
      return `Keeps only the bits of A that are also set in ${P(a)} (bitwise AND).`;
    case "or":
      if (a?.t === "reg" && a.v === "a") return "ORs A with itself: A stays the same, but Z now says whether A is 0.";
      return `Sets the bits of A that are set in ${P(a)} (bitwise OR).`;
    case "xor":
      if (a?.t === "reg" && a.v === "a") return "XORs A with itself, which sets A to 0 in one byte. The usual way to clear A.";
      return `Flips the bits of A that are set in ${P(a)} (bitwise XOR).`;
    case "cp":
      return `Compares A with ${P(a)}: subtracts without keeping the result. Z is set if they're equal, C if A is smaller.`;
    case "inc":
      return `Adds 1 to ${P(a)}.${a?.t === "reg" && a.v.length === 2 && !a.v.startsWith("[") ? " 16-bit inc doesn't touch the flags." : ""}`;
    case "dec":
      return `Subtracts 1 from ${P(a)}.${a?.t === "reg" && a.v.length === 2 && !a.v.startsWith("[") ? " 16-bit dec doesn't touch the flags, so loops test the count another way." : " Z is set when it reaches 0, which is how counting loops end."}`;
    case "jr":
    case "jp":
      if (a?.t === "reg" && a.v === "hl") return "Jumps to the address in HL. Used for jump tables: compute an address, then jump to it.";
      return `${cond}${cond ? "jumps" : "Jumps"} to ${targetText}${ins.mnemonic === "jr" ? " (a short relative jump, within 128 bytes)" : ""}.${cond ? " Otherwise carries on with the next instruction." : ""}`;
    case "call":
      return `${cond}${cond ? "calls" : "Calls"} the routine at ${targetText}: pushes the address of the next instruction onto the stack and jumps. The routine's ret comes back here.`;
    case "ret":
      return `${cond}${cond ? "returns" : "Returns"} from this routine: pops the return address off the stack into PC.`;
    case "reti":
      return "Returns from an interrupt handler and turns interrupts back on.";
    case "rst":
      return `Calls the fixed routine at ${targetText}: a one-byte call to one of eight vectors at the start of the ROM.`;
    case "di":
      return "Disables interrupts, so VBlank, timer, serial and joypad handlers can't run until ei.";
    case "ei":
      return "Enables interrupts (after the next instruction).";
    case "daa":
      return "Decimal-adjusts A after an add or subtract, so it holds a valid binary-coded decimal number. The game keeps money in BCD.";
    case "cpl":
      return "Flips every bit of A.";
    case "scf":
      return "Sets the carry flag.";
    case "ccf":
      return "Flips the carry flag.";
    case "rlca":
    case "rla":
    case "rrca":
    case "rra":
    case "rlc":
    case "rl":
    case "rrc":
    case "rr": {
      const left = ins.mnemonic.startsWith("rl");
      const through = ins.mnemonic === "rla" || ins.mnemonic === "rl" || ins.mnemonic === "rra" || ins.mnemonic === "rr";
      const what = a ? P(a) : "A";
      return `Rotates ${what} one bit ${left ? "left" : "right"}${through ? ", through the carry flag" : "; the bit that falls off goes to carry and wraps around"}.`;
    }
    case "sla":
      return `Shifts ${P(a)} left by one bit (multiplies by 2); the top bit goes to carry.`;
    case "sra":
      return `Shifts ${P(a)} right by one bit, keeping the sign bit (signed divide by 2).`;
    case "srl":
      return `Shifts ${P(a)} right by one bit (divides by 2); the bottom bit goes to carry.`;
    case "swap":
      return `Swaps the high and low 4 bits of ${P(a)}.`;
    case "bit":
      return `Tests bit ${a?.t === "bit" ? a.v : 0} of ${P(b)}: Z is set if that bit is 0.`;
    case "res":
      return `Clears bit ${a?.t === "bit" ? a.v : 0} of ${P(b)}.`;
    case "set":
      return `Sets bit ${a?.t === "bit" ? a.v : 0} of ${P(b)}.`;
    case "db":
      return "Not a valid instruction. This byte is probably data, not code.";
  }
  return "";
}
