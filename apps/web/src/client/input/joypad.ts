import {
  DEFAULT_KEY_BINDINGS,
  bindKey,
  keyMasks,
  loadKeyBindings,
  saveKeyBindings,
  type ButtonName,
  type KeyBindings,
} from "./bindings.ts";
import { dropOpposites, pressInto } from "./direction.ts";
import { gamepadsMask, type PadLike } from "./gamepad.ts";

export type InputSource = "keyboard" | "gamepad" | "touch";

/** What `JoypadInput` needs from the page; `window` by default, a fake in tests. */
export interface InputEnvironment {
  addEventListener(type: string, listener: (e: Event) => void): void;
  removeEventListener(type: string, listener: (e: Event) => void): void;
  requestAnimationFrame(cb: () => void): number;
  cancelAnimationFrame(id: number): void;
  getGamepads?(): readonly (PadLike | null)[];
  storage?: Storage;
}

export interface JoypadInputOptions {
  /**
   * Called with the combined mask whenever it changes, and only then: key repeat and unchanged
   * gamepad polls send nothing, so the game sees a held direction exactly as a held D-pad.
   * Keyboard and touch changes arrive inside the event handler (a user gesture, so audio can
   * start); gamepad changes arrive from the polling frame.
   */
  onChange: (mask: number, source: InputSource) => void;
  env?: InputEnvironment;
}

function browserEnvironment(): InputEnvironment {
  let storage: Storage | undefined;
  try {
    storage = window.localStorage;
  } catch {
    storage = undefined;
  }
  return {
    addEventListener: (t, l) => window.addEventListener(t, l),
    removeEventListener: (t, l) => window.removeEventListener(t, l),
    requestAnimationFrame: (cb) => window.requestAnimationFrame(cb),
    cancelAnimationFrame: (id) => window.cancelAnimationFrame(id),
    getGamepads: () => navigator.getGamepads?.() ?? [],
    storage,
  };
}

/**
 * Keyboard, gamepad and touch combined into one Game Boy joypad mask for
 * `EmulatorHost.setButtons`. Keyboard bindings are rebindable and saved to localStorage.
 */
export class JoypadInput {
  readonly #env: InputEnvironment;
  readonly #onChange: JoypadInputOptions["onChange"];
  #bindings: KeyBindings;
  #keyMasks: Map<string, number>;
  /** Held bound keys, oldest press first. */
  readonly #heldKeys = new Set<string>();
  #keyboard = 0;
  #gamepad = 0;
  #touch = 0;
  #mask = 0;
  #frame: number | undefined;
  #capture: ((code: string | null) => void) | undefined;
  readonly #listeners: [string, (e: Event) => void][];

  constructor(options: JoypadInputOptions) {
    this.#env = options.env ?? browserEnvironment();
    this.#onChange = options.onChange;
    this.#bindings = loadKeyBindings(this.#env.storage);
    this.#keyMasks = keyMasks(this.#bindings);
    const release = () => this.#releaseAll();
    this.#listeners = [
      ["keydown", (e) => this.#onKey(e as KeyboardEvent)],
      ["keyup", (e) => this.#onKey(e as KeyboardEvent)],
      // Keys let go while the page lacks focus never send keyup.
      ["blur", release],
      ["gamepadconnected", () => this.#startPolling()],
    ];
    for (const [type, listener] of this.#listeners) this.#env.addEventListener(type, listener);
    // Chrome only lists pads after a button press, but a reload with a pad in hand may have one.
    if (this.#env.getGamepads?.().some(Boolean)) this.#startPolling();
  }

  /** The combined mask: what the game should see as held right now. */
  get mask(): number {
    return this.#mask;
  }

  get keyBindings(): KeyBindings {
    return this.#bindings;
  }

  /** Rebinds `button` to `code` alone (taking it from any other button) and saves the result. */
  bindKey(button: ButtonName, code: string): void {
    this.#setBindings(bindKey(this.#bindings, button, code));
  }

  resetKeyBindings(): void {
    this.#setBindings(DEFAULT_KEY_BINDINGS);
  }

  /**
   * Resolves with the `code` of the next key pressed, which the game does not see; Escape (or a
   * second call) resolves `null`. For a "press a key" rebinding prompt.
   */
  captureNextKey(): Promise<string | null> {
    this.cancelCapture();
    return new Promise((resolve) => {
      this.#capture = resolve;
    });
  }

  /** Ends a pending `captureNextKey`, resolving it `null`. */
  cancelCapture(): void {
    const resolve = this.#capture;
    this.#capture = undefined;
    resolve?.(null);
  }

  /** The on-screen pad's mask (see `TouchPad`). */
  setTouchMask(mask: number): void {
    this.#touch = mask;
    this.#update("touch");
  }

  dispose(): void {
    for (const [type, listener] of this.#listeners) this.#env.removeEventListener(type, listener);
    if (this.#frame !== undefined) this.#env.cancelAnimationFrame(this.#frame);
    this.#frame = undefined;
    this.cancelCapture();
  }

  #onKey(e: KeyboardEvent): void {
    const down = e.type === "keydown";
    if (down && this.#capture) {
      e.preventDefault();
      const resolve = this.#capture;
      this.#capture = undefined;
      resolve(e.code === "Escape" ? null : e.code);
      return;
    }
    // macOS sends no keyup for keys released while ⌘ is held, so drop everything when it lifts.
    if (!down && (e.code === "MetaLeft" || e.code === "MetaRight")) return this.#releaseAll();
    // Leave browser and OS shortcuts (⌘R, Ctrl+L, Alt+Tab) alone.
    if (down && (e.metaKey || e.ctrlKey || e.altKey)) return;
    if (!this.#keyMasks.has(e.code)) return;
    e.preventDefault();
    if (down) {
      // Auto-repeat keydowns change nothing: the key is already held.
      if (this.#heldKeys.has(e.code)) return;
      this.#heldKeys.add(e.code);
    } else {
      this.#heldKeys.delete(e.code);
    }
    this.#recomputeKeyboard();
  }

  #recomputeKeyboard(): void {
    let mask = 0;
    for (const code of this.#heldKeys) mask = pressInto(mask, this.#keyMasks.get(code) ?? 0);
    this.#keyboard = mask;
    this.#update("keyboard");
  }

  #releaseAll(): void {
    this.#heldKeys.clear();
    this.#recomputeKeyboard();
  }

  #setBindings(bindings: KeyBindings): void {
    this.#bindings = bindings;
    this.#keyMasks = keyMasks(bindings);
    saveKeyBindings(this.#env.storage, bindings);
    for (const code of this.#heldKeys) if (!this.#keyMasks.has(code)) this.#heldKeys.delete(code);
    this.#recomputeKeyboard();
  }

  #startPolling(): void {
    if (this.#frame !== undefined || !this.#env.getGamepads) return;
    const poll = () => {
      const pads = this.#env.getGamepads?.() ?? [];
      this.#gamepad = gamepadsMask(pads);
      this.#update("gamepad");
      // Keep polling while any pad is listed; `gamepadconnected` restarts it.
      this.#frame = pads.some(Boolean) ? this.#env.requestAnimationFrame(poll) : undefined;
    };
    poll();
  }

  #update(source: InputSource): void {
    const mask = dropOpposites(this.#keyboard | this.#gamepad | this.#touch);
    if (mask === this.#mask) return;
    this.#mask = mask;
    this.#onChange(mask, source);
  }
}
