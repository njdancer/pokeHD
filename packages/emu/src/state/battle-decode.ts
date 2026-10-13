// Pure decoding of BATTLE_WATCHES bytes into a BattleState, plus BattleDecoder for the parts that
// need the frames before. Offsets are battle_struct and party_struct in macros/ram.asm.
import { decodeText } from "@pokehd/rom";
import {
  BATTLE_STRUCT_LENGTH,
  PARTY_LENGTH,
  PARTY_MON_LENGTH,
  type BattleMon,
  type BattleOutcome,
  type BattlePhase,
  type BattleSide,
  type BattleState,
  type BattleType,
  type BattleWatched,
  type MonStatus,
  type TeamSlot,
} from "./battle.ts";

// battle_struct
const SPECIES = 0;
const HP = 1;
const STATUS = 4;
const TYPE1 = 5;
const MOVES = 8;
const LEVEL = 14;
const MAX_HP = 15;
// party_struct, after wPartyCount and the species list
const PARTY_MONS = 1 + PARTY_LENGTH + 1;
const PARTY_HP = 1;
const PARTY_STATUS = 4;

/** wIsInBattle after the player has lost. */
const LOST_BATTLE = 0xff;
const LINK_STATE_BATTLING = 4;
/** wCurOpponent is this plus the trainer class in a trainer battle. */
const OPP_ID_OFFSET = 200;
/** The last move ID; animation IDs after it are special animations. */
const NUM_ATTACKS = 0xa5;
/** wAnimSoundID once an animation has finished ("NO_MOVE - 1"). */
const NO_ANIMATION = 0xff;
/** The filled menu cursor ▶; the game only draws it in the menu taking input. */
const MENU_CURSOR_TILE = 0xed;
const SURFING = 2;
/** wPlayerBattleStatus3 / wEnemyBattleStatus3 bit 3. */
const TRANSFORMED = 1 << 3;

const VARIANTS = ["normal", "old-man", "safari"] as const;

const byte = (bytes: Uint8Array, i: number) => bytes[i] ?? 0;
const word = (bytes: Uint8Array, i: number) => (byte(bytes, i) << 8) | byte(bytes, i + 1);

/** The status byte: bits 0–2 count sleep turns, then poison, burn, freeze, paralysis. */
export function monStatus(value: number): MonStatus {
  if (value & 0b111) return "sleep";
  if (value & (1 << 3)) return "poison";
  if (value & (1 << 4)) return "burn";
  if (value & (1 << 5)) return "freeze";
  if (value & (1 << 6)) return "paralysis";
  return "ok";
}

function mon(struct: Uint8Array, name: Uint8Array, status3: Uint8Array): BattleMon | null {
  const species = byte(struct, SPECIES);
  if (species === 0 || struct.length < BATTLE_STRUCT_LENGTH) return null;
  return {
    species,
    level: byte(struct, LEVEL),
    hp: word(struct, HP),
    maxHp: word(struct, MAX_HP),
    status: monStatus(byte(struct, STATUS)),
    types: [byte(struct, TYPE1), byte(struct, TYPE1 + 1)],
    moves: [0, 1, 2, 3].map((i) => byte(struct, MOVES + i)) as BattleMon["moves"],
    name: decodeText(name),
    transformed: (byte(status3, 0) & TRANSFORMED) !== 0,
  };
}

function team(block: Uint8Array): TeamSlot[] {
  const count = Math.min(byte(block, 0), PARTY_LENGTH);
  return Array.from({ length: count }, (_, i) => {
    const at = PARTY_MONS + i * PARTY_MON_LENGTH;
    if (word(block, at + PARTY_HP) === 0) return "fainted";
    return byte(block, at + PARTY_STATUS) === 0 ? "ok" : "status";
  });
}

const fainted = (side: BattleSide) => side.mon?.hp === 0;
const defeated = (side: BattleSide) => side.team.length > 0 && side.team.every((slot) => slot === "fainted");

function battleType(watched: BattleWatched): BattleType {
  if (byte(watched.linkState, 0) === LINK_STATE_BATTLING) return "link";
  const inBattle = byte(watched.inBattle, 0);
  if (inBattle === LOST_BATTLE) return byte(watched.opponent, 0) >= OPP_ID_OFFSET ? "trainer" : "wild";
  return inBattle === 1 ? "wild" : "trainer";
}

/**
 * The battle is decided once a side's whole party has fainted. The game zeroes the HP in the
 * party data as its faint sequence starts (FaintEnemyPokemon, RemoveFaintedPlayerMon), a moment
 * after the HP on the field reaches 0, so the last faint shows as `faint` and then `end`. A wild
 * Pokémon has no party, so its faint is the end straight away.
 */
function outcome(watched: BattleWatched, type: BattleType, player: BattleSide, enemy: BattleSide): BattleOutcome | null {
  if (byte(watched.inBattle, 0) === LOST_BATTLE || defeated(player)) return "lose";
  if (type === "wild" ? fainted(enemy) : defeated(enemy)) return "win";
  if (byte(watched.escaped, 0) !== 0) return "escaped";
  return null;
}

/**
 * Whether an animation is running, from the two values MoveAnimation resets as it finishes:
 * wAnimSoundID (set by each command with a sound, so it misses silent animations such as the
 * send-out puff) and wSubAnimSubEntryAddr (set by subanimations, so it misses ones made only of
 * special effects such as TACKLE's lunge). Between them they cover every animation that draws
 * something.
 */
const animating = (watched: BattleWatched, soundArmed: boolean) =>
  (soundArmed && byte(watched.animationSound, 0) !== NO_ANIMATION) || byte(watched.subanimation, 0) !== 0;

const showsMenuCursor = (tileMap: Uint8Array) => tileMap.includes(MENU_CURSOR_TILE);

/** wStatusFlags4's BIT_BATTLE_OVER_OR_BLACKOUT. */
const BATTLE_OVER = 1 << 5;

/**
 * The game is on its way into or out of a battle while wIsInBattle is 0, so `decodeBattleState`
 * says null, but the screen shows only the battle's own transition:
 * - `in`: a trainer battle's transition (the spiral, the closing bars). InitBattleCommon plays it
 *   (DoBattleTransitionAndInitBattleVariables) before it sets wIsInBattle, and every way into a
 *   trainer battle sets wCurOpponent first, after the trainer's words (StartTrainerBattle's
 *   InitBattleEnemyParameters, or the map script). A wild battle sets wIsInBattle first. A link
 *   battle's opening "versus" screen is left out: that one is worth showing.
 * - `out`: EndOfBattle has cleared wIsInBattle and wCurOpponent, and the overworld loop sets
 *   BIT_BATTLE_OVER_OR_BLACKOUT (.battleOccurred) until EnterMap has reloaded the map (or
 *   HandleBlackOut clears it). Meanwhile the screen is the battle's faded-out last frame.
 */
export function battleTransition(watched: Pick<BattleWatched, "inBattle" | "opponent" | "linkState" | "statusFlags4">): "in" | "out" | null {
  if (byte(watched.inBattle, 0) !== 0) return null;
  if (byte(watched.statusFlags4, 0) & BATTLE_OVER) return "out";
  if (byte(watched.opponent, 0) !== 0 && byte(watched.linkState, 0) !== LINK_STATE_BATTLING) return "in";
  return null;
}

/**
 * Decodes one frame's `BATTLE_WATCHES` bytes, or returns null outside a battle. Pure, but blind
 * to what only the frames before can tell (`BattleDecoder` handles it): the transition into a
 * battle, which runs before the game sets its intro flag, the flag's reuse later on, and
 * wAnimSoundID before the first animation since power-on, which isn't yet $ff.
 */
export function decodeBattleState(watched: BattleWatched): BattleState | null {
  return decode(watched, true, byte(watched.firstMonsNotOutYet, 0) !== 0);
}

function decode(watched: BattleWatched, soundArmed: boolean, intro: boolean): BattleState | null {
  if (byte(watched.inBattle, 0) === 0) return null;
  const type = battleType(watched);
  const player: BattleSide = { mon: mon(watched.playerMon, watched.playerName, watched.playerStatus3), team: team(watched.playerParty) };
  const enemy: BattleSide = { mon: mon(watched.enemyMon, watched.enemyName, watched.enemyStatus3), team: type === "wild" ? [] : team(watched.enemyParty) };
  const result = outcome(watched, type, player, enemy);
  const turn: BattleState["turn"] = byte(watched.whoseTurn, 0) === 0 ? "player" : "enemy";
  const animationId = byte(watched.animationId, 0);
  const animation =
    animationId !== 0 && animating(watched, soundArmed)
      ? { id: animationId, isMove: animationId <= NUM_ATTACKS, by: turn }
      : null;

  let phase: BattlePhase;
  if (intro) phase = "intro";
  else if (result) phase = "end";
  else if (animation) phase = "animation";
  else if (fainted(player) || fainted(enemy)) phase = "faint";
  else if (showsMenuCursor(watched.tileMap)) phase = "menu";
  else phase = "message";

  const opponent = byte(watched.opponent, 0);
  return {
    type,
    variant: VARIANTS[byte(watched.battleType, 0)] ?? "normal",
    phase,
    outcome: result,
    trainerClass: type === "trainer" && opponent >= OPP_ID_OFFSET ? opponent - OPP_ID_OFFSET : null,
    player,
    enemy,
    animation,
    turn,
    arena: {
      mapId: byte(watched.map, 0),
      tileset: byte(watched.tileset, 0),
      onWater: byte(watched.transport, 0) === SURFING,
    },
  };
}

/**
 * Decodes frames in order. On top of `decodeBattleState` it:
 * - reports `intro` from the first frame of a battle, through the screen transition, until the
 *   game clears wFirstMonsNotOutYet once both first Pokémon are out, and not after (the trainer
 *   AI sets the flag again for a moment when it switches Pokémon);
 * - reports no animation until wAnimSoundID has read $ff or changed, since it starts at 0 at
 *   power-on and only reads $ff after the first animation.
 */
export class BattleDecoder {
  #inBattle: boolean | undefined;
  /** While true, the intro lasts until wFirstMonsNotOutYet has been set and cleared. */
  #intro = false;
  #introFlagSeen = false;
  #soundArmed = false;
  #lastSound: number | undefined;

  decode(watched: BattleWatched): BattleState | null {
    // Only animations write wAnimSoundID, so any change means one has started.
    const sound = byte(watched.animationSound, 0);
    if (sound === NO_ANIMATION || (this.#lastSound !== undefined && sound !== this.#lastSound)) this.#soundArmed = true;
    this.#lastSound = sound;
    const inBattle = byte(watched.inBattle, 0) !== 0;
    const flag = byte(watched.firstMonsNotOutYet, 0) !== 0;
    if (!inBattle) {
      this.#inBattle = false;
      return null;
    }
    if (this.#inBattle === false) {
      this.#intro = true;
      this.#introFlagSeen = false;
    } else if (this.#inBattle === undefined) {
      // Starting mid-battle (after loading a save state), only the flag can tell.
      this.#intro = flag;
      this.#introFlagSeen = flag;
    }
    this.#inBattle = true;
    if (this.#intro) {
      if (flag) this.#introFlagSeen = true;
      else if (this.#introFlagSeen) this.#intro = false;
    }
    return decode(watched, this.#soundArmed, this.#intro);
  }
}
