// A battle as the game sees it, decoded from WRAM after each frame: the data side of the battle
// renderer (p2-battles). Field meanings come from vendor/pokered: ram/wram.asm (battle_struct and
// party_struct in macros/ram.asm), engine/battle/core.asm and engine/battle/animations.asm.
import { SYMBOLS } from "@pokehd/rom";
import type { Watch } from "../protocol.ts";

export type BattleType = "wild" | "trainer" | "link";

/**
 * Where the battle is, from the game's point of view:
 * - `intro`: from the first frame of the transition until both first Pokémon are out.
 * - `animation`: a battle animation is playing (a move, a status effect, a ball toss); see
 *   `BattleState.animation`.
 * - `menu`: the game is waiting for the player to choose (the battle menu, the move list, a
 *   yes/no prompt, the party or bag).
 * - `faint`: a Pokémon on the field is at 0 HP and the battle isn't decided yet.
 * - `end`: the battle is decided (`outcome` is set): the last faint, the victory or defeat
 *   text, experience, evolution.
 * - `message`: anything else, mostly text such as "BULBASAUR used TACKLE!".
 */
export type BattlePhase = "intro" | "animation" | "menu" | "faint" | "end" | "message";

export type BattleOutcome = "win" | "lose" | "escaped";

export type MonStatus = "ok" | "sleep" | "poison" | "burn" | "freeze" | "paralysis";

/** A party slot as the intro's Poké Ball row shows it. */
export type TeamSlot = "ok" | "status" | "fainted";

/** The Pokémon one side has on the field (`battle_struct`). */
export interface BattleMon {
  /** The ROM's internal species index (constants/pokemon_constants.asm), not the Pokédex number. */
  species: number;
  level: number;
  hp: number;
  maxHp: number;
  status: MonStatus;
  /** Type constants (constants/type_constants.asm); both the same for a single-typed Pokémon. */
  types: [number, number];
  /** Move IDs, 0 for an empty slot. */
  moves: [number, number, number, number];
  /** The name the game shows: the nickname, or the species name for an enemy. */
  name: string;
  /** Transformed (TRANSFORM): the game colours it like Ditto. */
  transformed: boolean;
}

export interface BattleSide {
  /**
   * The Pokémon on the field, or null when the slot is empty. During `intro` this can still hold
   * the previous battle's Pokémon until this side sends one out (the send-out shows as a
   * `POOF_ANIM` animation).
   */
  mon: BattleMon | null;
  /** The side's party in order. Empty for a wild Pokémon, which has no party. */
  team: TeamSlot[];
}

export interface BattleAnimation {
  /**
   * wAnimationID: a move ID (1–165) or a special animation after them (constants/move_constants.asm,
   * from SHOWPIC_ANIM: send-out puffs, ball tosses, status effects, screen shakes).
   */
  id: number;
  /** True for a move's own animation, false for the special ones. */
  isMove: boolean;
  /** Who's acting: hWhoseTurn while it plays. */
  by: "player" | "enemy";
}

/**
 * Where the battle takes place, for choosing an arena. The game has no battle backgrounds, so
 * this is the overworld context it was entered from.
 */
export interface BattleArena {
  /** wCurMap (MAP_NAMES). */
  mapId: number;
  /** wCurMapTileset (TILESET_NAMES): forest, cave, gym and so on. */
  tileset: number;
  /** The player was surfing, so a wild encounter came from the water. */
  onWater: boolean;
}

export interface BattleState {
  type: BattleType;
  /** wBattleType: an ordinary battle, the Old Man's catching demo, or the Safari Zone. */
  variant: "normal" | "old-man" | "safari";
  phase: BattlePhase;
  /** Set once the battle is decided, through `end`. */
  outcome: BattleOutcome | null;
  /** The trainer class (constants/trainer_constants.asm) in a trainer battle, else null. */
  trainerClass: number | null;
  player: BattleSide;
  enemy: BattleSide;
  /** The animation playing, or null. It can play in `intro` and `end` too. */
  animation: BattleAnimation | null;
  /** hWhoseTurn: whose move is being carried out. */
  turn: "player" | "enemy";
  arena: BattleArena;
}

const at = (address: number, length = 1): Watch => [address, length];
const sym = (name: keyof typeof SYMBOLS, length = 1): Watch => at(SYMBOLS[name].address, length);

/** battle_struct, from wBattleMon / wEnemyMon. */
export const BATTLE_STRUCT_LENGTH = 0x1d;
/** PARTY_LENGTH */
export const PARTY_LENGTH = 6;
/** party_struct */
export const PARTY_MON_LENGTH = 44;
/** wPartyCount, wPartySpecies (with its terminator) and wPartyMons, which are adjacent. */
const PARTY_BLOCK_LENGTH = 1 + PARTY_LENGTH + 1 + PARTY_LENGTH * PARTY_MON_LENGTH;
/** NAME_LENGTH: a name and its terminator. */
const NAME_LENGTH = 11;
/** wTileMap, the 20×18 screen buffer the game draws its menus into. */
export const TILE_MAP_LENGTH = 20 * 18;

/**
 * The memory `decodeBattleState` reads, to pass to `EmulatorHost.watch` alongside
 * `OVERWORLD_WATCHES`. About 980 bytes a frame, most of it the two parties and the tile map.
 */
export const BATTLE_WATCHES = {
  /** 0 none, 1 wild, 2 trainer, $ff lost. */
  inBattle: sym("wIsInBattle"),
  linkState: sym("wLinkState"),
  battleType: sym("wBattleType"),
  /** A wild Pokémon's species, or OPP_ID_OFFSET (200) + a trainer class. */
  opponent: sym("wCurOpponent"),
  firstMonsNotOutYet: sym("wFirstMonsNotOutYet"),
  escaped: sym("wEscapedFromBattle"),
  whoseTurn: sym("hWhoseTurn"),
  animationId: sym("wAnimationID"),
  /** The sound of the animation command playing; $ff once an animation has finished. */
  animationSound: sym("wAnimSoundID"),
  /** Low byte of the subanimation pointer; zeroed once an animation has finished. */
  subanimation: sym("wSubAnimSubEntryAddr"),
  playerMon: sym("wBattleMon", BATTLE_STRUCT_LENGTH),
  enemyMon: sym("wEnemyMon", BATTLE_STRUCT_LENGTH),
  playerName: sym("wBattleMonNick", NAME_LENGTH),
  enemyName: sym("wEnemyMonNick", NAME_LENGTH),
  playerStatus3: sym("wPlayerBattleStatus3"),
  enemyStatus3: sym("wEnemyBattleStatus3"),
  playerParty: sym("wPartyCount", PARTY_BLOCK_LENGTH),
  enemyParty: sym("wEnemyPartyCount", PARTY_BLOCK_LENGTH),
  tileMap: sym("wTileMap", TILE_MAP_LENGTH),
  map: sym("wCurMap"),
  tileset: sym("wCurMapTileset"),
  transport: sym("wWalkBikeSurfState"),
} as const satisfies Record<string, Watch>;

export type BattleWatchName = keyof typeof BATTLE_WATCHES;

/** The bytes `EmulatorHost` delivers in `FrameMessage.watched` for `BATTLE_WATCHES`. */
export type BattleWatched = Record<BattleWatchName, Uint8Array>;
