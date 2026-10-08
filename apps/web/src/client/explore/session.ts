// The explorer's own emulator: a GameBoy on the main thread under a step Debugger, so every
// panel can read the CPU and memory synchronously. It never writes the player's save: the game's
// save RAM changes stay inside this session.
import { Button, Debugger, GameBoy, SCREEN_HEIGHT, SCREEN_WIDTH, placeKey, type StopReason } from "@pokehd/emu";

export type RunMode = "paused" | "running" | "fast";
export type BootFrom = "power" | "save" | "resume";

/** Frames per animation frame in fast-forward. */
const FAST_FACTOR = 6;

const KEYS: Record<string, number> = {
  ArrowUp: Button.Up,
  ArrowDown: Button.Down,
  ArrowLeft: Button.Left,
  ArrowRight: Button.Right,
  KeyX: Button.A,
  KeyZ: Button.B,
  Enter: Button.Start,
  ShiftRight: Button.Select,
  Backspace: Button.Select,
};

export class EmuSession {
  readonly dbg: Debugger;
  mode: RunMode = "paused";
  /** Why the last run stopped, for the status line. */
  lastStop: StopReason | "paused" | "started" = "started";
  /** Bumped on every change panels should redraw for. */
  version = 0;
  #listeners = new Set<() => void>();
  #raf = 0;
  #last = 0;
  #canvas?: HTMLCanvasElement;
  #image = new ImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
  #held = 0;
  #notifyAt = 0;

  private constructor(dbg: Debugger) {
    this.dbg = dbg;
  }

  static async create(rom: Uint8Array, sram?: Uint8Array, state?: Uint8Array): Promise<EmuSession> {
    const gb = await GameBoy.create({ rom, sram });
    if (state) gb.loadState(state);
    return new EmuSession(new Debugger(gb, rom));
  }

  get gb(): GameBoy {
    return this.dbg.gb;
  }

  subscribe = (fn: () => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getVersion = () => this.version;

  #notify(force = false) {
    // While running, panels refresh a few times a second rather than every frame.
    const now = performance.now();
    if (!force && now < this.#notifyAt) return;
    this.#notifyAt = now + 150;
    this.version++;
    for (const fn of this.#listeners) fn();
  }

  attachScreen(canvas: HTMLCanvasElement | null) {
    this.#canvas = canvas ?? undefined;
    this.#draw();
  }

  #draw() {
    const ctx = this.#canvas?.getContext("2d");
    if (!ctx) return;
    this.#image.data.set(this.gb.frame);
    ctx.putImageData(this.#image, 0, 0);
  }

  setMode(mode: RunMode) {
    this.mode = mode;
    cancelAnimationFrame(this.#raf);
    if (mode !== "paused") {
      this.#last = performance.now();
      this.#raf = requestAnimationFrame(this.#tick);
    } else this.lastStop = "paused";
    this.#notify(true);
  }

  #tick = (now: number) => {
    if (this.mode === "paused") return;
    // Emulate as many frames as real time asks for (at most a few, after a stall).
    const due = Math.min(4, Math.round(((now - this.#last) * 59.73) / 1000));
    if (due > 0) this.#last = now;
    for (let i = 0; i < due; i++) {
      if (this.mode === "fast") {
        for (let f = 0; f < FAST_FACTOR; f++) this.gb.runFrame();
        continue;
      }
      const reason = this.dbg.run();
      if (reason === "breakpoint") {
        this.lastStop = reason;
        this.mode = "paused";
        this.#draw();
        this.#notify(true);
        return;
      }
    }
    if (due > 0) this.#draw();
    this.#notify();
    this.#raf = requestAnimationFrame(this.#tick);
  };

  #after(reason: StopReason) {
    this.lastStop = reason;
    this.#draw();
    this.#notify(true);
  }

  step() {
    this.setMode("paused");
    this.dbg.step();
    this.#after("returned");
  }

  stepOver() {
    this.setMode("paused");
    this.#after(this.dbg.stepOver());
  }

  stepOut() {
    this.setMode("paused");
    this.#after(this.dbg.stepOut());
  }

  /** Runs to the end of the current frame (or a breakpoint). */
  stepFrame() {
    this.setMode("paused");
    this.#after(this.dbg.run(1_000_000));
  }

  toggleBreakpoint(bank: number, address: number) {
    const key = placeKey(bank, address);
    if (this.dbg.breakpoints.has(key)) this.dbg.breakpoints.delete(key);
    else this.dbg.breakpoints.add(key);
    this.#notify(true);
  }

  hasBreakpoint(bank: number, address: number) {
    return this.dbg.breakpoints.has(placeKey(bank, address));
  }

  key(code: string, down: boolean): boolean {
    const button = KEYS[code];
    if (!button) return false;
    this.#held = down ? this.#held | button : this.#held & ~button;
    this.gb.setButtons(this.#held);
    return true;
  }

  dispose() {
    this.mode = "paused";
    cancelAnimationFrame(this.#raf);
    this.#listeners.clear();
  }
}
