// Messages between EmulatorHost (main thread) and the emulator Web Worker.
import type { Gift, LinkMessage } from "@pokehd/protocol";
import type { GiftEvent } from "./gifts/desk.ts";
import type { NameAsk } from "./controls.ts";
import type { ScriptMessage } from "./script-text.ts";
import type { GiftSpec, TakeResult } from "./gifts/gifts.ts";
import type { DexOpened } from "./dex-guard.ts";
import type { JournalEvent } from "./journal-hooks.ts";
import type { LinkRole } from "./link.ts";
import type { GameInputWait } from "./input-wait.ts";
import type { ActionResult, GameAction } from "./game/actions.ts";
import type { AskAnswer, GameAsk } from "./game/asks.ts";
import type { BattleAnswer, BattleAsk } from "./game/battle-menus.ts";
import type { LiveBlocks } from "./block-watch.ts";

/** A memory range read after every frame and sent with it: [address, length]. */
export type Watch = readonly [address: number, length: number];

export type ToWorker =
  /** `resume` is a resume point to start from, used only if it holds exactly `sram` as its save. */
  /** `guardErase` turns on EraseGuard: the page answers the "older file will be erased" question. */
  /** `askNames` has the page answer name questions (Controls) instead of the game's own screens. */
  /** `guardDex` turns on DexGuard: the page shows its own Pokédex over the game's. */
  /** `menu` turns on the Pokédex menu's game hooks: page actions, and the game's questions asked of the page. */
  /** `journal` turns on JournalHooks (read-only): "journal" messages for the play journal. */
  /** `battleMenus` has the page answer the battle menu and the move list (BattleMenus). */
  /** `blocks` turns on BlockWatch: "blocks" messages when the game changes the current map's blocks. */
  | { type: "start"; rom: Uint8Array; sram?: Uint8Array; resume?: Uint8Array; sampleRate: number; guardErase?: boolean; guardDex?: boolean; askNames?: boolean; menu?: boolean; journal?: boolean; battleMenus?: boolean; blocks?: boolean }
  /** Switches pacing to the audio clock; the port talks to the audio worklet. */
  | { type: "audio"; port: MessagePort }
  | { type: "buttons"; mask: number }
  /** Taps buttons once for the player (a tapped dialog, a menu's back button). */
  | { type: "tap"; mask: number }
  /** Moves the open menu's cursor to an item, then presses A if `press` (a tapped choice). */
  | { type: "select"; item: number; press: boolean }
  /** The page's answer to a name question, encoded for the game; null for the game's own screen. */
  | { type: "name-answer"; name: Uint8Array | null }
  /** Whole messages from the script (ScriptText) on or off. */
  | { type: "script-text"; enabled: boolean }
  /** The page shows the message's last box. */
  | { type: "script-read-on"; id: number }
  /** The player has read the message. */
  | { type: "script-close"; id: number }
  /** The page can't show the message: the game's own text takes over. */
  | { type: "script-release"; id: number }
  | { type: "watch"; watches: Record<string, Watch> }
  | { type: "pause"; paused: boolean }
  | { type: "save-state"; id: number }
  | { type: "load-state"; state: Uint8Array }
  /** A save state to resume from later, if now is a moment one can be taken. */
  | { type: "resume-point"; id: number }
  | { type: "autosave"; enabled: boolean }
  /** The page's answer to the "older file will be erased" question: true to erase. */
  | { type: "erase-answer"; erase: boolean }
  /** The page's Pokédex has closed: leave the game's. */
  | { type: "dex-close" }
  /** The page isn't showing its Pokédex this time: the game's own runs. */
  | { type: "dex-pass" }
  /** Attaches a LinkPort to the worker's GameBoy (replacing any previous one). */
  | { type: "link-open"; role: LinkRole; connectTimeoutFrames?: number }
  /** The friend's next link message. */
  | { type: "link-receive"; message: LinkMessage }
  | { type: "link-close" }
  /** Reads memory once (e.g. the party and bag for the gift picker). */
  | { type: "read"; id: number; ranges: readonly Watch[] }
  /** A friend's gift, for the next overworld idle point (D20). */
  | { type: "gift-give"; id: string; gift: Gift }
  /** A Pokédex menu action, run with the game's own routine at the next idle point. */
  | { type: "action"; id: number; action: GameAction }
  /** Takes back a queued action that hasn't started. */
  | { type: "action-cancel"; id: number }
  /** The page's answer to the game's question `id`. */
  | { type: "ask-answer"; id: number; answer: AskAnswer }
  | { type: "battle-answer"; id: number; answer: BattleAnswer }
  /** Takes a gift out of the game at the next idle point, then saves. */
  | { type: "gift-take"; id: number; spec: GiftSpec };

export interface FrameMessage {
  type: "frame";
  /** 160×144 RGBA. */
  pixels: ArrayBuffer;
  /** Frames emulated since start. */
  count: number;
  /** Bytes for each watch, read at the end of this frame. */
  watched: Record<string, Uint8Array>;
  /**
   * One of the Pokédex menu's actions is running in the game this frame (GameActions): what the
   * screen shows is its routine's own drawing (the party menu a POTION redraws, its message), which
   * the menu reports in its own words when the action is done.
   */
  acting?: boolean;
  /** The game waits for the player's buttons at the end of this frame, and where (input-wait.ts). */
  wait?: GameInputWait;
}

export type FromWorker =
  /** `resumed` says whether the resume point was used; `reason` why not, if one was passed. */
  | { type: "ready"; resumed: boolean; reason?: string }
  | FrameMessage
  | { type: "sram"; sram: Uint8Array }
  | { type: "state"; id: number; state: Uint8Array }
  | { type: "resume-point"; id: number; state: Uint8Array | null }
  /** An autosave was skipped, and why. */
  | { type: "autosave-skipped"; reason: string }
  /** The game wrote a full save; `auto` if it was an autosave. Its SRAM follows as "sram". */
  | { type: "saved"; auto: boolean }
  /** The game is about to ask whether to erase the older save file (EraseGuard). */
  | { type: "erase-prompt" }
  /** The erase question was answered. */
  | { type: "erase-answered"; erase: boolean }
  /** The game asks for a name (Controls): the page answers with "name-answer". */
  | { type: "name-ask"; ask: NameAsk }
  /** A message starts (ScriptText): the page shows the whole of it. */
  | { type: "script-message"; message: ScriptMessage }
  /** The message is over for the game. */
  | { type: "script-end"; id: number }
  /** The player pressed A or B while the page shows a message. */
  | { type: "script-press" }
  /** The page's name is in: the naming screen has submitted it. */
  | { type: "name-done" }
  /** The game opened its Pokédex (DexGuard). */
  | { type: "dex-open"; opened: DexOpened }
  /** The game has left its Pokédex. */
  | { type: "dex-closed" }
  /** Someone on the map is speaking: the map and their index in its objects. */
  | { type: "talk"; map: number; npc: number }
  | { type: "beat"; map: number; npc: number }
  /** Something for the play journal happened in the game (JournalHooks). */
  | { type: "journal"; event: JournalEvent }
  /** The current map's blocks, after the game loaded or changed them (BlockWatch). */
  | { type: "blocks"; blocks: LiveBlocks }
  /** An outbound link message for the friend. */
  | { type: "link-send"; message: LinkMessage }
  | { type: "read"; id: number; bytes: Uint8Array[] }
  | { type: "gift"; event: GiftEvent }
  /** On success, `sram` is the save the game just wrote: store it before sending the gift. */
  | { type: "gift-taken"; id: number; result: TakeResult; sram?: Uint8Array }
  | { type: "action-done"; id: number; result: ActionResult }
  /** The game asks the player something (a list, the party, a quantity, yes or no): the page answers. */
  | { type: "ask"; id: number; ask: GameAsk }
  /** The battle waits for the player's choice (the battle menu or the move list): the page answers. */
  | { type: "battle-ask"; id: number; ask: BattleAsk }
  | { type: "error"; message: string; stack?: string };

/** Worker → audio worklet: interleaved stereo float32. Worklet → worker: frames consumed. */
export type ToWorklet = { samples: Float32Array };
export type FromWorklet = { consumed: number };
