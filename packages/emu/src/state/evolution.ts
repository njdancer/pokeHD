// The evolution screen, read from the Game Boy's own screen buffers each frame, so the HD view can
// stage it instead of the Game Boy screen (QA bug 27). EvolutionAfterBattle (engine/pokemon/
// evos_moves.asm) prints "What? X is evolving!", then clears the top 12 rows (ClearScreenArea)
// and calls EvolveMon (engine/movie/evolution.asm), which draws the old species' picture at (7, 2)
// with LoadFlippedFrontSpriteByMonIndex (vFrontPic, tiles $00–$30), copies the new species' to
// vBackPic (tiles $31–$61), and swaps the two by adding ±$31 to the picture's 49 tile map entries
// (Evolution_ChangeMonPic), faster and faster. On the Super Game Boy the whole screen takes the
// Pokémon's palette, and PAL_BLACK while it swaps: a dark silhouette flickering between the two.
// The same routine runs after battles, for evolution stones and for trades.
import { SYMBOLS } from "@pokehd/rom";
import type { Watch } from "../protocol.ts";
import { NOT_DRAWN, PIC_PIXELS, PIC_TILES, tileRow } from "./battle-screen.ts";

const COLS = 20;
/** The rows EvolutionAfterBattle clears: everything above the text box. */
const CLEARED_ROWS = 12;
const BLANK = 0x7f;
/** hlcoord 7, 2 (Evolution_LoadPic). */
const PIC_X = 7;
const PIC_Y = 2;
/** vBackPic's first tile, and the offset Evolution_ChangeMonPic adds or takes away. */
const NEW_FIRST = 0x31;
const PIC_COUNT = PIC_TILES * PIC_TILES;
/**
 * Frames after the last swap that the silhouette holds. Evolution_CheckForCancel waits 16 frames
 * at most between swaps (lb bc, $1, $10), plus Delay3; after the last one the new species' cry
 * plays (on the Super Game Boy, still in PAL_BLACK) before its colours come back.
 */
const SILHOUETTE_HOLD = 40;

/**
 * The memory `EvolutionReader` reads besides the tile map and BATTLE_SCREEN_WATCHES' `picTiles`
 * and `lcd`: wEvoOldSpecies and wEvoNewSpecies (adjacent), for the two species' colours. They
 * share a union in WRAM, so they're latched while EvolveMon runs.
 */
export const EVOLUTION_WATCHES = {
  evoSpecies: [SYMBOLS.wEvoOldSpecies.address, 2],
} as const satisfies Record<string, Watch>;

export interface EvolutionWatched {
  tileMap: Uint8Array;
  picTiles: Uint8Array;
  evoSpecies: Uint8Array;
}

/** Which of the two pictures the evolution screen shows. */
export type EvolutionShowing = "old" | "new";

export interface EvolutionScreen {
  /** 56×56 colour numbers (0–3, before rBGP), rows top-down, as on screen (mirrored). */
  pixels: Uint8Array;
  /** Changes whenever `pixels` do. */
  version: number;
  showing: EvolutionShowing;
  /** The ROM's internal species index of the one shown. */
  species: number;
  oldSpecies: number;
  newSpecies: number;
  /** The swapping is on: the Super Game Boy shows it in PAL_BLACK. */
  silhouette: boolean;
}

const byte = (bytes: Uint8Array, i: number) => bytes[i] ?? 0;

/** The tile flipped pictures put at picture cell (cx, cy): columns run right to left (CopyUncompressedPicToHL). */
const flippedTile = (cx: number, cy: number) => (PIC_TILES - 1 - cx) * PIC_TILES + cy;

/**
 * Whether the tile map is the evolution screen, and which picture it shows: the 7×7 flipped
 * picture at (7, 2), every tile from the same one of the two pictures (or, for the frame a swap
 * is half written, either), on rows 0–11 that are otherwise blank. Nothing else in the game
 * draws a flipped picture there on a cleared screen. Cheap: the tile map alone.
 */
export function evolutionShown(tileMap: Uint8Array): EvolutionShowing | null {
  let fresh = 0;
  for (let y = 0; y < CLEARED_ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const tile = byte(tileMap, y * COLS + x);
      const cx = x - PIC_X;
      const cy = y - PIC_Y;
      if (cx < 0 || cy < 0 || cx >= PIC_TILES || cy >= PIC_TILES) {
        if (tile !== BLANK) return null;
        continue;
      }
      const n = flippedTile(cx, cy);
      if (tile === n + NEW_FIRST) fresh++;
      else if (tile !== n) return null;
    }
  }
  return fresh * 2 > PIC_COUNT ? "new" : "old";
}

const hash = (bytes: Uint8Array) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 0x01000193);
  return h >>> 0;
};

/**
 * Reads the evolution screen frame by frame: the picture as drawn, which species it is, and
 * whether the swapping (and so the silhouette) is on. Call `reset` once it's gone.
 */
export class EvolutionReader {
  #species: [number, number] | null = null;
  #showing: EvolutionShowing | null = null;
  #swaps = 0;
  #sinceSwap = Infinity;
  #hash = 0;
  #version = 0;

  reset(): void {
    this.#species = null;
    this.#showing = null;
    this.#swaps = 0;
    this.#sinceSwap = Infinity;
  }

  read(watched: EvolutionWatched): EvolutionScreen | null {
    const showing = evolutionShown(watched.tileMap);
    if (!showing) {
      this.reset();
      return null;
    }
    // Set by EvolutionAfterBattle before EvolveMon draws anything; afterwards the union may move on.
    this.#species ??= [byte(watched.evoSpecies, 0), byte(watched.evoSpecies, 1)];
    if (this.#showing && showing !== this.#showing) {
      this.#swaps++;
      this.#sinceSwap = 0;
    } else this.#sinceSwap++;
    this.#showing = showing;

    const pixels = new Uint8Array(PIC_PIXELS * PIC_PIXELS).fill(NOT_DRAWN);
    for (let cy = 0; cy < PIC_TILES; cy++) {
      for (let cx = 0; cx < PIC_TILES; cx++) {
        const tile = byte(watched.tileMap, (PIC_Y + cy) * COLS + PIC_X + cx);
        for (let row = 0; row < 8; row++) tileRow(watched.picTiles, tile, row, pixels, (cy * 8 + row) * PIC_PIXELS + cx * 8);
      }
    }
    const h = hash(pixels);
    if (h !== this.#hash) {
      this.#hash = h;
      this.#version++;
    }
    const [oldSpecies, newSpecies] = this.#species;
    return {
      pixels,
      version: this.#version,
      showing,
      species: showing === "new" ? newSpecies : oldSpecies,
      oldSpecies,
      newSpecies,
      silhouette: this.#swaps > 0 && this.#sinceSwap <= SILHOUETTE_HOLD,
    };
  }
}
