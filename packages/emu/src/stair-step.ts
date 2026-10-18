// Diagonals walk as a staircase. The game walks in four directions and reads two held ones by
// priority (Down, Up, Left, Right), so a thumbstick held between Down and Right only ever walked
// down. Instead, where the overworld loop reads the pad between steps, a diagonal is narrowed to
// one direction: the one the last step didn't take, if the tile that way is open, else the
// other. Along a fence the step into the fence is skipped until the gap, and the player steps
// straight through it; in the open the player zigzags the way the stick points.
//
// "Open" asks what the game's own collision checks would answer (CollisionCheckOnLand and
// CollisionCheckOnWater) without running them: they face the player that way and play the bump
// sound. So a closed way is never tried and the player never turns to bump a wall it wasn't
// pushed straight at. Only the pad the loop reads changes; the step itself is the game's.
import { SYMBOLS, type SymbolName } from "@pokehd/rom";
import { Button, type GameBoy } from "./core.ts";

const VERTICAL = Button.Up | Button.Down;
const HORIZONTAL = Button.Left | Button.Right;

const read = (gb: GameBoy, name: SymbolName) => gb.read(SYMBOLS[name].address);

/** wStatusFlags5 bit 7: the game is walking the player (BIT_SCRIPTED_MOVEMENT_STATE). */
const SCRIPTED_MOVEMENT = 1 << 7;
/** wMovementFlags bit 6: jumping a ledge or fishing (BIT_LEDGE_OR_FISHING). */
const LEDGE_OR_FISHING = 1 << 6;
const SURFING = 2;
const SHIP_PORT = 14;
/** Water the player keeps surfing onto (CollisionCheckOnWater); 0x32 is a coast except at the port. */
const WATER = 0x14;
const SAFARI_COAST = 0x48;
const EAST_COAST = 0x32;

/** wTileMap is 20 tiles wide; the player stands on (8, 9) and a step is two tiles. */
const SCREEN_WIDTH = 20;
const STANDING = [8, 9] as const;
/** Per direction: the tile in front (GetTileAndCoordsInFrontOfPlayer), its PLAYER_DIR bit, and the pixel offset of a sprite there. */
const AHEAD: Record<number, { tile: readonly [number, number]; dir: number; dy: number; dx: number }> = {
  [Button.Down]: { tile: [8, 11], dir: 1 << 2, dy: 16, dx: 0 },
  [Button.Up]: { tile: [8, 7], dir: 1 << 3, dy: -16, dx: 0 },
  [Button.Left]: { tile: [6, 9], dir: 1 << 1, dy: 0, dx: -16 },
  [Button.Right]: { tile: [10, 9], dir: 1 << 0, dy: 0, dx: 16 },
};
/** PLAYER_DIR values (wPlayerDirection) as buttons. */
const FROM_PLAYER_DIR: Record<number, number> = { 1: Button.Right, 2: Button.Left, 4: Button.Down, 8: Button.Up };
/** SPRITE_FACING values (wSpritePlayerStateData1FacingDirection) as buttons. */
const FROM_FACING: Record<number, number> = { 0x0: Button.Down, 0x4: Button.Up, 0x8: Button.Left, 0xc: Button.Right };
/** Where IsSpriteInFrontOfPlayer has the player's sprite, in screen pixels. */
const PLAYER_Y = 0x3c;
const PLAYER_X = 0x40;
const SPRITE_STATE_LENGTH = 16;

const tileAt = (gb: GameBoy, [x, y]: readonly [number, number]) => gb.read(SYMBOLS.wTileMap.address + y * SCREEN_WIDTH + x);

/** Whether a pair table (TilePairCollisionsLand or …Water: tileset, tile, tile; $ff ends) refuses a step between `a` and `b`. */
function pairRefuses(gb: GameBoy, table: SymbolName, a: number, b: number): boolean {
  const tileset = read(gb, "wCurMapTileset");
  for (let at = SYMBOLS[table].address; ; at += 3) {
    const set = gb.read(at);
    if (set === 0xff) return false;
    if (set !== tileset) continue;
    const [p, q] = [gb.read(at + 1), gb.read(at + 2)];
    if ((p === a && q === b) || (p === b && q === a)) return true;
  }
}

/** Whether the tileset's list of passable tiles (wTilesetCollisionPtr, in bank 0; $ff ends) has `tile`. */
function passable(gb: GameBoy, tile: number): boolean {
  const list = SYMBOLS.wTilesetCollisionPtr.address;
  for (let at = gb.read(list) | (gb.read(list + 1) << 8); ; at++) {
    const t = gb.read(at);
    if (t === 0xff) return false;
    if (t === tile) return true;
  }
}

/** Whether a visible sprite stands where a step `button`'s way would go (IsSpriteInFrontOfPlayer). */
function spriteAhead(gb: GameBoy, button: number): boolean {
  const { dy, dx } = AHEAD[button]!;
  const count = read(gb, "wNumSprites");
  for (let i = 1; i <= count; i++) {
    const base = SYMBOLS.wSpriteStateData1.address + i * SPRITE_STATE_LENGTH;
    if (gb.read(base) === 0 || gb.read(base + 2) === 0xff) continue;
    if (gb.read(base + 4) === PLAYER_Y + dy && gb.read(base + 6) === PLAYER_X + dx) return true;
  }
  return false;
}

/**
 * Whether the game would let the player step `button`'s way from here, on foot or bike, or
 * surfing on to more water. Ledges count as closed (their tiles aren't passable), and so does
 * stepping ashore: a diagonal never jumps a ledge or ends a surf by itself.
 */
export function stepOpen(gb: GameBoy, button: number): boolean {
  const ahead = AHEAD[button]!;
  if (read(gb, "wSpritePlayerStateData1CollisionData") & ahead.dir || spriteAhead(gb, button)) return false;
  const tile = tileAt(gb, ahead.tile);
  const standing = tileAt(gb, STANDING);
  if (read(gb, "wWalkBikeSurfState") === SURFING) {
    if (pairRefuses(gb, "TilePairCollisionsWater", standing, tile)) return false;
    return tile === WATER || tile === SAFARI_COAST || (tile === EAST_COAST && read(gb, "wCurMapTileset") !== SHIP_PORT);
  }
  return !pairRefuses(gb, "TilePairCollisionsLand", standing, tile) && passable(gb, tile);
}

/** Narrows held diagonals to one direction between overworld steps (see the top of this file). */
export class StairStep {
  readonly #remove: (() => void)[];
  /** The direction of the last step the player took (a button), 0 before the first. */
  #last = 0;

  constructor(gb: GameBoy) {
    this.#remove = [
      gb.addHook("OverworldLoopLessDelay.checkIfDownButtonIsPressed", (g) => this.#narrow(g)),
      // A step is starting: the way wPlayerDirection points.
      gb.addHook("OverworldLoopLessDelay.noCollision", (g) => {
        this.#last = FROM_PLAYER_DIR[read(g, "wPlayerDirection")] ?? 0;
      }),
    ];
  }

  dispose(): void {
    for (const remove of this.#remove) remove();
  }

  #narrow(gb: GameBoy): void {
    const held = read(gb, "hJoyHeld");
    const v = held & VERTICAL;
    const h = held & HORIZONTAL;
    // One way held (or a pad holding opposites, which the game reads by priority as ever).
    if (!v || !h || v === VERTICAL || h === HORIZONTAL) return;
    if (read(gb, "wStatusFlags5") & SCRIPTED_MOVEMENT || read(gb, "wMovementFlags") & LEDGE_OR_FISHING) return;
    if (read(gb, "wSimulatedJoypadStatesIndex")) return;
    // The way the last step didn't go first. With no step among the two yet, the way the player
    // faces first, so starting off needs no turn. This depends only on the last step, so a turn
    // (a frame on its own when starting from a stop) is followed by a step the same way.
    const facing = FROM_FACING[read(gb, "wSpritePlayerStateData1FacingDirection")] ?? 0;
    const first = this.#last === h ? v : this.#last === v ? h : facing === h ? h : v;
    const second = first === v ? h : v;
    // Both closed: push the way the player already faces (if it's one of them), so no turn.
    const way = stepOpen(gb, first) ? first : stepOpen(gb, second) ? second : facing === second ? second : first;
    gb.write(SYMBOLS.hJoyHeld.address, (held & ~(VERTICAL | HORIZONTAL)) | way);
  }
}
