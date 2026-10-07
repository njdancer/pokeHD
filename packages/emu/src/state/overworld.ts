// The overworld as the game sees it, decoded from WRAM after each frame. This is the contract
// between the emulator (Track B) and the live world renderer (Track D). Field meanings come from
// vendor/pokered: ram/wram.asm (wSpriteStateData1/2), constants/map_object_constants.asm and
// home/overworld.asm (AdvancePlayerSprite).
import { SYMBOLS } from "@pokehd/rom";
import type { Watch } from "../protocol.ts";

export type Facing = "down" | "up" | "left" | "right";

/**
 * What the game is showing. `dialog` is the overworld with the window layer over it (text boxes,
 * the start menu); `battle` covers the whole battle including its transitions in and out.
 */
export type OverworldMode = "overworld" | "dialog" | "battle";

/** A step in progress, in step cells (16 px, 2×2 tiles). */
export interface Step {
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
  /**
   * How far through the step the actor is, in (0, 1). The game moves in whole pixels, so this
   * comes in steps of 1/8 for the player (1/4 on the bike) and 1/16 for NPCs.
   */
  progress: number;
}

/**
 * Something that walks the grid. Position is in step cells with (0, 0) at the map's top-left,
 * the same units as wXCoord/wYCoord. While walking, `x`/`y` is the cell being left, so the
 * drawn position is `x + step.dx * step.progress` (the game itself updates the player's
 * coordinates at the end of a step and NPCs' at the start; the decoder hides that difference).
 * Coordinates are signed: they can briefly fall outside the map at a connection.
 */
export interface Actor {
  x: number;
  y: number;
  facing: Facing;
  /** The step being taken, or null when standing still. */
  step: Step | null;
  /**
   * Walk cycle frame, 0–3 (SPRITESTATEDATA1_ANIMFRAMECOUNTER): 0 and 2 stand, 1 and 3 are the
   * two stride poses. Advances every 4 updates while walking.
   */
  animFrame: 0 | 1 | 2 | 3;
}

export type Transport = "walk" | "bike" | "surf";

export interface Player extends Actor {
  /** wWalkBikeSurfState; picks the player's sprite sheet. */
  transport: Transport;
}

export interface Npc extends Actor {
  /** Sprite slot on this map, 1–15 (slot 0 is the player). Stable while the map is loaded. */
  slot: number;
  /** SPRITE_* constant (constants/sprite_constants.asm), the index into SpriteSheetPointerTable. */
  pictureId: number;
  /**
   * False when the object is toggled off (an item already picked up, a character who has left).
   * Being off screen doesn't make an NPC invisible: the renderer draws the whole map.
   */
  visible: boolean;
}

export interface OverworldState {
  mode: OverworldMode;
  /** wCurMap; also the index into MAP_NAMES and the map headers. */
  mapId: number;
  player: Player;
  /** The current map's NPC slots that hold a sprite, in slot order. */
  npcs: Npc[];
  /**
   * Screen fade from the palette registers: 0 normal, 1 fully black, -1 fully white, with the
   * game's fade steps in between (thirds). Door and route warps fade to black (D16's
   * `wrapToMorning` hides in there); some animations (Fly, Teleport) fade to white.
   */
  fade: number;
  /** The raw palette registers, for anything finer than `fade`. */
  palettes: { bgp: number; obp0: number; obp1: number };
}

const at = (address: number, length = 1): Watch => [address, length];
const sym = (name: keyof typeof SYMBOLS, length = 1): Watch => at(SYMBOLS[name].address, length);

const SPRITE_STATE_SIZE = 16 * 0x10;
/** wToggleableObjectList: up to 16 (slot, object index) pairs plus the $ff terminator. */
const TOGGLEABLE_LIST_SIZE = 16 * 2 + 1;
/** wToggleableObjectFlags: one bit per object index, $100 of them. */
const TOGGLEABLE_FLAGS_SIZE = 0x100 / 8;
const rBGP = 0xff47;

/**
 * The memory `decodeOverworldState` reads, to pass to `EmulatorHost.watch` (or read with
 * `GameBoy.readBytes` in Node). About 600 bytes a frame.
 */
export const OVERWORLD_WATCHES = {
  map: sym("wCurMap"),
  /** wYCoord, wXCoord (adjacent). */
  coords: sym("wYCoord", 2),
  walkCounter: sym("wWalkCounter"),
  transport: sym("wWalkBikeSurfState"),
  inBattle: sym("wIsInBattle"),
  /** The game's copy of rWY; the window is on screen when it's below 144. */
  windowY: sym("hWY"),
  numSprites: sym("wNumSprites"),
  sprites1: sym("wSpriteStateData1", SPRITE_STATE_SIZE),
  sprites2: sym("wSpriteStateData2", SPRITE_STATE_SIZE),
  toggleableList: sym("wToggleableObjectList", TOGGLEABLE_LIST_SIZE),
  toggleableFlags: sym("wToggleableObjectFlags", TOGGLEABLE_FLAGS_SIZE),
  /** rBGP, rOBP0, rOBP1. */
  palettes: at(rBGP, 3),
} as const satisfies Record<string, Watch>;

export type OverworldWatchName = keyof typeof OVERWORLD_WATCHES;

/** The bytes `EmulatorHost` delivers in `FrameMessage.watched` for `OVERWORLD_WATCHES`. */
export type OverworldWatched = Record<OverworldWatchName, Uint8Array>;
