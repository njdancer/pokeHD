// Turns what the emulator reports during a battle into what the HD battle layer draws: the
// battle screen's pictures and sprites, coloured with each side's SGB palette (p2-battles).
import {
  BATTLE_SCREEN_WATCHES, BattleDecoder, BattleScreenReader, CELL_SCENE, CELL_UI, EVOLUTION_WATCHES, EvolutionReader, battleTransition, evolutionShown,
  type BattleScreen, type BattleScreenWatched, type BattleState, type BattleWatched, type EvolutionScreen, type EvolutionWatched, type ScreenText, type TextBox,
  type DexOpened, type TextWatched, type Watch,
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
/** Longest the way out of a battle can wait for the game's white-out before it counts as over. */
const LEAVE_FRAMES = 120;
/** hWY at or below the screen's bottom: the window is down. */
const WINDOW_DOWN = 144;

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
  /**
   * Frames since the battle ended, while the game is still on its way out; null otherwise. EndOfBattle
   * clears wIsInBattle and wCurOpponent, then waits for the sound effect to finish
   * (WaitForSoundToFinish) with the battle's last frame still up, and only then whites it out and
   * returns to the overworld loop, which sets BIT_BATTLE_OVER_OR_BLACKOUT (`battleTransition`).
   * Between the two nothing says "battle", and the window over the last frame would bring the
   * Game Boy screen up for a few frames (QA bug 11).
   */
  #leaving: number | null = null;
  /** `battleTransition` has said "out" since the battle ended. */
  #outSeen = false;

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

  /** Whether the way out of the battle (see `#leaving`) still runs, this frame. */
  #stillLeaving(between: "in" | "out" | null, watched: Record<string, Uint8Array>): boolean {
    if (this.#leaving === null) return false;
    if (between === "out") this.#outSeen = true;
    const windowDown = (watched["windowY"]?.[0] ?? 0) >= WINDOW_DOWN;
    if (this.#outSeen || windowDown || ++this.#leaving > LEAVE_FRAMES) this.#leaving = null;
    return this.#leaving !== null;
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
      this.#leaving = 0;
      this.#outSeen = false;
    }
    if (state) this.#leaving = null;

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
      const leaving = this.#stillLeaving(between, watched);
      return { state, screen: null, view: null, huds: null, scene: between || leaving ? "transition" : undefined };
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

/** The whole screen, as a box: nothing of the Game Boy screen shows. */
const WHOLE_SCREEN: TextBox = { x: 0, y: 0, width: 20, height: 18, lines: [] };

/**
 * What `maskBattleScreen` clears beyond the scene and the HUDs. While the HD battle menu asks,
 * everything: the game's menu box is drawn over its message box's right side, so the message box
 * is no box the text decoder finds any more (its top-right corner is gone), and covering only the
 * boxes it does find left the message box's left eight columns, an empty bordered box, on screen
 * (QA bug 41). Otherwise the boxes the HD text layer draws, when it draws them.
 */
export function battleCovered(text: ScreenText, fits: boolean, choosing: boolean): readonly TextBox[] {
  return choosing ? [WHOLE_SCREEN] : fits ? text.boxes : [];
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
 * The turn's move list as the text decoder reads it: MoveSelectionMenu draws its box at (4, 12),
 * then puts a ─ and a ┘ over the box's top edge for PrintMenuItem's box above, so no box is found
 * there and the moves read as text outside any box, from column 6 on rows 13 to 16.
 */
const TURN_MOVES = { col: 6, from: 13, to: 16 };

/**
 * PrintMenuItem's box beside the turn's move list, at (0, 8): TYPE/, the move's type and its PP,
 * or "disabled!". It stays up under "No PP left for this move!" and "<move> is disabled!", and
 * runs into the message box below it (its bottom edge is the message box's top), so the decoder
 * reads it down to the screen's bottom.
 */
export function isMoveInfo(box: TextBox): boolean {
  return box.x === 0 && box.y === 8 && box.lines.some((l) => l.text.startsWith("TYPE/") || l.text === "disabled!");
}

/**
 * The battle's own menus are on screen: FIGHT / PKMN / ITEM / RUN (or the Safari Zone's) or a
 * move list. The HD battle menu answers them (BattleMenus), so these never show. The turn's move
 * list counts while the game draws it either side of its question (after a move is chosen from
 * the HD menu, and again after "No PP left for this move!"), until a message goes up in its place
 * (QA bug 46).
 */
export function battleMenuShown(text: ScreenText): boolean {
  return (
    text.menus.some((m) => m.kind === "battle") ||
    text.boxes.some((b) => b.lines.some((l) => l.text.includes("THROW ROCK") || /^FIGHT\s+PKMN$/.test(l.text))) ||
    text.boxes.some((b) => b.width === MOVE_LIST_SIZE.width && b.height === MOVE_LIST_SIZE.height && MOVE_LISTS.some((at) => at.x === b.x && at.y === b.y)) ||
    (!text.dialog && (text.boxes.some(isMoveInfo) || text.loose.some((l) => l.col === TURN_MOVES.col && l.row >= TURN_MOVES.from && l.row <= TURN_MOVES.to)))
  );
}

/**
 * Frames with nothing to read that the Game Boy screen stays covered after an answer, at most.
 * Messages in between don't count.
 */
const ANSWER_HOLD_FRAMES = 120;

/** Words on the battle screen to read (a message, the stats box), other than the move's TYPE box. */
function readable(text: ScreenText): boolean {
  return (
    !!text.dialog?.lines.some((l) => l.trim() !== "") ||
    text.boxes.some((b) => !isMoveInfo(b) && b.lines.some((l) => l.text.trim() !== ""))
  );
}

/**
 * Whether the HD battle menu covers the Game Boy screen (`maskBattleScreen` with `battleCovered`'s
 * whole screen): while the game asks, while its own menus are drawn (`battleMenuShown`), and from
 * an answer to the next question whenever there is nothing to read. In between the game clears
 * the menu's area before it draws the move list, and after "No PP left for this move!" it puts
 * back the screen it saved (LoadScreenTilesFromBuffer1) before drawing the list again: a blank,
 * white message box over the HD battle, with the old menu still in video memory for a frame or
 * two, which no reading of the text tells from a turn's empty message box (QA bug 51). Messages
 * show as ever. The next question, leaving the battle screen or a long while with nothing to
 * read (ANSWER_HOLD_FRAMES) ends it.
 */
export class BattleMenuCover {
  #held = 0;

  /** The page answered the battle menu. */
  answered(): void {
    this.#held = ANSWER_HOLD_FRAMES;
  }

  /** Per frame: `onScreen` is the battle screen's text, null off the battle screen. */
  covering(onScreen: ScreenText | null, asking: boolean): boolean {
    if (!onScreen || asking) this.#held = 0;
    if (!onScreen) return false;
    if (asking || battleMenuShown(onScreen)) return true;
    if (this.#held === 0 || readable(onScreen)) return false;
    this.#held--;
    return true;
  }
}

/**
 * The battle screen's text as the HD text layer shows it: without the move's TYPE box, which the
 * HD menu shows in its own way. Under "No PP left for this move!" only the message is drawn (QA
 * bug 46); `battleCovered` takes the screen's own text, so the Game Boy's TYPE box is masked too.
 */
export function battleTextShown(text: ScreenText): ScreenText {
  return text.boxes.some(isMoveInfo) ? { ...text, boxes: text.boxes.filter((b) => !isMoveInfo(b)) } : text;
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

/** Longest an item used in a battle keeps the Game Boy screen behind the HD battle, with nothing to read (10 s). */
const ITEM_USE_FRAMES = 600;

/**
 * An item used on a Pokémon in a battle (a POTION from the bag, QA bug 55). The page chose the
 * item and the Pokémon (GameAsks' sheets: the game's own party menu is never drawn), then the
 * game's ItemUseMedicine counts the HP up where the party menu would have it, over the battle
 * screen (the numbers land on the opponent's HUD), or redraws a party menu it never set up (rows
 * of "Lv0 FNT 0/C80"), and says "GEODUDE recovered by 20!". None of that is the battle: from the
 * answer until the battle screen is back, the Game Boy screen stays behind the HD battle and only
 * the message shows, in HD (`partyScreenMessage`), read on with a tap like any other.
 *
 * It ends once the message has been read and both HUDs are back, at the battle menu's next
 * question, with the battle, or after ITEM_USE_FRAMES with nothing to read.
 */
export class BattleItemUse {
  #on = false;
  #frames = 0;
  #told = false;

  /** An item's screens may be up (`using` decides). */
  get active(): boolean {
    return this.#on;
  }

  /** The page answered one of the game's questions (`answer` null for cancelled). */
  answered(ask: { kind: string; purpose?: string; inBattle?: boolean }, answer: unknown): void {
    this.#on = ask.kind === "party" && ask.purpose === "item" && ask.inBattle === true && answer !== null;
    this.#frames = 0;
    this.#told = false;
  }

  /**
   * Per frame: whether the item's screens are up. `fight` is the BattleTracker's frame, `text`
   * the whole Game Boy screen's, `asking` whether the HD battle menu is up.
   */
  using(fight: Pick<BattleFrame, "state" | "scene" | "huds">, text: ScreenText, asking: boolean): boolean {
    if (!this.#on) return false;
    const words = !!text.dialog?.lines.some((l) => l.trim() !== "");
    if (words) this.#told = true;
    else this.#frames++;
    const back = this.#told && !words && fight.scene === "scene" && !!fight.huds?.player && !!fight.huds.enemy;
    if (!fight.state || asking || back || this.#frames > ITEM_USE_FRAMES) this.#on = false;
    return this.#on;
  }
}

/** Longest the Game Boy screen stays behind the HD battle after the Pokédex page, with nothing to read (5 s). */
const DEX_PAGE_AFTER_FRAMES = 300;

/**
 * A Pokémon's Pokédex page after a catch (QA bug 68). ItemUseBall says "New POKéDEX data will be
 * added for SPEAROW!", then ShowPokedexData whites the screen out, clears it and draws the
 * Pokémon's page in place of the battle, waiting for A or B. The page shows its own entry for it
 * (DexGuard's `onOpen`, the Pokédex menu on the Pokémon's page) and the game's waits behind it;
 * once the player shuts the HD one the game leaves its page (GBPalWhiteOut, ClearScreen) and asks
 * "Do you want to give a nickname to SPEAROW?" over the cleared screen. None of that is the
 * battle: from the page opening until the game asks (or the battle screen is back), the Game Boy
 * screen stays behind the HD battle, and only a message shows, in HD (`partyScreenMessage`).
 *
 * Only for a page the HD Pokédex shows (`opened`): with the HD Pokédex off, the game's own page is
 * all there is. It ends at a question (the nickname's sheet, the battle menu), with the battle
 * screen back or the battle over, or DEX_PAGE_AFTER_FRAMES after the page with nothing to read.
 */
export class BattleDexPage {
  #on = false;
  #left = false;
  #frames = 0;

  /** The game's Pokédex page may be up, or the screens after it (`showing` decides). */
  get active(): boolean {
    return this.#on;
  }

  /** The game's page is still up behind the HD Pokédex: nothing on it is for the HD text layer. */
  get onPage(): boolean {
    return this.#on && !this.#left;
  }

  /** In a battle, the game opened a Pokémon's Pokédex page and the page shows its own over it. */
  opened(): void {
    this.#on = true;
    this.#left = false;
    this.#frames = 0;
  }

  /** The game has left its Pokédex page (DexGuard's `onClosed`). */
  closed(): void {
    if (this.#on) this.#left = true;
  }

  /**
   * Per frame: whether the page, or what follows it, is up. `fight` is the BattleTracker's frame,
   * `text` the whole Game Boy screen's, `asking` whether one of the game's questions is up (the
   * HD battle menu or a sheet).
   */
  showing(fight: Pick<BattleFrame, "state" | "scene">, text: ScreenText, asking: boolean): boolean {
    if (!this.#on) return false;
    if (!fight.state) this.#on = false;
    else if (this.#left) {
      const words = !!text.dialog?.lines.some((l) => l.trim() !== "");
      if (!words) this.#frames++;
      if (asking || fight.scene === "scene" || this.#frames > DEX_PAGE_AFTER_FRAMES) this.#on = false;
    }
    return this.#on;
  }
}

/**
 * Where the Pokédex menu opens when the game opens its own Pokédex (DexGuard): the Pokémon tab's
 * list, or the Pokémon's page the game waits on (after a catch, QA bugs 68 and 73), where backing
 * out shuts the menu so one tap goes on (to the nickname). A DexMenu `start`.
 */
export function dexMenuStart(rom: Uint8Array, opened: DexOpened): { tab: "dex"; screen?: { k: "entry"; dex: number }; backCloses?: true } {
  const dex = opened.kind === "data" ? pokedexNumber(rom, opened.species) : 0;
  return dex ? { tab: "dex", screen: { k: "entry", dex }, backCloses: true } : { tab: "dex" };
}

/** The party screen's message alone ("GEODUDE recovered by 20!"), for the HD text layer. */
export function partyScreenMessage(text: ScreenText): ScreenText {
  return { ...text, boxes: text.dialog ? [text.dialog.box] : [], menus: [], quantity: null, loose: [], pictures: false };
}
