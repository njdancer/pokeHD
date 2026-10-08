// Pure decoding of OVERWORLD_WATCHES bytes into an OverworldState. Offsets are the
// SPRITESTATEDATA1_*/SPRITESTATEDATA2_* constants in constants/map_object_constants.asm.
import type {
  Actor,
  Facing,
  Npc,
  OverworldMode,
  OverworldState,
  OverworldWatched,
  Step,
  Transport,
} from "./overworld.ts";

const SPRITE_SLOTS = 16;
const SPRITE_STRIDE = 0x10;

// wSpriteStateData1
const PICTUREID = 0x0;
const MOVEMENTSTATUS = 0x1;
const YSTEPVECTOR = 0x3;
const XSTEPVECTOR = 0x5;
const ANIMFRAMECOUNTER = 0x8;
const FACINGDIRECTION = 0x9;
// wSpriteStateData2
const WALKANIMATIONCOUNTER = 0x0;
const MAPY = 0x4;
const MAPX = 0x5;

/** SPRITESTATEDATA1_MOVEMENTSTATUS while an NPC is mid-step. */
const STATUS_MOVING = 3;
/** wWalkCounter starts here for each player step and counts down once per 2 px. */
const PLAYER_STEP_FRAMES = 8;
/** SPRITESTATEDATA2_WALKANIMATIONCOUNTER starts here for each NPC step, one per pixel. */
const NPC_STEP_FRAMES = 16;
/** wSpriteStateData2 map coordinates have the top-left step cell at 4. */
const NPC_MAP_ORIGIN = 4;
/** Window Y at or past the bottom of the screen means the window is hidden. */
const SCREEN_HEIGHT = 144;

const FACINGS: readonly Facing[] = ["down", "up", "left", "right"];
const TRANSPORTS: readonly Transport[] = ["walk", "bike", "surf"];

const signed = (byte: number) => (byte << 24) >> 24;
const byte = (bytes: Uint8Array, i: number) => bytes[i] ?? 0;
const unit = (value: number) => Math.sign(signed(value)) as -1 | 0 | 1;
const facing = (value: number): Facing => FACINGS[(value >> 2) & 3]!;

function stepFrom(dx: -1 | 0 | 1, dy: -1 | 0 | 1, progress: number): Step | null {
  return (dx !== 0 || dy !== 0) && progress > 0 && progress < 1 ? { dx, dy, progress } : null;
}

/**
 * Screen fade from a palette register: how far colour 0 (lightest) has been darkened, or
 * colour 3 (darkest) lightened, in thirds. 0 normal, 1 black, -1 white.
 */
export function fadeLevel(bgp: number): number {
  const shade0 = bgp & 3;
  const shade3 = (bgp >> 6) & 3;
  if (shade0 > 0) return shade0 / 3;
  return shade3 < 3 ? -(3 - shade3) / 3 : 0;
}

function isToggledOff(watched: OverworldWatched, slot: number): boolean {
  const list = watched.toggleableList;
  for (let i = 0; i + 1 < list.length; i += 2) {
    const entry = byte(list, i);
    if (entry === 0xff) return false;
    if (entry !== slot) continue;
    const index = byte(list, i + 1);
    return (byte(watched.toggleableFlags, index >> 3) & (1 << (index & 7))) !== 0;
  }
  return false;
}

function decodeNpc(watched: OverworldWatched, slot: number): Npc | null {
  const s1 = slot * SPRITE_STRIDE;
  const pictureId = byte(watched.sprites1, s1 + PICTUREID);
  if (pictureId === 0) return null;
  const mapX = signed(byte(watched.sprites2, s1 + MAPX)) - NPC_MAP_ORIGIN;
  const mapY = signed(byte(watched.sprites2, s1 + MAPY)) - NPC_MAP_ORIGIN;
  const dx = unit(byte(watched.sprites1, s1 + XSTEPVECTOR));
  const dy = unit(byte(watched.sprites1, s1 + YSTEPVECTOR));
  const counter = byte(watched.sprites2, s1 + WALKANIMATIONCOUNTER);
  const moving = (byte(watched.sprites1, s1 + MOVEMENTSTATUS) & 0x7f) === STATUS_MOVING && counter > 0;
  // NPC map coordinates already point at the destination for the whole step.
  const step = moving ? stepFrom(dx, dy, (NPC_STEP_FRAMES - counter) / NPC_STEP_FRAMES) : null;
  return {
    slot,
    pictureId,
    visible: !isToggledOff(watched, slot),
    ...actor(watched.sprites1, s1, step ? mapX - step.dx : mapX, step ? mapY - step.dy : mapY, step),
  };
}

function actor(sprites1: Uint8Array, s1: number, x: number, y: number, step: Step | null): Actor {
  return {
    x,
    y,
    facing: facing(byte(sprites1, s1 + FACINGDIRECTION)),
    step,
    animFrame: (byte(sprites1, s1 + ANIMFRAMECOUNTER) & 3) as Actor["animFrame"],
  };
}

function mode(watched: OverworldWatched): OverworldMode {
  if (byte(watched.inBattle, 0) !== 0) return "battle";
  if (byte(watched.windowY, 0) < SCREEN_HEIGHT) return "dialog";
  return "overworld";
}

/** Decodes one frame's `OVERWORLD_WATCHES` bytes. Pure; safe to call on recorded frames. */
export function decodeOverworldState(watched: OverworldWatched): OverworldState {
  const counter = byte(watched.walkCounter, 0);
  // The player's coordinates change on the step's last frame, so mid-step they're the cell
  // being left.
  const step =
    counter > 0
      ? stepFrom(
          unit(byte(watched.sprites1, XSTEPVECTOR)),
          unit(byte(watched.sprites1, YSTEPVECTOR)),
          (PLAYER_STEP_FRAMES - counter) / PLAYER_STEP_FRAMES,
        )
      : null;
  const y = signed(byte(watched.coords, 0));
  const x = signed(byte(watched.coords, 1));

  const numSprites = Math.min(byte(watched.numSprites, 0), SPRITE_SLOTS - 1);
  const npcs: Npc[] = [];
  for (let slot = 1; slot <= numSprites; slot++) {
    const npc = decodeNpc(watched, slot);
    if (npc) npcs.push(npc);
  }

  const [bgp = 0, obp0 = 0, obp1 = 0] = watched.palettes;
  return {
    mode: mode(watched),
    mapId: byte(watched.map, 0),
    lastMap: byte(watched.lastMap, 0),
    player: {
      ...actor(watched.sprites1, 0, x, y, step),
      transport: TRANSPORTS[byte(watched.transport, 0)] ?? "walk",
    },
    npcs,
    fade: fadeLevel(bgp),
    palettes: { bgp, obp0, obp1 },
  };
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Longest a warp holds the old map ID; the game's fade-out takes 32 frames. */
const MAX_WARP_HOLD_FRAMES = 90;

/**
 * Decodes frames in order and settles warps. On a door or stair warp the game writes wCurMap
 * before it fades out, while the old map is still on screen and the player's coordinates are
 * still the old map's. When wCurMap changes and wWarpedFromWhichMap names the map being left,
 * this keeps reporting the old ID until the screen is fully faded (black or white) or the new
 * map's header has loaded. Connections between outdoor maps switch at once.
 */
export class OverworldDecoder {
  #mapId: number | undefined;
  #hold: { header: Uint8Array; frames: number } | undefined;

  decode(watched: OverworldWatched): OverworldState {
    const state = decodeOverworldState(watched);
    if (this.#mapId === undefined || state.mapId === this.#mapId) {
      this.#mapId = state.mapId;
      this.#hold = undefined;
      return state;
    }
    if (!this.#hold) {
      if (byte(watched.warpedFrom, 0) !== this.#mapId) return this.#settle(state);
      this.#hold = { header: watched.mapHeader.slice(), frames: 0 };
    }
    const hold = this.#hold;
    if (Math.abs(state.fade) === 1 || !sameBytes(hold.header, watched.mapHeader) || ++hold.frames > MAX_WARP_HOLD_FRAMES) {
      return this.#settle(state);
    }
    return { ...state, mapId: this.#mapId };
  }

  #settle(state: OverworldState): OverworldState {
    this.#mapId = state.mapId;
    this.#hold = undefined;
    return state;
  }
}
