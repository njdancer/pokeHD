// Turns what the emulator reports during a battle into what the HD battle layer draws: the
// battle screen's pictures and sprites, coloured with each side's SGB palette (p2-battles).
import {
  BATTLE_SCREEN_WATCHES, BattleDecoder, BattleScreenReader, CELL_SCENE, CELL_UI, EVOLUTION_WATCHES, EvolutionReader, battleTransition, evolutionShown,
  type BattleScreen, type BattleScreenWatched, type BattleState, type BattleWatched, type EvolutionScreen, type EvolutionWatched, type ScreenText, type TextBox,
  type TextWatched, type Watch,
} from "@pokehd/emu";
import type { BattleView, Side } from "@pokehd/engine/battle";
import { battlePalette, pokedexNumber, readSgbPalettes, SGB_PAL, type SgbPalette } from "@pokehd/rom";
import { fanFrame } from "../colour/fan-set.ts";
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

  /**
   * The evolution screen's view: the Pokémon alone, in its species' palette, or PAL_BLACK's
   * while it swaps (EvolveMon), as the Super Game Boy shows it.
   */
  evolution(evo: EvolutionScreen, lcd: Uint8Array | undefined): BattleView {
    const ramp = this.#palettes[evo.silhouette ? SGB_PAL.BLACK : battlePalette(this.#rom, evo.species)]!;
    const art = evo.silhouette ? null : mirroredFan(pokedexNumber(this.#rom, evo.species));
    return {
      enemy: null,
      player: null,
      ramps: { player: ramp, enemy: ramp },
      objects: [],
      palettes: registers(lcd),
      origin: { x: 0, y: 0 },
      evolving: { pixels: evo.pixels, version: evo.version, ramp, art },
    };
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
    const art: BattleView["art"] = {};
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
      // The hand-coloured front pictures (D43): only the opponent's Pokémon faces us, and a
      // transformed one shows someone else's picture.
      if (side === "enemy" && !this.#trainer[side] && mon && !mon.transformed) art[side] = fanFrame(pokedexNumber(this.#rom, mon.species));
    }
    return {
      enemy: screen.enemy,
      player: screen.player,
      ramps,
      objects: screen.objects,
      palettes: screen.palettes,
      origin: screen.origin,
      art,
    };
  }
}

/** rBGP, rOBP0 and rOBP1 from the LCD registers (rLCDC on), or as they are outside fades and flashes. */
function registers(lcd: Uint8Array | undefined): [number, number, number] {
  return lcd ? [lcd[7] ?? NORMAL_BGP, lcd[8] ?? 0, lcd[9] ?? 0] : [NORMAL_BGP, 0, 0];
}
const NORMAL_BGP = 0b11100100;

const mirrored = new Map<number, Uint8ClampedArray | null>();
/** The hand-coloured picture mirrored, as EvolveMon draws its pictures (LoadFlippedFrontSpriteByMonIndex). */
function mirroredFan(dex: number): Uint8ClampedArray | null {
  const frame = fanFrame(dex);
  if (!frame) return null;
  let out = mirrored.get(dex);
  if (out !== undefined) return out;
  out = new Uint8ClampedArray(frame.length);
  for (let y = 0; y < 56; y++) for (let x = 0; x < 56; x++) out.set(frame.subarray((y * 56 + x) * 4, (y * 56 + x) * 4 + 4), (y * 56 + 55 - x) * 4);
  mirrored.set(dex, out);
  return out;
}

/**
 * The evolution screen as a battle screen, for the text decoder and the mask: the picture rows
 * are the scene (staged in HD), the text box rows are text.
 */
const EVOLUTION_CELLS = new Uint8Array(20 * 18).fill(CELL_UI).fill(CELL_SCENE, 0, 12 * 20);
function evolutionScreen(lcd: Uint8Array | undefined): BattleScreen {
  return {
    battle: true,
    enemy: null,
    player: null,
    objects: [],
    cells: EVOLUTION_CELLS,
    huds: { player: false, enemy: false },
    palettes: registers(lcd),
    origin: { x: 0, y: 0 },
  };
}

/** One emulator frame of a battle, or nulls outside one. */
export interface BattleFrame {
  state: BattleState | null;
  screen: BattleScreen | null;
  /** For the HD battle layer; null outside a battle. */
  view: BattleView | null;
  /**
   * Which HUDs the HD cards stand in for: the screen's, held through a frame or two the game
   * spends redrawing one (opening the move menu clears the area before its box is drawn).
   */
  huds: BattleScreen["huds"] | null;
  /**
   * For the layout; undefined outside a battle. `transition` also covers the moments either side
   * of one, while wIsInBattle is still 0 (see `battleTransition`). `evolution` is the evolution
   * screen, after a battle or not (an evolution stone): `screen` and `view` stage it in HD.
   */
  scene: BattleScene | undefined;
  /** What the evolution screen shows, once its watches are in. */
  evolution?: EvolutionScreen;
}

/** Frames a HUD may be missing before its HD card goes. */
const HUD_HOLD_FRAMES = 2;

/**
 * Follows battles frame by frame for the game page. The battle screen's ~3.8 KB of video memory
 * is only watched while a battle is on: `watch` is called with the watches to use whenever that
 * changes, starting with `base` plus the battle state.
 */
export class BattleTracker {
  readonly #decoder = new BattleDecoder();
  readonly #reader = new BattleScreenReader();
  readonly #evolution = new EvolutionReader();
  readonly #colours: BattleColours;
  readonly #watch: (watches: Record<string, Watch>) => void;
  readonly #base: Record<string, Watch>;
  /** The battle screen's watches are on: in a battle, or on the evolution screen. */
  #watching = false;
  #inBattle = false;
  /** The battle screen has shown since the battle began: anything else now is a menu. */
  #seen = false;
  /** Frames since each HUD was last on screen. */
  #hudGone: Record<Side, number> = { player: Infinity, enemy: Infinity };

  /** `base` must include the tile map (TEXT_WATCHES): the evolution screen is spotted from it. */
  constructor(rom: Uint8Array, base: Record<string, Watch>, watch: (watches: Record<string, Watch>) => void) {
    this.#colours = new BattleColours(rom);
    this.#base = base;
    this.#watch = watch;
    watch(base);
  }

  #setWatching(on: boolean): void {
    if (on === this.#watching) return;
    this.#watching = on;
    this.#watch(on ? { ...this.#base, ...BATTLE_SCREEN_WATCHES, ...EVOLUTION_WATCHES } : this.#base);
  }

  frame(watched: Record<string, Uint8Array>): BattleFrame {
    const state = this.#decoder.decode(watched as BattleWatched);
    const tileMap = watched["tileMap"];
    const evolving = tileMap ? evolutionShown(tileMap) !== null : false;
    this.#setWatching(!!state || evolving);
    if (state) this.#inBattle = true;
    else if (this.#inBattle) {
      this.#inBattle = false;
      this.#reader.reset();
      this.#colours.reset();
      this.#seen = false;
      this.#hudGone = { player: Infinity, enemy: Infinity };
    }

    // The evolution screen: the Pokémon alone in HD, its text in HD boxes (QA bug 27).
    if (evolving) {
      const lcd = watched["lcd"];
      const screen = evolutionScreen(lcd);
      // The first frame out of a battle, until the extra watches arrive: the screen stays down.
      if (!watched["picTiles"] || !watched["evoSpecies"]) return { state, screen, view: null, huds: null, scene: "evolution" };
      const evo = this.#evolution.read(watched as unknown as EvolutionWatched)!;
      return { state, screen, view: this.#colours.evolution(evo, lcd), huds: null, scene: "evolution", evolution: evo };
    }
    this.#evolution.reset();

    if (!state) {
      const between = battleTransition(watched as BattleWatched);
      return { state, screen: null, view: null, huds: null, scene: between ? "transition" : undefined };
    }
    // The first frame or so, until the extra watches arrive.
    if (!watched["picTiles"]) return { state, screen: null, view: null, huds: null, scene: "transition" };
    const screen = this.#reader.read(watched as BattleScreenWatched);
    if (screen.battle) this.#seen = true;
    const scene: BattleScene = screen.battle ? "scene" : this.#seen ? "menu" : "transition";
    for (const side of ["player", "enemy"] as const) this.#hudGone[side] = screen.huds[side] ? 0 : this.#hudGone[side] + 1;
    const huds = { player: this.#hudGone.player <= HUD_HOLD_FRAMES, enemy: this.#hudGone.enemy <= HUD_HOLD_FRAMES };
    return { state, screen, view: this.#colours.view(state, screen), huds, scene };
  }
}

/**
 * Clears the Game Boy screen's pixels everywhere but text and menus (CELL_UI cells), so it can
 * sit over the HD battle. `data` is the 160×144 RGBA frame. `covered` are boxes the HD text layer
 * draws instead, cleared too.
 */
export function maskBattleScreen(data: Uint8ClampedArray, screen: BattleScreen, covered: readonly TextBox[] = []): void {
  const { x: ox, y: oy } = screen.origin;
  const keep = uiCells(screen.cells, covered);
  for (let y = 0; y < 144; y++) {
    const row = Math.floor((y - oy) / 8);
    for (let x = 0; x < 160; x++) {
      const col = Math.floor((x - ox) / 8);
      const inside = row >= 0 && row < 18 && col >= 0 && col < 20;
      if (inside && keep[row * 20 + col]) continue;
      data[(y * 160 + x) * 4 + 3] = 0;
    }
  }
}

/** Per cell, 1 where the Game Boy screen still shows: text and menus not under `covered`. */
function uiCells(cells: Uint8Array, covered: readonly TextBox[]): Uint8Array {
  const keep = cells.map((c) => (c === CELL_UI ? 1 : 0));
  for (const b of covered) {
    for (let y = Math.max(b.y, 0); y < Math.min(b.y + b.height, 18); y++) {
      for (let x = Math.max(b.x, 0); x < Math.min(b.x + b.width, 20); x++) keep[y * 20 + x] = 0;
    }
  }
  return keep;
}

/** Where the move lists' boxes go: the turn's (over the message box), MIMIC's and an ETHER's. */
const MOVE_LISTS = [
  { x: 4, y: 12 },
  { x: 0, y: 7 },
  { x: 4, y: 7 },
];
const MOVE_LIST_SIZE = { width: 16, height: 6 };

/**
 * The battle's own menus are on screen: FIGHT / PKMN / ITEM / RUN (or the Safari Zone's) or a
 * move list. The HD battle menu answers them (BattleMenus), so these never show.
 */
export function battleMenuShown(text: ScreenText): boolean {
  return (
    text.menus.some((m) => m.kind === "battle") ||
    text.boxes.some((b) => b.lines.some((l) => l.text.includes("THROW ROCK"))) ||
    text.boxes.some((b) => b.width === MOVE_LIST_SIZE.width && b.height === MOVE_LIST_SIZE.height && MOVE_LISTS.some((at) => at.x === b.x && at.y === b.y))
  );
}

/** Blank, in the game's tile set (the space character). */
const BLANK_TILE = 0x7f;
/** hWY at the top: the window, and so the screen buffer, on screen. */
const ON_SCREEN = new Uint8Array([0]);

/**
 * The text decoder's bytes for the battle screen: everything but text and menus (CELL_UI cells)
 * blanked, so it reads the message box and menus and not the HUDs' names and levels (the HD cards
 * show those) or the pictures. The buffer counts as on screen: the battle screen was read from it,
 * even while the intro shows it through the background with the window down.
 */
export function battleText(watched: TextWatched, screen: BattleScreen): TextWatched {
  return {
    ...watched,
    tileMap: watched.tileMap.map((tile, i) => (screen.cells[i] === CELL_UI ? tile : BLANK_TILE)),
    windowY: ON_SCREEN,
  };
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
