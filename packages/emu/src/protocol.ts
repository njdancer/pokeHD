// Messages between EmulatorHost (main thread) and the emulator Web Worker.
import type { Gift, LinkMessage } from "@pokehd/protocol";
import type { GiftEvent } from "./gifts/desk.ts";
import type { GiftSpec, TakeResult } from "./gifts/gifts.ts";
import type { DexOpened } from "./dex-guard.ts";
import type { LinkRole } from "./link.ts";

/** A memory range read after every frame and sent with it: [address, length]. */
export type Watch = readonly [address: number, length: number];

export type ToWorker =
  /** `resume` is a resume point to start from, used only if it holds exactly `sram` as its save. */
  /** `guardErase` turns on EraseGuard: the page answers the "older file will be erased" question. */
  /** `guardDex` turns on DexGuard: the page shows its own Pokédex over the game's. */
  | { type: "start"; rom: Uint8Array; sram?: Uint8Array; resume?: Uint8Array; sampleRate: number; guardErase?: boolean; guardDex?: boolean }
  /** Switches pacing to the audio clock; the port talks to the audio worklet. */
  | { type: "audio"; port: MessagePort }
  | { type: "buttons"; mask: number }
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
  /** The game opened its Pokédex (DexGuard). */
  | { type: "dex-open"; opened: DexOpened }
  /** The game has left its Pokédex. */
  | { type: "dex-closed" }
  /** Someone on the map is speaking: the map and their index in its objects. */
  | { type: "talk"; map: number; npc: number }
  /** An outbound link message for the friend. */
  | { type: "link-send"; message: LinkMessage }
  | { type: "read"; id: number; bytes: Uint8Array[] }
  | { type: "gift"; event: GiftEvent }
  /** On success, `sram` is the save the game just wrote: store it before sending the gift. */
  | { type: "gift-taken"; id: number; result: TakeResult; sram?: Uint8Array }
  | { type: "error"; message: string };

/** Worker → audio worklet: interleaved stereo float32. Worklet → worker: frames consumed. */
export type ToWorklet = { samples: Float32Array };
export type FromWorklet = { consumed: number };
