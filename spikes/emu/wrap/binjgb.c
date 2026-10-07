#include <emscripten.h>
#include <stdlib.h>
#include "emulator.h"
#include <string.h>
u8 emulator_read_mem(Emulator*, u16); void emulator_write_mem(Emulator*, u16, u8);
void emulator_set_breakpoint(Emulator*, uint32_t); void emulator_clear_breakpoints(Emulator*);
static Emulator *e; static JoypadButtons btn; static unsigned hook_hits; static int hooking; static Ticks t;
static void joy(JoypadButtons *j, void *u) { *j = btn; }
EMSCRIPTEN_KEEPALIVE int h_new(void *rom, size_t size, void *b, size_t bs) {
  static EmulatorInit init; init.rom.data = rom; init.rom.size = size; init.audio_frequency = 48000; init.audio_frames = 4096; init.random_seed = 0xcabba6e5;
  e = emulator_new(&init); emulator_set_joypad_callback(e, joy, 0); t = emulator_get_ticks(e); return e != 0;
}
EMSCRIPTEN_KEEPALIVE void h_keys(unsigned m) { btn.A=m&1; btn.B=(m>>1)&1; btn.select=(m>>2)&1; btn.start=(m>>3)&1; btn.right=(m>>4)&1; btn.left=(m>>5)&1; btn.up=(m>>6)&1; btn.down=(m>>7)&1; }
EMSCRIPTEN_KEEPALIVE void h_run_frame(void) {
  t += 70224;
  for (;;) { EmulatorEvent ev = emulator_run_until(e, t);
#ifdef RGBDS_LIVE
    if (ev & EMULATOR_EVENT_BREAKPOINT) hook_hits++;
#endif
    if (ev & EMULATOR_EVENT_UNTIL_TICKS) break; }
}
EMSCRIPTEN_KEEPALIVE int h_read(int a) { return emulator_read_mem(e, a); }
EMSCRIPTEN_KEEPALIVE void h_write(int a, int v) { emulator_write_mem(e, a, v); }
EMSCRIPTEN_KEEPALIVE void h_hook(int a) {
#ifdef RGBDS_LIVE
  emulator_clear_breakpoints(e); if (a >= 0) emulator_set_breakpoint(e, a);
#endif
}
EMSCRIPTEN_KEEPALIVE unsigned h_hook_hits(void) { return hook_hits; }
static FileData fd;
EMSCRIPTEN_KEEPALIVE size_t h_state_size(void) { FileData f; emulator_init_state_file_data(&f); free(f.data); return f.size; }
EMSCRIPTEN_KEEPALIVE size_t h_save(void *buf) { FileData f; emulator_init_state_file_data(&f); emulator_write_state(e, &f); memcpy(buf, f.data, f.size); free(f.data); return f.size; }
EMSCRIPTEN_KEEPALIVE int h_load(void *buf, size_t n) { FileData f = { buf, n }; return emulator_read_state(e, &f) == OK; }
