import { SYMBOLS, type RomSymbol, type SymbolName } from "@pokehd/rom";
import createSameBoy, { type SameBoyModule } from "./generated/sameboy.mjs";

/** Joypad buttons as a bitmask, in the order the Game Boy's joypad register reports them. */
export const Button = {
  A: 1 << 0,
  B: 1 << 1,
  Select: 1 << 2,
  Start: 1 << 3,
  Right: 1 << 4,
  Left: 1 << 5,
  Up: 1 << 6,
  Down: 1 << 7,
} as const;

export const SCREEN_WIDTH = 160;
export const SCREEN_HEIGHT = 144;
/** DMG master clock in Hz; one frame is 70224 of these, giving ~59.73 frames per second. */
export const CLOCK_HZ = 4_194_304;
export const CYCLES_PER_FRAME = 70_224;
export const FRAME_RATE = CLOCK_HZ / CYCLES_PER_FRAME;

const EV_FRAME = 1;
const EV_HOOK = 2;

/** CPU registers. Writing them is allowed from inside a hook. */
export interface Registers {
  af: number;
  bc: number;
  de: number;
  hl: number;
  sp: number;
  pc: number;
}
const REGISTER_ORDER = ["af", "bc", "de", "hl", "sp", "pc"] as const;

export interface GameBoyOptions {
  /** The player's ROM. Copied into the emulator; the caller keeps ownership. */
  rom: Uint8Array;
  /** Battery-backed save RAM from a previous session. */
  sram?: Uint8Array;
  /** Output sample rate for audio, normally the AudioContext's. Defaults to 48000. */
  sampleRate?: number;
  /** The compiled wasm, for environments that can't fetch it next to the module (Node, tests). */
  wasmBinary?: Uint8Array;
}

/**
 * Called when the CPU is about to execute the hooked instruction. The emulator is paused for
 * the duration of the call, so reads, writes and register changes land at exactly that point.
 */
export type HookCallback = (gb: GameBoy) => void;

/**
 * One emulated Game Boy (SameBoy core, see D14). Synchronous and framework-free: the caller
 * decides pacing (`runFrame` ~59.73 times a second) and where it runs (a Worker in the app,
 * plain Node in tests).
 */
export class GameBoy {
  readonly #m: SameBoyModule;
  /** Callbacks per native hook ID; several hooks on one instruction share a native hook. */
  readonly #hooks = new Map<number, Set<HookCallback>>();
  readonly #hookIds = new Map<string, number>();
  #nextHookId = 1;
  #buttons = 0;

  private constructor(module: SameBoyModule) {
    this.#m = module;
  }

  static async create(options: GameBoyOptions): Promise<GameBoy> {
    const m = await createSameBoy(options.wasmBinary ? { wasmBinary: options.wasmBinary } : {});
    const gb = new GameBoy(m);
    gb.#withBuffer(options.rom.length, (ptr) => {
      m.HEAPU8.set(options.rom, ptr);
      m._emu_init(ptr, options.rom.length, options.sampleRate ?? 48_000);
    });
    if (options.sram) gb.loadSram(options.sram);
    return gb;
  }

  /** Runs until the next frame is complete, calling any hooks reached on the way. */
  runFrame(): void {
    for (;;) {
      const event = this.#m._emu_run(0);
      if (event & EV_HOOK) this.#fire(this.#m._emu_hook_hit());
      if (event & EV_FRAME) return;
    }
  }

  /**
   * Runs for about `cycles` master-clock cycles (or to the end of a frame, whichever is first),
   * calling hooks on the way. For callers that need finer steps than a frame, such as lockstep.
   * Returns true if a frame completed.
   */
  runCycles(cycles: number): boolean {
    // SameBoy counts in 8 MHz units, twice the DMG master clock.
    let remaining = cycles * 2;
    for (;;) {
      const event = this.#m._emu_run(Math.max(remaining, 1));
      remaining -= this.#m._emu_last_cycles();
      if (event & EV_HOOK) {
        this.#fire(this.#m._emu_hook_hit());
        if (remaining > 0) continue;
        return false;
      }
      return (event & EV_FRAME) !== 0;
    }
  }

  reset(): void {
    this.#m._emu_reset();
  }

  /** Sets which buttons are held, as a mask of `Button` values. */
  setButtons(mask: number): void {
    this.#buttons = mask & 0xff;
    this.#m._emu_set_buttons(this.#buttons);
  }

  get buttons(): number {
    return this.#buttons;
  }

  /** Reads a byte from the CPU's address space without side effects. */
  read(address: number): number {
    return this.#m._emu_read(address);
  }

  readBytes(address: number, length: number): Uint8Array {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = this.#m._emu_read((address + i) & 0xffff);
    return out;
  }

  /** Writes a byte as the CPU would. Use from a hook, at a point where the game expects it. */
  write(address: number, value: number): void {
    this.#m._emu_write(address, value & 0xff);
  }

  /** Reads a byte at a WRAM or HRAM symbol, e.g. `readSymbol("wCurMap")`. */
  readSymbol(name: SymbolName): number {
    return this.read(SYMBOLS[name].address);
  }

  get registers(): Registers {
    const base = this.#m._emu_registers() >> 1;
    const regs = {} as Registers;
    REGISTER_ORDER.forEach((name, i) => (regs[name] = this.#m.HEAPU16[base + i] ?? 0));
    return regs;
  }

  setRegisters(values: Partial<Registers>): void {
    const base = this.#m._emu_registers() >> 1;
    REGISTER_ORDER.forEach((name, i) => {
      const value = values[name];
      if (value !== undefined) this.#m.HEAPU16[base + i] = value & 0xffff;
    });
  }

  /** Native hooks in use (distinct instructions hooked); the core has a fixed number of slots. */
  get hookCount(): number {
    return this.#hookIds.size;
  }

  /**
   * Calls `callback` whenever the CPU reaches `target` (a symbol name or `{ bank, address }`),
   * before that instruction runs. Returns a function that removes the hook.
   */
  addHook(target: SymbolName | RomSymbol, callback: HookCallback): () => void {
    const sym = typeof target === "string" ? SYMBOLS[target] : target;
    const key = `${sym.bank}:${sym.address}`;
    let id = this.#hookIds.get(key);
    if (id === undefined) {
      id = this.#nextHookId++;
      if (!this.#m._emu_add_hook(sym.bank, sym.address, id)) throw new Error("Too many hooks");
      this.#hookIds.set(key, id);
      this.#hooks.set(id, new Set());
    }
    // A wrapper, so the same function added twice is two hooks.
    const entry: HookCallback = (gb) => callback(gb);
    const callbacks = this.#hooks.get(id)!;
    callbacks.add(entry);
    return () => {
      callbacks.delete(entry);
      if (callbacks.size > 0 || this.#hookIds.get(key) !== id) return;
      this.#hooks.delete(id);
      this.#hookIds.delete(key);
      this.#m._emu_remove_hook(id);
    };
  }

  /**
   * Calls a native hook's callbacks in the order they were added. One that moves PC (calls or
   * returns from a routine) ends the round: the rest would see a different instruction.
   */
  #fire(id: number): void {
    const callbacks = this.#hooks.get(id);
    if (!callbacks) return;
    const pc = this.registers.pc;
    for (const callback of [...callbacks]) {
      callback(this);
      if (this.registers.pc !== pc) return;
    }
  }

  /** The last completed frame as RGBA bytes (160×144), a view into wasm memory. */
  get frame(): Uint8ClampedArray {
    return new Uint8ClampedArray(
      this.#m.HEAPU8.buffer,
      this.#m._emu_pixels(),
      SCREEN_WIDTH * SCREEN_HEIGHT * 4,
    );
  }

  /** Returns and clears the audio produced since the last call: interleaved stereo int16. */
  drainAudio(): Int16Array {
    const frames = this.#m._emu_audio_len();
    const start = this.#m._emu_audio() >> 1;
    const out = this.#m.HEAP16.slice(start, start + frames * 2);
    this.#m._emu_audio_clear();
    return out;
  }

  saveState(): Uint8Array {
    const size = this.#m._emu_state_size();
    return this.#withBuffer(size, (ptr) => {
      this.#m._emu_save_state(ptr);
      return this.#m.HEAPU8.slice(ptr, ptr + size);
    });
  }

  loadState(state: Uint8Array): void {
    const ok = this.#withBuffer(state.length, (ptr) => {
      this.#m.HEAPU8.set(state, ptr);
      return this.#m._emu_load_state(ptr, state.length);
    });
    if (!ok) throw new Error("Save state was rejected");
  }

  /** Battery-backed cartridge RAM (the in-game save). */
  saveSram(): Uint8Array {
    const size = this.#m._emu_sram_size();
    return this.#withBuffer(size, (ptr) => {
      this.#m._emu_save_sram(ptr, size);
      return this.#m.HEAPU8.slice(ptr, ptr + size);
    });
  }

  loadSram(sram: Uint8Array): void {
    this.#withBuffer(sram.length, (ptr) => {
      this.#m.HEAPU8.set(sram, ptr);
      this.#m._emu_load_sram(ptr, sram.length);
    });
  }

  /** True once the game has written save RAM since the last `clearSramDirty()`. */
  get sramDirty(): boolean {
    return this.#m._emu_sram_dirty() !== 0;
  }

  clearSramDirty(): void {
    this.#m._emu_sram_clear_dirty();
  }

  #withBuffer<T>(size: number, fn: (ptr: number) => T): T {
    const ptr = this.#m._malloc(Math.max(size, 1));
    try {
      return fn(ptr);
    } finally {
      this.#m._free(ptr);
    }
  }
}
