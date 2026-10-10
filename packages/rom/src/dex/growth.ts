// How a Pokémon grows: what it evolves into and the moves it learns by level, read from the
// ROM's EvosMovesPointerTable (data/pokemon/evos_moves.asm), one entry per internal species.
import { SYMBOLS } from "../generated/symbols.ts";
import { romOffset } from "../symbols.ts";

export type Evolution =
  | { how: "level"; level: number; species: number }
  | { how: "item"; item: number; species: number }
  | { how: "trade"; species: number };

export interface Growth {
  evolutions: Evolution[];
  /** Moves learnt by levelling up, in the order the game teaches them. */
  learnset: { level: number; move: number }[];
}

const EVOLVE_LEVEL = 1;
const EVOLVE_ITEM = 2;
const EVOLVE_TRADE = 3;

/** `species` is the internal index (wCurPartySpecies). */
export function growth(rom: Uint8Array, species: number): Growth {
  const table = SYMBOLS.EvosMovesPointerTable;
  const ptr = romOffset(table) + (species - 1) * 2;
  let at = romOffset({ bank: table.bank, address: rom[ptr]! | (rom[ptr + 1]! << 8) });
  const evolutions: Evolution[] = [];
  for (let kind = rom[at++]!; kind !== 0; kind = rom[at++]!) {
    if (kind === EVOLVE_LEVEL) {
      evolutions.push({ how: "level", level: rom[at]!, species: rom[at + 1]! });
      at += 2;
    } else if (kind === EVOLVE_ITEM) {
      // The item, a minimum level (always 1), the species.
      evolutions.push({ how: "item", item: rom[at]!, species: rom[at + 2]! });
      at += 3;
    } else if (kind === EVOLVE_TRADE) {
      evolutions.push({ how: "trade", species: rom[at + 1]! });
      at += 2;
    } else break;
  }
  const learnset: Growth["learnset"] = [];
  for (let level = rom[at++]!; level !== 0; level = rom[at++]!) learnset.push({ level, move: rom[at++]! });
  return { evolutions, learnset };
}
