// Helpers for ROM tests that drive the game from Node. Not exported from the package.
import { encodeText, monName, pokedexNumber, romOffset, SYMBOLS, type SymbolName } from "@pokehd/rom";
import { Button, type GameBoy } from "./core.ts";

const PARTYMON = 44;
const addr = (name: SymbolName) => SYMBOLS[name].address;

/** Mashes A (with the odd Down and Start) through the intro until the overworld loop runs. */
export function playIntro(gb: GameBoy): number {
  let reached = false;
  const remove = gb.addHook("OverworldLoop", () => (reached = true));
  let frame = 0;
  while (!reached && frame < 20_000) {
    const press = frame % 64 < 8 ? Button.Down : frame % 512 < 8 ? Button.Start : Button.A;
    gb.setButtons(frame % 8 < 2 ? press : 0);
    gb.runFrame();
    frame++;
  }
  remove();
  gb.setButtons(0);
  for (let i = 0; i < 60; i++) gb.runFrame();
  return frame;
}

/** Gives the player a team of fresh Pokémon at these levels, with their first moves at 20 PP. */
export function setParty(gb: GameBoy, rom: Uint8Array, mons: { species: number; level: number }[]) {
  gb.write(addr("wPartyCount"), mons.length);
  mons.forEach(({ species, level }, n) => {
    const base = romOffset(SYMBOLS.BaseStats) + (pokedexNumber(rom, species) - 1) * 28;
    const hpMax = Math.floor((rom[base + 1]! * 2 * level) / 100) + level + 10;
    const stat = (k: number) => Math.floor((rom[base + k]! * 2 * level) / 100) + 5;
    const s = new Uint8Array(PARTYMON);
    s.set([species, hpMax >> 8, hpMax & 255, level, 0, rom[base + 6]!, rom[base + 7]!, 0]);
    s.set(rom.subarray(base + 15, base + 19), 8);
    s.set([20, 20, 20, 20].map((pp, i) => (s[8 + i] ? pp : 0)), 29);
    s.set([level, hpMax >> 8, hpMax & 255], 33);
    [2, 3, 4, 5].forEach((k, i) => s.set([0, stat(k)], 36 + i * 2));
    gb.write(addr("wPartySpecies") + n, species);
    s.forEach((v, k) => gb.write(addr("wPartyMons") + n * PARTYMON + k, v));
    encodeText("RED").forEach((v, k) => gb.write(addr("wPartyMonOT") + n * 11 + k, v));
    encodeText(monName(rom, species)).forEach((v, k) => gb.write(addr("wPartyMonNicks") + n * 11 + k, v));
  });
  gb.write(addr("wPartySpecies") + mons.length, 0xff);
}

/** Fills the bag with [item, quantity] pairs. */
export function setBag(gb: GameBoy, items: [number, number][]) {
  gb.write(addr("wNumBagItems"), items.length);
  items.flat().forEach((v, i) => gb.write(addr("wNumBagItems") + 1 + i, v));
  gb.write(addr("wNumBagItems") + 1 + items.length * 2, 0xff);
}
