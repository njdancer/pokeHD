// Turns what the emulator reports during a battle into what the HD battle layer draws: the
// battle screen's pictures and sprites, coloured with each side's SGB palette (p2-battles).
import {
  BATTLE_SCREEN_WATCHES, BattleDecoder, BattleScreenReader, CELL_UI,
  type BattleScreen, type BattleScreenWatched, type BattleState, type BattleWatched, type Watch,
} from "@pokehd/emu";
import type { BattleView, Side } from "@pokehd/engine/battle";
import { battlePalette, readSgbPalettes, type SgbPalette } from "@pokehd/rom";
import type { BattleScene } from "./screen.ts";

/**
 * Tells whether each side's picture is its trainer or its Pokémon, for colouring. The trainers
 * show first (the player's back, and the opponent in a trainer battle) and slide away before
 * the Pokémon come out; a beaten trainer slides back in at the end.
 */
export class BattleColours {
  readonly #palettes: SgbPalette[];
  readonly #rom: Uint8Array;
  #trainer: Record<Side, boolean> = { player: true, enemy: false };
  #shown: Record<Side, boolean> = { player: false, enemy: false };
  #started = false;

  constructor(rom: Uint8Array) {
    this.#rom = rom;
    this.#palettes = readSgbPalettes(rom);
  }

  /** Call when a battle ends, so the next starts afresh. */
  reset(): void {
    this.#started = false;
  }

  view(state: BattleState, screen: BattleScreen): BattleView {
    if (!this.#started) {
      this.#started = true;
      this.#trainer = { player: true, enemy: state.type !== "wild" };
      this.#shown = { player: false, enemy: false };
    }
    const ramps = {} as BattleView["ramps"];
    for (const side of ["player", "enemy"] as const) {
      const shown = screen[side] !== null;
      // A picture going away makes room for the next: out of the intro, the Pokémon; after the
      // opponent's last Pokémon faints, the opponent's trainer.
      if (screen.battle && !shown && this.#shown[side]) {
        if (state.phase === "intro") this.#trainer[side] = false;
        else if (state.phase === "end" && side === "enemy" && state.type !== "wild") this.#trainer[side] = true;
      }
      if (screen.battle) this.#shown[side] = shown;
      const mon = state[side].mon;
      const id = this.#trainer[side] || !mon ? battlePalette(this.#rom, 0) : battlePalette(this.#rom, mon.species, mon.transformed);
      ramps[side] = this.#palettes[id]!;
    }
    return {
      enemy: screen.enemy,
      player: screen.player,
      ramps,
      objects: screen.objects,
      palettes: screen.palettes,
      origin: screen.origin,
    };
  }
}

/** One emulator frame of a battle, or nulls outside one. */
export interface BattleFrame {
  state: BattleState | null;
  screen: BattleScreen | null;
  /** For the HD battle layer; null outside a battle. */
  view: BattleView | null;
  /** For the layout; undefined outside a battle. */
  scene: BattleScene | undefined;
}

/**
 * Follows battles frame by frame for the game page. The battle screen's ~3.8 KB of video memory
 * is only watched while a battle is on: `watch` is called with the watches to use whenever that
 * changes, starting with `base` plus the battle state.
 */
export class BattleTracker {
  readonly #decoder = new BattleDecoder();
  readonly #reader = new BattleScreenReader();
  readonly #colours: BattleColours;
  readonly #watch: (watches: Record<string, Watch>) => void;
  readonly #base: Record<string, Watch>;
  #watching = false;
  /** The battle screen has shown since the battle began: anything else now is a menu. */
  #seen = false;

  constructor(rom: Uint8Array, base: Record<string, Watch>, watch: (watches: Record<string, Watch>) => void) {
    this.#colours = new BattleColours(rom);
    this.#base = base;
    this.#watch = watch;
    watch(base);
  }

  frame(watched: Record<string, Uint8Array>): BattleFrame {
    const state = this.#decoder.decode(watched as BattleWatched);
    if (!state) {
      if (this.#watching) {
        this.#watching = false;
        this.#watch(this.#base);
        this.#reader.reset();
        this.#colours.reset();
        this.#seen = false;
      }
      return { state, screen: null, view: null, scene: undefined };
    }
    if (!this.#watching) {
      this.#watching = true;
      this.#watch({ ...this.#base, ...BATTLE_SCREEN_WATCHES });
    }
    // The first frame or so, until the extra watches arrive.
    if (!watched["picTiles"]) return { state, screen: null, view: null, scene: "transition" };
    const screen = this.#reader.read(watched as BattleScreenWatched);
    if (screen.battle) this.#seen = true;
    const scene: BattleScene = screen.battle ? "scene" : this.#seen ? "menu" : "transition";
    return { state, screen, view: this.#colours.view(state, screen), scene };
  }
}

/**
 * Clears the Game Boy screen's pixels everywhere but text and menus (CELL_UI cells), so it can
 * sit over the HD battle. `data` is the 160×144 RGBA frame.
 */
export function maskBattleScreen(data: Uint8ClampedArray, screen: BattleScreen): void {
  const { x: ox, y: oy } = screen.origin;
  for (let y = 0; y < 144; y++) {
    const row = Math.floor((y - oy) / 8);
    for (let x = 0; x < 160; x++) {
      const col = Math.floor((x - ox) / 8);
      const inside = row >= 0 && row < 18 && col >= 0 && col < 20;
      if (inside && screen.cells[row * 20 + col] === CELL_UI) continue;
      data[(y * 160 + x) * 4 + 3] = 0;
    }
  }
}

/** The HP bar's width in the game, in pixels, and the colour thresholds GetHealthBarColor uses. */
const BAR_PIXELS = 48;
const GREEN_FROM = 27;
const YELLOW_FROM = 10;

/** The HP bar's colour, as the game picks it. */
export function barColour(hp: number, maxHp: number): "green" | "yellow" | "red" {
  const pixels = maxHp > 0 ? Math.floor((hp * BAR_PIXELS) / maxHp) : 0;
  return pixels >= GREEN_FROM ? "green" : pixels >= YELLOW_FROM ? "yellow" : "red";
}
