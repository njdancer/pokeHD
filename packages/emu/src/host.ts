// Main-thread handle on an emulator running in a Web Worker.
import { createAudioOutput } from "./audio.ts";
import type { Gift, LinkMessage } from "@pokehd/protocol";
import type { NameAsk } from "./controls.ts";
import type { ScriptMessage } from "./script-text.ts";
import type { GiftEvent } from "./gifts/desk.ts";
import type { GiftSpec, TakeResult } from "./gifts/gifts.ts";
import type { DexOpened } from "./dex-guard.ts";
import type { LinkPortOptions } from "./link.ts";
import type { FrameMessage, FromWorker, ToWorker, Watch } from "./protocol.ts";
import type { ActionResult, GameAction } from "./game/actions.ts";
import type { AskAnswer, GameAsk } from "./game/asks.ts";

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
   * The game asks for a name (the intro's player and rival, a nickname). Passing this has the
   * page answer instead of the game's own screens: the player's buttons are held back until
   * `answerName()` is called.
   */
  onNameAsk?: (ask: NameAsk) => void;
  /** The answered name is in the game. */
  onNameDone?: () => void;
  /**
   * With `setScriptText(true)`: a message starts and the page shows the whole of it. Call
   * `readOnMessage()` once its last part shows and `closeMessage()` when the player is done.
   */
  onScriptMessage?: (message: ScriptMessage) => void;
  /** The message is over for the game (a menu takes input, the box closed, the next message). */
  onScriptEnd?: (id: number) => void;
  /** The player pressed A or B while a message shows: read on. */
  onScriptPress?: () => void;
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
  /**
   * The game asks the player something (the Pokédex menu's sheets): a list, the party, a
   * quantity, yes or no. Passing this turns on the menu's game hooks; the game waits until
   * `answerAsk()` is called, and `act()` works.
   */
  onAsk?: (id: number, ask: GameAsk) => void;
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
  #audio: AudioContext;
  #audioNode: AudioWorkletNode | undefined;
  #audioSetup: Promise<void> | undefined;
  /** The context stopped (suspended, or iOS interrupted it) since sound started. */
  #stopped = false;
  #nextId = 1;
  readonly #pending = new Map<number, (state: Uint8Array) => void>();
  readonly #reads = new Map<number, (bytes: Uint8Array[]) => void>();
  readonly #takes = new Map<number, (taken: TakenGift) => void>();
  readonly #resumePoints = new Map<number, (state: Uint8Array | null) => void>();
  readonly #actions = new Map<number, (result: ActionResult) => void>();
  #linkSend: ((message: LinkMessage) => void) | undefined;

  constructor(options: EmulatorHostOptions) {
    this.#audio = this.#context();
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
        case "name-ask":
          options.onNameAsk?.(data.ask);
          break;
        case "name-done":
          options.onNameDone?.();
          break;
        case "script-message":
          options.onScriptMessage?.(data.message);
          break;
        case "script-end":
          options.onScriptEnd?.(data.id);
          break;
        case "script-press":
          options.onScriptPress?.();
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
        case "action-done":
          this.#actions.get(data.id)?.(data.result);
          this.#actions.delete(data.id);
          break;
        case "ask":
          options.onAsk?.(data.id, data.ask);
          break;
        case "error":
          options.onError?.(data.message);
          break;
      }
    };
    const { rom, sram, resume } = options;
    // The page answers the erase question only if it's listening for it.
    const guardErase = !!options.onErasePrompt;
    const askNames = !!options.onNameAsk;
    const guardDex = !!options.onDexOpen;
    const menu = !!options.onAsk;
    this.#post({ type: "start", rom, sram, resume, sampleRate: this.#audio.sampleRate, guardErase, guardDex, askNames, menu });
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
    const context = this.#audio;
    this.#audioSetup ??= createAudioOutput(context).then(({ port, node }) => {
      // restartAudio() swapped the context while this one was still being set up: drop it, or
      // its port could reach the worker after the fresh one's and pace the game off a closed
      // context, which never plays.
      if (context !== this.#audio) return node.disconnect();
      this.#audioNode = node;
      this.#stopped = false;
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

  /**
   * Swaps the audio output for a fresh one, started again by the next `enableAudio()`. For after
   * the page comes back from the background: iOS can leave a context it interrupted playing
   * fast and garbled, as if there were two. The new context keeps the old one's sample rate, so
   * the emulator's samples still fit; the worker drops the old worklet's port when the new one
   * arrives, so there is still only ever one. Returns whether it swapped (sound is then off until
   * the next `enableAudio()`).
   */
  restartAudio(): boolean {
    // Only a context that stopped while the page was away needs it. One that kept running (a
    // desktop tab switch) is fine as it is, and closing it would leave the game paused until a
    // click or key, which a gamepad press isn't.
    if (!this.#audioSetup || (!this.#stopped && this.#audio.state === "running")) return false;
    const old = this.#audio;
    this.#audioNode?.disconnect();
    this.#audioNode = undefined;
    this.#audioSetup = undefined;
    this.#audio = this.#context(old.sampleRate);
    void old.close();
    return true;
  }

  /** A context that notes when it stops running after sound started, for `restartAudio()`. */
  #context(sampleRate?: number): AudioContext {
    const context = new AudioContext({ latencyHint: "interactive", ...(sampleRate ? { sampleRate } : {}) });
    context.onstatechange = () => {
      if (context === this.#audio && this.#audioNode && context.state !== "running") this.#stopped = true;
    };
    return context;
  }

  get audioEnabled(): boolean {
    return this.#audioNode !== undefined && this.#audio.state === "running";
  }

  setButtons(mask: number): void {
    this.#post({ type: "buttons", mask });
  }

  /** Taps buttons once for the player, the game's own way (a mask: `Button.A`, …). */
  tap(mask: number): void {
    this.#post({ type: "tap", mask });
  }

  /** Moves the open menu's cursor to `item` (its wCurrentMenuItem), then presses A if `press`. */
  select(item: number, press = true): void {
    this.#post({ type: "select", item, press });
  }

  /** Whole messages from the script on or off (see `onScriptMessage`). */
  setScriptText(enabled: boolean): void {
    this.#post({ type: "script-text", enabled });
  }

  /** The page shows the message's last part: the game runs through the waits inside it. */
  readOnMessage(id: number): void {
    this.#post({ type: "script-read-on", id });
  }

  /** The player has read the message: the game runs through the rest of it. */
  closeMessage(id: number): void {
    this.#post({ type: "script-close", id });
  }

  /** The page can't show the message after all: the game's own text takes over. */
  releaseMessage(id: number): void {
    this.#post({ type: "script-release", id });
  }

  /** Answers `onNameAsk` with a name (see `encodeName`), or null to use the game's own screen. */
  answerName(name: Uint8Array | null): void {
    this.#post({ type: "name-answer", name });
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

  /**
   * Runs a Pokédex menu action with the game's own routine at its next overworld idle point
   * (needs `onAsk`). Resolves with what the game said, or why it didn't happen.
   */
  act(action: GameAction): Promise<ActionResult> {
    const id = this.#nextId++;
    return new Promise((resolve) => {
      this.#actions.set(id, resolve);
      this.#post({ type: "action", id, action });
    });
  }

  /** Answers the game's question `id` (see `onAsk`); null cancels, as B would. */
  answerAsk(id: number, answer: AskAnswer): void {
    this.#post({ type: "ask-answer", id, answer });
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
