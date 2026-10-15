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

// Map IDs (constants/map_constants.asm).
const PALLET_TOWN = 0x00;
const REDS_HOUSE_1F = 0x25;
const OAKS_LAB = 0x28;
const ROCK_TUNNEL_1F = 0x52;

/**
 * Plays from power-on to the first rival battle in Oak's lab (with Squirtle, as the first ball
 * on the table), stopping on its first frame. `frame` runs one frame with the given buttons.
 */
export function playToRivalBattle(gb: GameBoy, frame = (buttons: number) => (gb.setButtons(buttons), gb.runFrame())): void {
  const read = (name: keyof typeof SYMBOLS) => gb.read(SYMBOLS[name].address);
  const where = () => [read("wCurMap"), read("wXCoord"), read("wYCoord")] as [number, number, number];
  const walk = (button: number, done: (map: number, x: number, y: number) => boolean) => {
    for (let i = 0; !(done(...where()) && read("wWalkCounter") === 0); i++) {
      if (i > 1200) throw new Error(`Stuck at ${where()}`);
      frame(button);
    }
    frame(0);
    frame(0);
  };
  const untilFree = (frames: number) => {
    const free = () => read("hWY") >= 144 && read("wJoyIgnore") === 0 && read("wWalkCounter") === 0;
    for (let i = 0, run = 0; run < frames; i++) {
      if (i > 20_000) throw new Error(`Never free at ${where()}`);
      frame(run === 0 && i % 8 < 2 ? Button.A : 0);
      run = free() ? run + 1 : 0;
    }
  };
  // YES on screen (charmap $98 $84 $92).
  const showsYes = () => {
    const tiles = gb.readBytes(SYMBOLS.wTileMap.address, 20 * 18);
    return tiles.some((t, i) => t === 0x98 && tiles[i + 1] === 0x84 && tiles[i + 2] === 0x92);
  };
  playIntro(gb);
  untilFree(10);
  walk(Button.Right, (_, x) => x === 5);
  walk(Button.Up, (_, __, y) => y === 1);
  walk(Button.Right, (map) => map === REDS_HOUSE_1F);
  walk(Button.Down, (_, __, y) => y === 7);
  walk(Button.Left, (_, x) => x === 3);
  walk(Button.Down, (map) => map === PALLET_TOWN);
  walk(Button.Right, (_, x) => x === 10);
  walk(Button.Up, () => read("hWY") < 144);
  untilFree(120);
  if (where()[0] !== OAKS_LAB) throw new Error(`Expected Oak's lab, at ${where()}`);
  // Squirtle's ball is on the table at (7, 3): yes to Squirtle, no to a nickname.
  walk(Button.Down, (_, __, y) => y === 4);
  walk(Button.Right, (_, x) => x === 7);
  for (let i = 0; i < 8; i++) frame(Button.Up);
  for (let i = 0, answers = 0; answers < 2; i++) {
    if (i > 3000) throw new Error("No yes/no prompt");
    if (!showsYes()) {
      frame(i % 8 < 2 ? Button.A : 0);
      continue;
    }
    for (let f = 0; f < 10; f++) frame(0);
    for (let f = 0; f < 2; f++) frame(answers === 0 ? Button.A : Button.B);
    for (let f = 0; f < 30; f++) frame(0);
    answers++;
  }
  untilFree(120);
  // The rival stops the player on the way out.
  walk(Button.Left, (_, x) => x === 5);
  for (let i = 0; read("wIsInBattle") === 0; i++) {
    if (i > 3000) throw new Error("No battle");
    frame(i % 8 < 2 ? (i % 16 < 8 ? Button.A : Button.Down) : 0);
  }
}

/**
 * Puts the player at (x, y) on a map through the game's EnterMap, as a warp would: the map from
 * wCurMap, and the block map view a warp sets (event_displacement). `width` is the map's width in
 * blocks. Runs until the map is up.
 */
export function enterMap(gb: GameBoy, map: number, x: number, y: number, width: number, lastMap = map): void {
  let entered = false;
  const remove = gb.addHook("OverworldLoop", (g) => {
    if (entered) return;
    entered = true;
    g.write(addr("wCurMap"), map);
    g.write(addr("wLastMap"), lastMap);
    g.write(addr("wXCoord"), x);
    g.write(addr("wYCoord"), y);
    const view = addr("wOverworldMap") + (width + 6) * ((y >> 1) + 1) + (x >> 1) + 1;
    g.write(addr("wCurrentTileBlockMapViewPointer"), view & 0xff);
    g.write(addr("wCurrentTileBlockMapViewPointer") + 1, view >> 8);
    g.write(addr("wYBlockCoord"), y & 1);
    g.write(addr("wXBlockCoord"), x & 1);
    // Rock Tunnel is dark until FLASH: the warp into it sets that (CheckWarpsNoCollision's outside maps).
    g.write(addr("wMapPalOffset"), map === ROCK_TUNNEL_1F ? 6 : 0);
    g.setRegisters({ pc: addr("EnterMap") });
  });
  for (let i = 0; i < 300; i++) gb.runFrame();
  remove();
}
