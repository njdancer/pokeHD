// Messages between EmulatorHost (main thread) and the emulator Web Worker.
import type { Gift, LinkMessage } from "@pokehd/protocol";
import type { GiftEvent } from "./gifts/desk.ts";
import type { GiftSpec, TakeResult } from "./gifts/gifts.ts";
import type { LinkRole } from "./link.ts";

/** A memory range read after every frame and sent with it: [address, length]. */
export type Watch = readonly [address: number, length: number];

export type ToWorker =
  | { type: "start"; rom: Uint8Array; sram?: Uint8Array; sampleRate: number }
  /** Switches pacing to the audio clock; the port talks to the audio worklet. */
  | { type: "audio"; port: MessagePort }
  | { type: "buttons"; mask: number }
  | { type: "watch"; watches: Record<string, Watch> }
  | { type: "pause"; paused: boolean }
  | { type: "save-state"; id: number }
  | { type: "load-state"; state: Uint8Array }
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
  | { type: "ready" }
  | FrameMessage
  | { type: "sram"; sram: Uint8Array }
  | { type: "state"; id: number; state: Uint8Array }
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
