import { SYMBOLS, type SymbolName } from "./generated/symbols.ts";

export { SYMBOLS, type SymbolName };

/** A label from pokeblue.sym: bank number and CPU address as the Game Boy sees it. */
export interface RomSymbol {
  bank: number;
  address: number;
}

const ROM_BANK_SIZE = 0x4000;

/**
 * File offset of a ROM symbol. Bank 0 (0000–3fff) maps directly; switchable banks live at
 * 4000–7fff in CPU space, so the offset is `bank * 0x4000 + (address - 0x4000)`.
 */
export function romOffset(sym: RomSymbol): number {
  if (sym.address < ROM_BANK_SIZE) {
    if (sym.bank !== 0) throw new Error(`Bank ${sym.bank} symbol at ${sym.address} is not in ROM`);
    return sym.address;
  }
  if (sym.address < 2 * ROM_BANK_SIZE && sym.bank > 0) {
    return sym.bank * ROM_BANK_SIZE + (sym.address - ROM_BANK_SIZE);
  }
  throw new Error(`Symbol at ${sym.bank}:${sym.address.toString(16)} is not a ROM address`);
}

/** CPU address of a WRAM symbol (c000–dfff), for reading emulator memory. */
export function wramAddress(sym: RomSymbol): number {
  if (sym.address < 0xc000 || sym.address > 0xdfff) {
    throw new Error(`Symbol at ${sym.address.toString(16)} is not a WRAM address`);
  }
  return sym.address;
}
