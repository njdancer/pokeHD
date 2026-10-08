// Turns one ROM bank into an annotated listing for the explorer: labels, instructions where the
// disassembly says there's code, byte rows where it says there's data, and free space.
import type { Label, LabelDb, Section } from "./db.ts";
import { decode, type Instruction } from "./sm83.ts";

export const BANK_SIZE = 0x4000;
export const bankCount = (rom: Uint8Array) => rom.length / BANK_SIZE;

/** File offset of a CPU address in a bank (bank 0 for $0000–$3FFF). */
export function romOffset(bank: number, address: number): number {
  return address < BANK_SIZE ? address : bank * BANK_SIZE + (address - BANK_SIZE);
}

/** Reads the CPU address space as it looks with `bank` switched in, ROM only (0 above $7FFF). */
export function bankReader(rom: Uint8Array, bank: number): (address: number) => number {
  return (address) => (address < 0x8000 ? (rom[romOffset(bank, address)] ?? 0) : 0);
}

/** Where a far call lands: `farcall`, `callfar`, `predef` and friends resolved statically. */
export interface FarTarget {
  bank: number;
  address: number;
  via: "Bankswitch" | "Predef";
}

export type Line =
  | { t: "section"; address: number; section: Section }
  | { t: "label"; address: number; label: Label }
  | { t: "ins"; address: number; ins: Instruction; far?: FarTarget }
  | { t: "data"; address: number; bytes: Uint8Array; kind: Label["kind"] }
  | { t: "free"; address: number; length: number };

const DATA_ROW = 8;
/** The cartridge header's fields ($0104–$014F) follow the entry point's `nop; jp`. */
const HEADER_DATA = 0x104;

/** Builds the listing for one bank. Bank 0 covers $0000–$3FFF, the rest $4000–$7FFF. */
export function bankListing(rom: Uint8Array, db: LabelDb, bank: number): Line[] {
  const start = bank === 0 ? 0 : BANK_SIZE;
  const end = start + BANK_SIZE;
  const read = bankReader(rom, bank);
  const labels = db.inBank("rom", bank).filter((l) => l.address >= start && l.address < end);
  const sections = db.sections.filter((s) => s.region.startsWith("ROM") && s.bank === bank);
  const bankswitch = db.byName.get("Bankswitch");
  const predef = db.byName.get("Predef");
  const predefTable = db.byName.get("PredefPointers");
  const lines: Line[] = [];
  // Banks the game doesn't use at all are padding: the linker lists nothing in them.
  if (bank > 0 && sections.length === 0) return [{ t: "free", address: start, length: BANK_SIZE }];
  let li = 0;
  let kind: Label["kind"] = "unknown";
  // Register values set by recent immediate loads, to resolve far calls.
  let b: number | undefined;
  let hl: number | undefined;
  let a: number | undefined;
  let address = start;
  while (address < end) {
    const section = sections.find((s) => s.start === address);
    if (section && !section.name) {
      lines.push({ t: "free", address, length: section.end - section.start + 1 });
      address = section.end + 1;
      while (li < labels.length && labels[li]!.address < address) li++;
      continue;
    }
    if (section) {
      lines.push({ t: "section", address, section });
      // The rst and interrupt vectors have no labels, but they're code.
      kind = bank === 0 && address < HEADER_DATA ? "code" : "unknown";
    }
    if (bank === 0 && address === HEADER_DATA) kind = "data";
    while (li < labels.length && labels[li]!.address === address) {
      const label = labels[li++]!;
      lines.push({ t: "label", address, label });
      if (label.kind !== "unknown" || !label.local) kind = label.kind;
      b = hl = a = undefined;
    }
    while (li < labels.length && labels[li]!.address < address) li++;
    let nextLabel = Math.min(labels[li]?.address ?? end, nextSectionStart(sections, address, end));
    if (bank === 0 && address < HEADER_DATA) nextLabel = Math.min(nextLabel, HEADER_DATA);
    if (kind === "code") {
      const ins = decode(read, address);
      if (address + ins.bytes.length <= nextLabel && ins.flow !== "invalid") {
        let far: FarTarget | undefined;
        const [o1, o2] = ins.operands;
        if (ins.mnemonic === "ld" && o1?.t === "reg" && o2?.t === "n8" && o1.v === "b") b = o2.v;
        else if (ins.mnemonic === "ld" && o1?.t === "reg" && o2?.t === "n8" && o1.v === "a") a = o2.v;
        else if (ins.mnemonic === "ld" && o1?.t === "reg" && o2?.t === "n16" && o1.v === "hl") hl = o2.v;
        else if ((ins.flow === "call" || ins.flow === "jump") && ins.target !== undefined) {
          if (bankswitch && ins.target === bankswitch.address && b !== undefined && hl !== undefined) {
            // A target in bank 0 is always visible, whatever bank b names.
            far = { bank: hl < BANK_SIZE ? 0 : b, address: hl, via: "Bankswitch" };
          } else if (predef && predefTable && ins.target === predef.address && a !== undefined) {
            const at = romOffset(predefTable.bank, predefTable.address) + a * 3;
            far = { bank: rom[at]!, address: rom[at + 1]! | (rom[at + 2]! << 8), via: "Predef" };
          }
        }
        if (ins.flow !== "none") b = hl = a = undefined;
        lines.push({ t: "ins", address, ins, far });
        address += ins.bytes.length;
        continue;
      }
    }
    const length = Math.min(DATA_ROW, nextLabel - address);
    lines.push({ t: "data", address, bytes: rom.slice(romOffset(bank, address), romOffset(bank, address) + length), kind });
    address += length;
  }
  return lines;
}

function nextSectionStart(sections: Section[], address: number, end: number): number {
  let next = end;
  for (const s of sections) if (s.start > address && s.start < next) next = s.start;
  return next;
}

/** Index of the listing line containing `address`, for scrolling to it. */
export function lineIndexOf(lines: Line[], address: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.address <= address) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  // Prefer the first line at that address (the label or section header above an instruction).
  while (found > 0 && lines[found - 1]!.address === lines[found]!.address) found--;
  return found;
}
