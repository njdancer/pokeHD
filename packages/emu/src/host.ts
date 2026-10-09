// Main-thread handle on an emulator running in a Web Worker.
import { createAudioOutput } from "./audio.ts";
import type { Gift, LinkMessage } from "@pokehd/protocol";
import type { GiftEvent } from "./gifts/desk.ts";
import type { GiftSpec, TakeResult } from "./gifts/gifts.ts";
import type { DexOpened } from "./dex-guard.ts";
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
  /**
   * A resume point (`resumePoint()`) to start from instead of the title screen. It's used only
   * if it holds exactly `sram` as its save; otherwise the game boots on `sram` as usual.
   */
  resume?: Uint8Array;
  /** Runs the game's own save every few minutes of play and after key moments. Default on. */
  autosave?: boolean;
  /** Called with the reason when an autosave was skipped (another trainer's save, …). */
  onAutosaveSkipped?: (reason: string) => void;
  /** Called when the game wrote a full save (`auto` for an autosave), before its SRAM arrives. */
  onSaved?: (auto: boolean) => void;
  /**
   * The game is about to ask "The older file will be erased to save. Okay?" (NEW GAME over a
   * save). Passing this turns the guard on: the player's buttons are held back until
   * `answerErase()` is called.
   */
  onErasePrompt?: () => void;
  /** The erase question was answered (by `answerErase()`). */
  onEraseAnswered?: (erase: boolean) => void;
  /**
   * The game opened its Pokédex (p2-dex). Passing this turns the guard on: the player's buttons
   * are held back until `closeDex()` is called, and the game then leaves its own.
   */
  onDexOpen?: (opened: DexOpened) => void;
  /** The game has left its Pokédex. */
  onDexClosed?: () => void;
  /** Someone on the map is speaking (with `onDexOpen`): the map and their index in its objects. */
  onTalk?: (map: number, npc: number) => void;
  /** The player beat a trainer on the map (with `onDexOpen`): the map and their index in its objects. */
  onBeat?: (map: number, npc: number) => void;
  /** Called for every emulated frame, in the order they were produced. */
  onFrame?: (frame: FrameMessage) => void;
  /** Called (at most about once a second) when the game has written its save. */
  onSram?: (sram: Uint8Array) => void;
  onError?: (message: string) => void;
  /** Received gifts landing, waiting and reaching a save (D20). */
  onGift?: (event: GiftEvent) => void;
}

/** A taken gift and, on success, the save the game wrote straight after (store it first). */
export interface TakenGift {
  result: TakeResult;
  sram?: Uint8Array;
}

/**
 * Runs a GameBoy in a Web Worker. Pacing is a ~59.73 Hz timer until `enableAudio()` is called
 * (it needs a user gesture), after which the audio clock drives emulation.
 */
/** How the emulator started: from the resume point, or why not. */
export interface Started {
  resumed: boolean;
  reason?: string;
}

export class EmulatorHost {
  readonly #worker: Worker;
  /** Resolves once the emulator is running. */
  readonly started: Promise<Started>;
  readonly #audio: AudioContext;
  #audioNode: AudioWorkletNode | undefined;
  #audioSetup: Promise<void> | undefined;
  #nextId = 1;
  readonly #pending = new Map<number, (state: Uint8Array) => void>();
  readonly #reads = new Map<number, (bytes: Uint8Array[]) => void>();
  readonly #takes = new Map<number, (taken: TakenGift) => void>();
  readonly #resumePoints = new Map<number, (state: Uint8Array | null) => void>();
  #linkSend: ((message: LinkMessage) => void) | undefined;

  constructor(options: EmulatorHostOptions) {
    this.#audio = new AudioContext({ latencyHint: "interactive" });
    this.#worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "pokehd-emu" });
    let ready: (started: Started) => void = () => {};
    this.started = new Promise((resolve) => (ready = resolve));
    this.#worker.onmessage = ({ data }: MessageEvent<FromWorker>) => {
      switch (data.type) {
        case "ready":
          ready({ resumed: data.resumed, ...(data.reason ? { reason: data.reason } : {}) });
          break;
        case "resume-point":
          this.#resumePoints.get(data.id)?.(data.state);
          this.#resumePoints.delete(data.id);
          break;
        case "autosave-skipped":
          options.onAutosaveSkipped?.(data.reason);
          break;
        case "saved":
          options.onSaved?.(data.auto);
          break;
        case "erase-prompt":
          options.onErasePrompt?.();
          break;
        case "erase-answered":
          options.onEraseAnswered?.(data.erase);
          break;
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
        case "read":
          this.#reads.get(data.id)?.(data.bytes);
          this.#reads.delete(data.id);
          break;
        case "gift":
          options.onGift?.(data.event);
          break;
        case "gift-taken":
          this.#takes.get(data.id)?.({ result: data.result, sram: data.sram });
          this.#takes.delete(data.id);
          break;
        case "dex-open":
          options.onDexOpen?.(data.opened);
          break;
        case "dex-closed":
          options.onDexClosed?.();
          break;
        case "talk":
          options.onTalk?.(data.map, data.npc);
          break;
        case "beat":
          options.onBeat?.(data.map, data.npc);
          break;
        case "error":
          options.onError?.(data.message);
          break;
      }
    };
    const { rom, sram, resume } = options;
    // The page answers the erase question only if it's listening for it.
    const guardErase = !!options.onErasePrompt;
    const guardDex = !!options.onDexOpen;
    this.#post({ type: "start", rom, sram, resume, sampleRate: this.#audio.sampleRate, guardErase, guardDex });
    if (options.autosave === false) this.setAutosave(false);
  }

  setAutosave(enabled: boolean): void {
    this.#post({ type: "autosave", enabled });
  }

  /** Answers the erase question (see `onErasePrompt`): true erases the old save, false keeps it. */
  answerErase(erase: boolean): void {
    this.#post({ type: "erase-answer", erase });
  }

  /** The page's Pokédex has closed (see `onDexOpen`): the game leaves its own. */
  closeDex(): void {
    this.#post({ type: "dex-close" });
  }

  /** Lets the game's own Pokédex run this time (see `onDexOpen`). */
  passDex(): void {
    this.#post({ type: "dex-pass" });
  }

  /**
   * A save state to pass back as `resume` next time, or null if now isn't a moment to take one
   * (a link session, a gift landed but not yet saved). Any newer save reaches `onSram` first.
   */
  resumePoint(): Promise<Uint8Array | null> {
    const id = this.#nextId++;
    return new Promise((resolve) => {
      this.#resumePoints.set(id, resolve);
      this.#post({ type: "resume-point", id });
    });
  }

  /**
   * Resumes audio output. Call from a user gesture (click, key release). Safe to call again,
   * including while an earlier call is still waiting: there is only ever one worklet.
   */
  async enableAudio(): Promise<void> {
    // resume() first, while the gesture still counts. On iOS one outside a gesture (a touch's
    // pointerdown) can stay pending until a later gesture resumes the context.
    await this.#audio.resume();
    // Checked and set with no await in between, so calls that were all waiting on resume() make
    // one worklet. Two worklets both reporting what they consumed would make the worker run the
    // game twice as fast to keep up, and the one being fed would drop half its sound.
    this.#audioSetup ??= createAudioOutput(this.#audio).then(({ port, node }) => {
      this.#audioNode = node;
      this.#post({ type: "audio", port }, [port]);
    });
    const setup = this.#audioSetup;
    try {
      await setup;
    } catch (err) {
      if (this.#audioSetup === setup) this.#audioSetup = undefined; // the next gesture tries again
      throw err;
    }
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

  /** Reads memory ranges once, between frames. */
  read(ranges: readonly Watch[]): Promise<Uint8Array[]> {
    const id = this.#nextId++;
    return new Promise((resolve) => {
      this.#reads.set(id, resolve);
      this.#post({ type: "read", id, ranges });
    });
  }

  /** Queues a friend's gift for the game's next overworld idle point (D20). Repeats are ignored. */
  giveGift(id: string, gift: Gift): void {
    this.#post({ type: "gift-give", id, gift });
  }

  /**
   * Takes a gift out of the game at its next overworld idle point and saves (D20). Resolves
   * once that's happened, or with the reason it couldn't (the item was used meanwhile, …).
   */
  takeGift(spec: GiftSpec): Promise<TakenGift> {
    const id = this.#nextId++;
    return new Promise((resolve) => {
      this.#takes.set(id, resolve);
      this.#post({ type: "gift-take", id, spec });
    });
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
