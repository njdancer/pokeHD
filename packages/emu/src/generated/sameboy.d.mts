// Types for the Emscripten module built by native/build.sh from native/wrapper.c.
export interface SameBoyModule {
  HEAPU8: Uint8Array;
  HEAP16: Int16Array;
  HEAPU16: Uint16Array;
  HEAPU32: Uint32Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _emu_init(rom: number, romSize: number, sampleRate: number): number;
  _emu_reset(): void;
  _emu_run(maxCycles: number): number;
  _emu_hook_hit(): number;
  _emu_last_cycles(): number;
  _emu_add_hook(bank: number, address: number, id: number): number;
  _emu_remove_hook(id: number): void;
  _emu_set_buttons(mask: number): void;
  _emu_read(address: number): number;
  _emu_write(address: number, value: number): void;
  _emu_registers(): number;
  _emu_pixels(): number;
  _emu_audio(): number;
  _emu_audio_len(): number;
  _emu_audio_clear(): void;
  _emu_state_size(): number;
  _emu_save_state(buffer: number): void;
  _emu_load_state(buffer: number, size: number): number;
  _emu_sram_size(): number;
  _emu_save_sram(buffer: number, size: number): void;
  _emu_load_sram(buffer: number, size: number): void;
  _emu_sram_dirty(): number;
  _emu_sram_clear_dirty(): void;
}

export interface SameBoyModuleOptions {
  /** Compiled wasm bytes; pass in Node, where the browser fetch path isn't available. */
  wasmBinary?: ArrayBuffer | Uint8Array;
}

export default function createSameBoy(options?: SameBoyModuleOptions): Promise<SameBoyModule>;
