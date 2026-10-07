#include <stdlib.h>
#include <string.h>
#include <emscripten.h>
#include "Core/gb.h"
static GB_gameboy_t *gb; static uint32_t pixels[160*144]; static unsigned keys;
static uint16_t hook_addr; static int hook_on; static unsigned hook_hits; static unsigned frames;
static uint32_t rgb(GB_gameboy_t *g, uint8_t r, uint8_t gg, uint8_t b) { return 0xff000000u | (b<<16) | (gg<<8) | r; }
static void sample_cb(GB_gameboy_t *g, GB_sample_t *s) {}
static void vblank(GB_gameboy_t *g, GB_vblank_type_t t) { frames++; }
static void exec_cb(GB_gameboy_t *g, uint16_t addr, uint8_t op) { if (addr == hook_addr) hook_hits++; }
EMSCRIPTEN_KEEPALIVE int h_new(uint8_t *rom, size_t size, uint8_t *boot, size_t bootsize) {
  gb = GB_init(GB_alloc(), GB_MODEL_DMG_B);
  GB_load_boot_rom_from_buffer(gb, boot, bootsize);
  GB_set_rgb_encode_callback(gb, rgb); GB_set_pixels_output(gb, pixels);
  GB_set_vblank_callback(gb, vblank); GB_apu_set_sample_callback(gb, sample_cb); GB_set_sample_rate(gb, 48000);
  GB_load_rom_from_buffer(gb, rom, size); GB_reset(gb); return 1;
}
EMSCRIPTEN_KEEPALIVE void h_keys(unsigned mask) {
  static const GB_key_t map[8] = {GB_KEY_A, GB_KEY_B, GB_KEY_SELECT, GB_KEY_START, GB_KEY_RIGHT, GB_KEY_LEFT, GB_KEY_UP, GB_KEY_DOWN};
  for (int i = 0; i < 8; i++) GB_set_key_state(gb, map[i], (mask >> i) & 1);
}
EMSCRIPTEN_KEEPALIVE void h_run_frame(void) { unsigned f = frames; while (frames == f) GB_run(gb); }
EMSCRIPTEN_KEEPALIVE int h_read(int addr) { return GB_safe_read_memory(gb, addr); }
EMSCRIPTEN_KEEPALIVE void h_write(int addr, int v) { GB_write_memory(gb, addr, v); }
EMSCRIPTEN_KEEPALIVE void h_hook(int addr) { hook_addr = addr; hook_on = addr >= 0; GB_set_execution_callback(gb, hook_on ? exec_cb : NULL); }
EMSCRIPTEN_KEEPALIVE unsigned h_hook_hits(void) { return hook_hits; }
EMSCRIPTEN_KEEPALIVE size_t h_state_size(void) { return GB_get_save_state_size(gb); }
EMSCRIPTEN_KEEPALIVE size_t h_save(uint8_t *buf) { GB_save_state_to_buffer(gb, buf); return GB_get_save_state_size(gb); }
EMSCRIPTEN_KEEPALIVE int h_load(uint8_t *buf, size_t n) { return GB_load_state_from_buffer(gb, buf, n) == 0; }
