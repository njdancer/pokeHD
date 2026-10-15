// Emulator states for the HD UI pass and layout fuzzing (apps/web/e2e/ui-*.e2e.ts): one late-game
// player (eight badges, a team with every field move, a full bag, money, most towns visited)
// standing where each part of the UI comes up: facing a CUT tree, the water, a shop clerk, the PC,
// a nurse, a gym leader, in a dark cave, and in wild and trainer battles. `node tools/record-ui-states.ts`.
// States hold game RAM, so they go to rom/fixtures/ (gitignored) like the ROM itself; the page
// loads one with `?fixture=<name>`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Button, GameBoy } from "../packages/emu/src/core.ts";
import { enterMap, playIntro, setBag, setParty } from "../packages/emu/src/testing.ts";
import { encodeText, MAP_NAMES, parseWorld, pokedexNumber, SYMBOLS, type SymbolName } from "../packages/rom/src/index.ts";

const ROM = new Uint8Array(readFileSync(new URL("../rom/pokeblue.gb", import.meta.url)));
const OUT = new URL("../rom/fixtures/", import.meta.url);
const map = (name: string) => {
  const id = MAP_NAMES.indexOf(name);
  if (id < 0) throw new Error(`No map ${name}`);
  return id;
};
const addr = (name: SymbolName) => SYMBOLS[name].address;

const gb = await GameBoy.create({
  rom: ROM,
  wasmBinary: readFileSync(new URL("../packages/emu/src/generated/sameboy.wasm", import.meta.url)),
});
const world = parseWorld(ROM);
const read = (name: SymbolName) => gb.read(addr(name));
const where = () => [read("wCurMap"), read("wXCoord"), read("wYCoord")] as [number, number, number];
const frame = (buttons = 0) => {
  gb.setButtons(buttons);
  gb.runFrame();
};
const frames = (n: number, buttons = 0) => {
  for (let i = 0; i < n; i++) frame(buttons);
};
const save = (name: string) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(new URL(`${name}.state`, OUT), gb.saveState());
  console.log(`saved ${name} at ${where()}`);
};

/** Internal species ID of a Pokédex number. */
function species(dex: number): number {
  for (let s = 1; s <= 190; s++) if (pokedexNumber(ROM, s) === dex) return s;
  throw new Error(`No species for #${dex}`);
}

const MOVES = { CUT: 0x0f, WING_ATTACK: 0x11, FLY: 0x13, BODY_SLAM: 0x22, BITE: 0x2c, HYDRO_PUMP: 0x38, SURF: 0x39, STRENGTH: 0x46, RAZOR_LEAF: 0x4b, EARTHQUAKE: 0x59, DIG: 0x5b, PSYCHIC: 0x5e, TELEPORT: 0x64, EGG_BOMB: 0x79, SOFTBOILED: 0x87, FLASH: 0x94 };
const TEAM: { dex: number; level: number; nick?: string; moves: number[] }[] = [
  { dex: 9, level: 52, moves: [MOVES.SURF, MOVES.STRENGTH, MOVES.HYDRO_PUMP, MOVES.BITE] },
  { dex: 18, level: 46, nick: "SKY", moves: [MOVES.FLY, MOVES.WING_ATTACK] },
  { dex: 3, level: 50, moves: [MOVES.CUT, MOVES.FLASH, MOVES.RAZOR_LEAF, MOVES.BODY_SLAM] },
  { dex: 113, level: 40, moves: [MOVES.SOFTBOILED, MOVES.EGG_BOMB] },
  { dex: 51, level: 38, moves: [MOVES.DIG, MOVES.EARTHQUAKE] },
  { dex: 65, level: 44, nick: "SPOONS", moves: [MOVES.TELEPORT, MOVES.PSYCHIC] },
];
const PARTYMON = 44;

const ITEMS: [number, number][] = [
  [0x14, 10], // POTION
  [0x13, 5], // SUPER POTION
  [0x0b, 3], // ANTIDOTE
  [0x34, 2], // FULL HEAL
  [0x04, 20], // POKé BALL
  [0x03, 5], // GREAT BALL
  [0x1d, 2], // ESCAPE ROPE
  [0x1e, 3], // REPEL
  [0x06, 1], // BICYCLE
  [0x4c, 1], // OLD ROD
  [0x4e, 1], // SUPER ROD
  [0x47, 1], // ITEMFINDER
  [0x49, 1], // POKé FLUTE
  [0x05, 1], // TOWN MAP
  [0x41, 2], // X ATTACK
  [0x28, 3], // RARE CANDY
  [0x20, 1], // FIRE STONE
  [0xc9, 1], // TM01
  [0xc6, 1], // HM03
  [0x45, 1], // COIN CASE
];

/** The late-game player, set over the game's memory once the intro is done. */
function setUp() {
  setParty(gb, ROM, TEAM.map((m) => ({ species: species(m.dex), level: m.level })));
  TEAM.forEach((m, i) => {
    const at = addr("wPartyMons") + i * PARTYMON;
    for (let k = 0; k < 4; k++) {
      gb.write(at + 8 + k, m.moves[k] ?? 0);
      // Full PP: the Moves table's sixth byte (6 bytes a move, from move 1).
      const move = m.moves[k];
      gb.write(at + 29 + k, move ? ROM[SYMBOLS.Moves.bank * 0x4000 + (SYMBOLS.Moves.address - 0x4000) + (move - 1) * 6 + 5]! : 0);
    }
    if (m.nick) {
      const name = encodeText(m.nick);
      for (let k = 0; k < 11; k++) gb.write(addr("wPartyMonNicks") + i * 11 + k, name[k] ?? 0x50);
    }
  });
  // Chansey a little hurt, so SOFTBOILED has someone to heal; Pidgeot poisoned.
  gb.write(addr("wPartyMons") + 3 * PARTYMON + 1, 0);
  gb.write(addr("wPartyMons") + 3 * PARTYMON + 2, 150);
  gb.write(addr("wPartyMons") + 1 * PARTYMON + 2, 40);
  gb.write(addr("wPartyMons") + 1 * PARTYMON + 4, 1 << 3);
  setBag(gb, ITEMS);
  gb.write(addr("wObtainedBadges"), 0xff);
  gb.write(addr("wTownVisitedFlag"), 0xff);
  gb.write(addr("wTownVisitedFlag") + 1, 0x07);
  [0x01, 0x23, 0x45].forEach((v, i) => gb.write(addr("wPlayerMoney") + i, v));
  // Seen 60 and caught 30 of the first Pokémon, plus the team.
  const flag = (base: number, dex: number) => gb.write(base + ((dex - 1) >> 3), gb.read(base + ((dex - 1) >> 3)) | (1 << ((dex - 1) & 7)));
  for (let dex = 1; dex <= 60; dex++) flag(addr("wPokedexSeen"), dex);
  for (let dex = 1; dex <= 30; dex++) flag(addr("wPokedexOwned"), dex);
  for (const m of TEAM) {
    flag(addr("wPokedexSeen"), m.dex);
    flag(addr("wPokedexOwned"), m.dex);
  }
}

/** Puts the player at (x, y) on a map, through the game's EnterMap (testing.ts). */
function teleport(name: string, x: number, y: number, lastMap = name) {
  const id = map(name);
  enterMap(gb, id, x, y, world.maps[id]!.widthBlocks, map(lastMap));
  const [m, px, py] = where();
  if (m !== id || px !== x || py !== y) throw new Error(`Teleport to ${name} (${x}, ${y}) ended at ${where()}`);
}

/** Turns toward something in the way (the player can't step there, so they only turn). */
function face(button: number) {
  const before = where();
  frames(4, button);
  frames(30);
  if (where().join() !== before.join()) throw new Error(`Facing moved the player from ${before} to ${where()}`);
}

/** The tile the player would stand on at (x, y) on a map, and whether it's water (tile $14). */
function tileAt(id: number, x: number, y: number): number {
  const m = world.maps[id]!;
  const ts = world.tilesets[m.tileset]!;
  const block = m.blocks[(y >> 1) * m.widthBlocks + (x >> 1)]!;
  return ts.blocks[block * 16 + ((y & 1) * 2 + 1) * 4 + (x & 1) * 2]!;
}

playIntro(gb);
frames(60);
setUp();
const base = gb.saveState();
const from = (state: Uint8Array) => gb.loadState(state);

// Overworld, nothing to face: Pewter City, in the open.
from(base);
teleport("PEWTER_CITY", 18, 22);
save("ui-town");

// Facing the tree beside Vermilion's Gym (CUT).
from(base);
teleport("VERMILION_CITY", 14, 18);
face(Button.Right);
save("ui-tree");

// Facing the water, south of Pallet Town (SURF, the rods).
from(base);
{
  const id = map("PALLET_TOWN");
  const m = world.maps[id]!;
  const walkable = world.tilesets[m.tileset]!.semantics.walkable;
  let spot: [number, number] | null = null;
  for (let y = m.heightBlocks * 2 - 2; y > 0 && !spot; y--)
    for (let x = 0; x < m.widthBlocks * 2 && !spot; x++)
      if (walkable.includes(tileAt(id, x, y)) && tileAt(id, x, y + 1) === 0x14) spot = [x, y];
  if (!spot) throw new Error("No shore in Pallet Town");
  teleport("PALLET_TOWN", ...spot);
  face(Button.Down);
  save("ui-water");
}

// Inside Rock Tunnel, dark until FLASH.
from(base);
teleport("ROCK_TUNNEL_1F", 15, 5, "ROUTE_10");
save("ui-cave");

// Facing the clerk across Pewter Mart's counter.
from(base);
teleport("PEWTER_MART", 2, 5, "PEWTER_CITY");
face(Button.Left);
save("ui-mart");

// Facing the nurse, and the PC, in Pewter's Pokémon Center.
from(base);
teleport("PEWTER_POKECENTER", 3, 3, "PEWTER_CITY");
face(Button.Up);
save("ui-nurse");
from(base);
teleport("PEWTER_POKECENTER", 13, 4, "PEWTER_CITY");
face(Button.Up);
save("ui-pc");

// Facing Brock (a trainer battle once spoken to).
from(base);
teleport("PEWTER_GYM", 4, 2, "PEWTER_CITY");
face(Button.Up);
save("ui-leader");
// …and the battle itself, from its first frame.
for (let i = 0; read("wIsInBattle") === 0; i++) {
  if (i > 4000) throw new Error("Brock never battled");
  frame(i % 8 < 2 ? Button.A : 0);
}
save("ui-trainer-battle");

// A wild Pokémon in Route 1's grass.
from(base);
{
  const id = map("ROUTE_1");
  const m = world.maps[id]!;
  const grassTile = world.tilesets[m.tileset]!.semantics.grass;
  let spot: [number, number] | null = null;
  for (let y = m.heightBlocks * 2 - 1; y > 0 && !spot; y--)
    for (let x = 0; x < m.widthBlocks * 2 - 1 && !spot; x++)
      if (tileAt(id, x, y) === grassTile && tileAt(id, x + 1, y) === grassTile) spot = [x, y];
  if (!spot) throw new Error("No grass on Route 1");
  teleport("ROUTE_1", ...spot);
  for (let i = 0; read("wIsInBattle") === 0; i++) {
    if (i > 400) throw new Error("No wild Pokémon");
    const button = i % 2 ? Button.Left : Button.Right;
    for (let f = 0; f < 40 && read("wIsInBattle") === 0; f++) frame(button);
    frames(20);
  }
  save("ui-wild-battle");
}
