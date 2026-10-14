// The current map's blocks as the game has them (wOverworldMap), for the HD view: the renderer
// builds maps from the ROM's block data, but the game changes a map's blocks while it's loaded
// (a tree cut down, a door opened). Only three routines write wOverworldMap (pret pokered):
//
// | routine | when |
// |---|---|
// | `LoadTileBlockMap` (home/overworld.asm) | every map load, from the ROM's blocks: cut trees grow back |
// | `ReplaceTileBlock` (engine/overworld/update_map.asm) | map scripts and events: Silph Co.'s card-key doors, gym and Elite Four doors, Victory Road's and the Mansion's switches, the Game Corner's poster, the Cinnabar Gym quiz |
// | `ReplaceTreeTileBlock` (engine/overworld/cut.asm) | CUT |
//
// Each is hooked, read-only: it marks the map changed, and the frame after (so a whole
// LoadTileBlockMap, which can straddle a frame's end, is done) the map's blocks go to the page.
// Map scripts that put earlier changes back after a load (an opened door) go through
// ReplaceTileBlock, so they arrive as well. Nothing runs per frame while nothing changes but a
// counter check.
import { SYMBOLS, type SymbolName } from "@pokehd/rom";
import type { GameBoy } from "./core.ts";

/** The current map's blocks: `width` × `height`, row-major, without wOverworldMap's border. */
export interface LiveBlocks {
  map: number;
  width: number;
  height: number;
  blocks: Uint8Array;
}

/** wOverworldMap keeps three blocks of border (for connection strips) on every side. */
export const MAP_BORDER = 3;
/** wOverworldMap's size: `ds 1300` in ram/wram.asm. */
const OVERWORLD_MAP_SIZE = 1300;
const WRITERS: readonly SymbolName[] = ["LoadTileBlockMap", "ReplaceTileBlock", "ReplaceTreeTileBlock"];
/** Frame ends to wait after a writer starts: the one it started in, and the next. */
const SETTLE_FRAMES = 2;

const addr = (name: SymbolName) => SYMBOLS[name].address;

/** The current map's blocks out of wOverworldMap, or null if the header's size can't be right. */
export function readLiveBlocks(gb: GameBoy): LiveBlocks | null {
  const width = gb.read(addr("wCurMapWidth"));
  const height = gb.read(addr("wCurMapHeight"));
  const stride = width + MAP_BORDER * 2;
  if (!width || !height || stride * (height + MAP_BORDER * 2) > OVERWORLD_MAP_SIZE) return null;
  const all = gb.readBytes(addr("wOverworldMap"), stride * (height + MAP_BORDER * 2));
  const blocks = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const from = (y + MAP_BORDER) * stride + MAP_BORDER;
    blocks.set(all.subarray(from, from + width), y * width);
  }
  return { map: gb.read(addr("wCurMap")), width, height, blocks };
}

export class BlockWatch {
  readonly #gb: GameBoy;
  readonly #emit: (blocks: LiveBlocks) => void;
  readonly #remove: (() => void)[];
  /** Frame ends left before the blocks are sent; 0 when nothing changed. */
  #due = 0;

  constructor(gb: GameBoy, emit: (blocks: LiveBlocks) => void) {
    this.#gb = gb;
    this.#emit = emit;
    this.#remove = WRITERS.map((name) => gb.addHook(name, () => this.refresh()));
  }

  /** Sends the blocks after the next frame or two (a writer ran, or a save state was loaded). */
  refresh(): void {
    this.#due = SETTLE_FRAMES;
  }

  /** Call after each frame. */
  frame(): void {
    if (this.#due === 0 || --this.#due > 0) return;
    const blocks = readLiveBlocks(this.#gb);
    if (blocks) this.#emit(blocks);
  }

  dispose(): void {
    for (const remove of this.#remove) remove();
  }
}
