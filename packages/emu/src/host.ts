// Main-thread handle on an emulator running in a Web Worker.
import { createAudioOutput } from "./audio.ts";
import type { LinkMessage } from "@pokehd/protocol";
import type { LinkPortOptions } from "./link.ts";
import type { FrameMessage, FromWorker, ToWorker, Watch } from "./protocol.ts";

/** The main thread's end of a LinkPort running in the worker. */
export interface HostLink {
  /** Delivers the friend's next message, in the order they were sent. */
  receive(message: LinkMessage): void;
  close(): void;
}

export interface EmulatorHostOptions {
  rom: Uint8Array;
  sram?: Uint8Array;
  /** Called for every emulated frame, in the order they were produced. */
  onFrame?: (frame: FrameMessage) => void;
  /** Called (at most about once a second) when the game has written its save. */
  onSram?: (sram: Uint8Array) => void;
  onError?: (message: string) => void;
}

/**
 * Runs a GameBoy in a Web Worker. Pacing is a ~59.73 Hz timer until `enableAudio()` is called
 * (it needs a user gesture), after which the audio clock drives emulation.
 */
export class EmulatorHost {
  readonly #worker: Worker;
  readonly #audio: AudioContext;
  #audioNode: AudioWorkletNode | undefined;
  #nextId = 1;
  readonly #pending = new Map<number, (state: Uint8Array) => void>();
  #linkSend: ((message: LinkMessage) => void) | undefined;

  constructor(options: EmulatorHostOptions) {
    this.#audio = new AudioContext({ latencyHint: "interactive" });
    this.#worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "pokehd-emu" });
    this.#worker.onmessage = ({ data }: MessageEvent<FromWorker>) => {
      switch (data.type) {
        case "frame":
          options.onFrame?.(data);
          break;
        case "sram":
          options.onSram?.(data.sram);
          break;
        case "state":
          this.#pending.get(data.id)?.(data.state);
          this.#pending.delete(data.id);
          break;
        case "link-send":
          this.#linkSend?.(data.message);
          break;
        case "error":
          options.onError?.(data.message);
          break;
      }
    };
    this.#post({ type: "start", rom: options.rom, sram: options.sram, sampleRate: this.#audio.sampleRate });
  }

  /** Resumes audio output. Call from a user gesture (click, key press). Safe to call again. */
  async enableAudio(): Promise<void> {
    await this.#audio.resume();
    if (this.#audioNode) return;
    const { port, node } = await createAudioOutput(this.#audio);
    this.#audioNode = node;
    this.#post({ type: "audio", port }, [port]);
  }

  get audioEnabled(): boolean {
    return this.#audioNode !== undefined && this.#audio.state === "running";
  }

  setButtons(mask: number): void {
    this.#post({ type: "buttons", mask });
  }

  /** Memory ranges to read after every frame; their bytes arrive in `FrameMessage.watched`. */
  watch(watches: Record<string, Watch>): void {
    this.#post({ type: "watch", watches });
  }

  setPaused(paused: boolean): void {
    this.#post({ type: "pause", paused });
    if (paused) void this.#audio.suspend();
    else if (this.#audioNode) void this.#audio.resume();
  }

  saveState(): Promise<Uint8Array> {
    const id = this.#nextId++;
    return new Promise((resolve) => {
      this.#pending.set(id, resolve);
      this.#post({ type: "save-state", id });
    });
  }

  loadState(state: Uint8Array): void {
    this.#post({ type: "load-state", state });
  }

  /**
   * Plugs in the link cable (D17): the game's link routines become messages. `send` receives
   * each outbound message; pass the friend's to `receive`. Replaces any open link.
   */
  openLink(options: LinkPortOptions): HostLink {
    const { send, ...rest } = options;
    this.#linkSend = send;
    this.#post({ type: "link-open", ...rest });
    return {
      receive: (message) => this.#post({ type: "link-receive", message }),
      close: () => {
        if (this.#linkSend === send) this.#linkSend = undefined;
        this.#post({ type: "link-close" });
      },
    };
  }

  dispose(): void {
    this.#worker.terminate();
    this.#audioNode?.disconnect();
    void this.#audio.close();
  }

  #post(message: ToWorker, transfer: Transferable[] = []): void {
    this.#worker.postMessage(message, transfer);
  }
}
