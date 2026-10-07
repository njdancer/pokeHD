// Parses the overworld from ROM bytes into WorldData. Formats: vendor/pokered
// macros/scripts/maps.asm (map headers, connections, objects) and data/tilesets/*.asm.
import { MAP_NAMES, TILESET_NAMES } from "../generated/names.ts";
import { SYMBOLS, romOffset, type SymbolName } from "../symbols.ts";
import type {
  Connection,
  Direction,
  MapData,
  Npc,
  NpcMovement,
  Sign,
  SpriteSheet,
  TileAnimation,
  Tileset,
  TilesetSemantics,
  Warp,
  WorldData,
} from "./types.ts";

/** Tiles the game copies to VRAM per tileset (MAP_TILESET_SIZE). */
const TILESET_TILES = 0x60;
const TILESET_HEADER_SIZE = 12;
const CONNECTION_SIZE = 11;
const END = 0xff;
/** Trainer class IDs in object data are offset by OPP_ID_OFFSET; lower values are species. */
const OPP_ID_OFFSET = 200;
/** vTileset in VRAM, where spinner arrow tiles are copied to. */
const V_TILESET = 0x9000;

/**
 * Blocks per tileset, indexed by tileset ID. The ROM doesn't store blockset lengths; these are the
 * sizes of gfx/blocksets/*.bst in the disassembly divided by 16 (numbers, not data).
 */
const BLOCK_COUNTS = [
  128, 19, 37, 128, 19, 116, 37, 116, 35, 128, 128, 17, 128, 62, 23, 110, 58, 128, 79, 72, 58, 36,
  128, 73,
];

const ANIMATIONS: TileAnimation[] = ["none", "water", "water-flower"];
const FACING_BY_SPRITE_DIRECTION = { 0x00: "down", 0x04: "up", 0x08: "left", 0x0c: "right" } as const;
/** Connection header bits, in the order entries are stored. */
const CONNECTION_BITS: [Direction, number][] = [
  ["north", 8],
  ["south", 4],
  ["west", 2],
  ["east", 1],
];

class RomReader {
  readonly rom: Uint8Array;
  constructor(rom: Uint8Array) {
    this.rom = rom;
  }

  /** File offset of a CPU address in `bank`; bank 0 addresses ignore `bank`. */
  offset(bank: number, address: number): number {
    return address < 0x4000 ? address : romOffset({ bank, address });
  }

  sym(name: SymbolName, plus = 0): number {
    return romOffset(SYMBOLS[name]) + plus;
  }

  u8(offset: number): number {
    const v = this.rom[offset];
    if (v === undefined) throw new Error(`Read past end of ROM at ${offset.toString(16)}`);
    return v;
  }

  u16(offset: number): number {
    return this.u8(offset) | (this.u8(offset + 1) << 8);
  }

  /** Bytes from `offset` up to (not including) `terminator`. */
  list(offset: number, terminator: number): number[] {
    const out: number[] = [];
    for (let v = this.u8(offset); v !== terminator; v = this.u8(++offset)) out.push(v);
    return out;
  }

  /** Fixed-size records from `offset` until a record starting with 0xff. */
  records(offset: number, size: number): number[][] {
    const out: number[][] = [];
    for (; this.u8(offset) !== END; offset += size) {
      out.push(Array.from(this.rom.subarray(offset, offset + size)));
    }
    return out;
  }
}

const signed8 = (v: number) => (v << 24) >> 24;

/** Decodes 2bpp tile data (16 bytes per tile) to one 0–3 colour index per pixel. */
export function decode2bpp(data: Uint8Array): Uint8Array {
  const out = new Uint8Array((data.length / 16) * 64);
  for (let row = 0; row < data.length / 2; row++) {
    const lo = data[row * 2]!;
    const hi = data[row * 2 + 1]!;
    for (let x = 0; x < 8; x++) {
      const bit = 7 - x;
      out[row * 8 + x] = (((hi >> bit) & 1) << 1) | ((lo >> bit) & 1);
    }
  }
  return out;
}

function parseSemantics(r: RomReader, id: number, collPtr: number, header: number[]): TilesetSemantics {
  const forTileset = (records: number[][]) => records.filter((rec) => rec[0] === id);
  const doorPtr = r
    .records(r.sym("DoorTileIDPointers"), 3)
    .find((rec) => rec[0] === id);
  const doorBank = SYMBOLS.DoorTileIDPointers.bank;
  const warpsBank = SYMBOLS.WarpTileIDPointers.bank;
  const carpetBank = SYMBOLS.WarpTileListPointers.bank;
  const padsAndHoles = forTileset(r.records(r.sym("WarpPadAndHoleData"), 3));
  const spinnerSym = id === 22 ? "FacilitySpinnerArrows" : id === 7 ? "GymSpinnerArrows" : null;

  return {
    walkable: r.list(collPtr, END),
    grass: header[10] === END ? null : header[10]!,
    counters: header.slice(7, 10).filter((t) => t !== END),
    doors: doorPtr ? r.list(r.offset(doorBank, doorPtr[1]! | (doorPtr[2]! << 8)), 0) : [],
    warps: r.list(r.offset(warpsBank, r.u16(r.sym("WarpTileIDPointers", id * 2))), END),
    warpCarpets: (["down", "up", "left", "right"] as const).map((facing, i) => ({
      facing,
      tiles: r.list(r.offset(carpetBank, r.u16(r.sym("WarpTileListPointers", i * 2))), END),
    })),
    bookshelves: forTileset(r.records(r.sym("BookshelfTileIDs"), 3)).map((rec) => rec[1]!),
    pairCollisions: [
      ...forTileset(r.records(r.sym("TilePairCollisionsLand"), 3)).map((rec) => ({
        tileA: rec[1]!,
        tileB: rec[2]!,
        surfing: false,
      })),
      ...forTileset(r.records(r.sym("TilePairCollisionsWater"), 3)).map((rec) => ({
        tileA: rec[1]!,
        tileB: rec[2]!,
        surfing: true,
      })),
    ],
    // HandleLedges only runs on the OVERWORLD tileset (engine/overworld/ledges.asm).
    ledges:
      id === 0
        ? r.records(r.sym("LedgeTiles"), 4).map((rec) => {
            const facing = FACING_BY_SPRITE_DIRECTION[rec[0] as 0 | 4 | 8 | 12];
            if (facing === undefined || facing === "up") throw new Error(`Bad ledge ${rec}`);
            return { facing, standingOn: rec[1]!, ledge: rec[2]! };
          })
        : [],
    warpPads: padsAndHoles.filter((rec) => rec[2] === 1).map((rec) => rec[1]!),
    holes: padsAndHoles.filter((rec) => rec[2] === 2).map((rec) => rec[1]!),
    // The first four entries copy arrow tiles onto the spinner floor tiles in VRAM.
    spinners: spinnerSym
      ? [0, 1, 2, 3].map((i) => (r.u16(r.sym(spinnerSym, i * 6 + 4)) - V_TILESET) / 16)
      : [],
    // Cut works on OVERWORLD and GYM (engine/overworld/cut.asm).
    cutTrees:
      id === 0 || id === 7
        ? r.records(r.sym("CutTreeBlockSwaps"), 2).map((rec) => ({ block: rec[0]!, replacement: rec[1]! }))
        : [],
    hasWater: r.list(r.sym("WaterTilesets"), END).includes(id),
  };
}

function parseTilesets(r: RomReader): Tileset[] {
  const shared = new Map<string, Uint8Array>();
  const once = (key: string, make: () => Uint8Array) => {
    let v = shared.get(key);
    if (!v) shared.set(key, (v = make()));
    return v;
  };
  return TILESET_NAMES.map((name, id) => {
    const at = r.sym("Tilesets", id * TILESET_HEADER_SIZE);
    const header = Array.from(r.rom.subarray(at, at + TILESET_HEADER_SIZE));
    const bank = header[0]!;
    const blocksAt = r.offset(bank, header[1]! | (header[2]! << 8));
    const gfxAt = r.offset(bank, header[3]! | (header[4]! << 8));
    const collPtr = header[5]! | (header[6]! << 8);
    const blockCount = BLOCK_COUNTS[id]!;
    const animation = ANIMATIONS[header[11]!];
    if (!animation) throw new Error(`Unknown tile animation ${header[11]} in tileset ${name}`);
    return {
      id,
      name,
      blocks: once(`b${blocksAt}`, () => r.rom.slice(blocksAt, blocksAt + blockCount * 16)),
      blockCount,
      tiles: once(`t${gfxAt}`, () => decode2bpp(r.rom.subarray(gfxAt, gfxAt + TILESET_TILES * 16))),
      animation,
      semantics: parseSemantics(r, id, collPtr, header),
    };
  });
}

function parseMovement(m1: number, m2: number): NpcMovement {
  if (m1 === 0xfe) {
    const range = (["any", "up-down", "left-right"] as const)[m2];
    if (range) return { kind: "walk", range };
  } else if (m1 === 0xff) {
    if (m2 === 0x10) return { kind: "boulder" };
    const facing = ({ 0xd0: "down", 0xd1: "up", 0xd2: "left", 0xd3: "right", 0xff: "none", 0x00: "any" } as const)[
      m2 as 0xd0
    ];
    if (facing) return { kind: "stay", facing };
  }
  throw new Error(`Unknown NPC movement ${m1.toString(16)} ${m2.toString(16)}`);
}

function parseMap(r: RomReader, id: number, name: string): MapData {
  const bank = r.u8(r.sym("MapHeaderBanks", id));
  let at = r.offset(bank, r.u16(r.sym("MapHeaderPointers", id * 2)));
  const tileset = r.u8(at);
  const heightBlocks = r.u8(at + 1);
  const widthBlocks = r.u8(at + 2);
  const blocksAt = r.offset(bank, r.u16(at + 3));
  const connectionFlags = r.u8(at + 9);
  at += 10;

  const connections: Connection[] = [];
  for (const [direction, bit] of CONNECTION_BITS) {
    if (!(connectionFlags & bit)) continue;
    // Stored: map, strip pointer, window pointer, length, width, y, x, view pointer. The macro's
    // offset argument survives as y (west/east) or x (north/south), times −2.
    const along = direction === "north" || direction === "south" ? r.u8(at + 8) : r.u8(at + 7);
    connections.push({ direction, map: r.u8(at), offsetBlocks: 0 - signed8(along) / 2 });
    at += CONNECTION_SIZE;
  }

  let o = r.offset(bank, r.u16(at));
  const borderBlock = r.u8(o++);
  const warps: Warp[] = [];
  for (let n = r.u8(o++); n > 0; n--, o += 4) {
    const to = r.u8(o + 3);
    warps.push({ y: r.u8(o), x: r.u8(o + 1), toWarp: r.u8(o + 2), to: to === END ? "last" : to });
  }
  const signs: Sign[] = [];
  for (let n = r.u8(o++); n > 0; n--, o += 3) {
    signs.push({ y: r.u8(o), x: r.u8(o + 1), textId: r.u8(o + 2) });
  }
  const npcs: Npc[] = [];
  for (let n = r.u8(o++); n > 0; n--) {
    const base = {
      sprite: r.u8(o),
      y: r.u8(o + 1) - 4,
      x: r.u8(o + 2) - 4,
      movement: parseMovement(r.u8(o + 3), r.u8(o + 4)),
      textId: r.u8(o + 5) & 0x3f,
    };
    const flags = r.u8(o + 5);
    o += 6;
    if (flags & 0x40) {
      const a = r.u8(o);
      const b = r.u8(o + 1);
      o += 2;
      npcs.push(
        a >= OPP_ID_OFFSET
          ? { ...base, kind: "trainer", trainerClass: a - OPP_ID_OFFSET, trainerNumber: b }
          : { ...base, kind: "pokemon", species: a, level: b },
      );
    } else if (flags & 0x80) {
      npcs.push({ ...base, kind: "item", item: r.u8(o++) });
    } else {
      npcs.push({ ...base, kind: "person" });
    }
  }

  return {
    id,
    name,
    tileset,
    widthBlocks,
    heightBlocks,
    blocks: r.rom.slice(blocksAt, blocksAt + widthBlocks * heightBlocks),
    borderBlock,
    connections,
    warps,
    signs,
    npcs,
  };
}

/** Sprite IDs run 1 to 0x48 (constants/sprite_constants.asm); 0 is SPRITE_NONE. */
const SPRITE_COUNT = 0x49;
/** FIRST_STILL_SPRITE: from here on, sheets are a single 4-tile frame. */
const FIRST_STILL_SPRITE = 0x3d;
/** A sheet's standing frames; walking frames follow straight after (LoadMapSpriteTilePatterns). */
const STANDING_BYTES = 12 * 16;

/**
 * Sprite sheets from SpriteSheetPointerTable (data/sprites/sprites.asm): `dw graphics`,
 * `db size in bytes`, `db bank` per sprite ID from 1. Like the game, a walking sheet's walking
 * frames are read from the 12 tiles after its standing frames; sheets for people who never walk
 * have none, so those frames are whatever follows (the game never shows them).
 */
function parseSprites(r: RomReader): (SpriteSheet | null)[] {
  const sheets: (SpriteSheet | null)[] = [null];
  for (let id = 1; id < SPRITE_COUNT; id++) {
    const entry = r.sym("SpriteSheetPointerTable", (id - 1) * 4);
    const size = r.u8(entry + 2);
    const start = r.offset(r.u8(entry + 3), r.u16(entry));
    const still = id >= FIRST_STILL_SPRITE;
    sheets.push(spriteSheet(r, id, start, still ? size : STANDING_BYTES * 2, still));
  }
  return sheets;
}

function spriteSheet(r: RomReader, id: number, start: number, bytes: number, still: boolean): SpriteSheet {
  return { id, still, tiles: decode2bpp(r.rom.subarray(start, start + bytes)) };
}

/** Parses every map and tileset. Expects the verified reference ROM (see `checkRom`). */
export function parseWorld(rom: Uint8Array): WorldData {
  const r = new RomReader(rom);
  return {
    maps: MAP_NAMES.map((name, id) => (name === null ? null : parseMap(r, id, name))),
    tilesets: parseTilesets(r),
    sprites: parseSprites(r),
    bikeSprite: spriteSheet(r, 0, r.sym("RedBikeSprite"), STANDING_BYTES * 2, false),
  };
}
