// Bank listings and cross-references, computed on demand and kept for the session.
import { placeKey } from "@pokehd/emu";
import { bankCount, bankListing, type LabelDb, type Line } from "@pokehd/rom/explore";

const listings = new WeakMap<Uint8Array, Map<number, Line[]>>();

export function listingFor(rom: Uint8Array, db: LabelDb, bank: number): Line[] {
  let banks = listings.get(rom);
  if (!banks) listings.set(rom, (banks = new Map()));
  let lines = banks.get(bank);
  if (!lines) banks.set(bank, (lines = bankListing(rom, db, bank)));
  return lines;
}

export interface Xref {
  bank: number;
  address: number;
  how: "call" | "jump" | "rst" | "far" | "pointer";
}

const xrefCache = new WeakMap<Uint8Array, Map<number, Xref[]>>();

/**
 * Every place the code refers to each address: calls, jumps, far calls, and 16-bit loads of a
 * labelled address (pointers to data). Keyed by placeKey of the target. Takes a moment the first
 * time: it disassembles the whole ROM.
 */
export function xrefs(rom: Uint8Array, db: LabelDb): Map<number, Xref[]> {
  const cached = xrefCache.get(rom);
  if (cached) return cached;
  const out = new Map<number, Xref[]>();
  const add = (bank: number, address: number, from: Xref) => {
    const key = placeKey(address < 0x4000 ? 0 : bank, address);
    const list = out.get(key);
    if (list) list.push(from);
    else out.set(key, [from]);
  };
  for (let bank = 0; bank < bankCount(rom); bank++) {
    for (const line of listingFor(rom, db, bank)) {
      if (line.t !== "ins") continue;
      const { ins, far } = line;
      const from = (how: Xref["how"]): Xref => ({ bank, address: line.address, how });
      if (far) add(far.bank, far.address, from("far"));
      else if (ins.target !== undefined && ins.target < 0x8000) {
        add(bank, ins.target, from(ins.flow === "call" ? "call" : ins.flow === "rst" ? "rst" : "jump"));
      }
      const n16 = ins.operands.find((o) => o.t === "n16" || o.t === "mem16");
      if (n16 && n16.v >= 0x100 && (n16.v >= 0x8000 || db.at(n16.v < 0x4000 ? 0 : bank, n16.v).length)) {
        add(bank, n16.v, from("pointer"));
      }
    }
  }
  xrefCache.set(rom, out);
  return out;
}
