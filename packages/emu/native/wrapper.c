// Thin C API over SameBoy's core for packages/emu (see D14). One emulator per wasm instance.
// The run loop steps one instruction at a time so PC hooks fire *before* the hooked
// instruction executes, which lets JS inspect or change state at a precise, safe point.
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>
#include "Core/gb.h"
#include "dmg_boot.h"

enum { EV_FRAME = 1, EV_HOOK = 2, EV_CYCLES = 4 };
enum { MAX_HOOKS = 64, AUDIO_CAP = 16384 };

static GB_gameboy_t *gb;
static uint32_t pixels[160 * 144];
static int frame_done;

static int16_t audio[AUDIO_CAP * 2];
static unsigned audio_len;

typedef struct { uint16_t bank, address; int id; } Hook;
static Hook hooks[MAX_HOOKS];
static unsigned hook_count;
static uint8_t hook_filter[0x10000 / 8];
static int hook_hit_id = -1;
static int suppress_pc = -1;
static double last_cycles;

static uint32_t rgb_encode(GB_gameboy_t *g, uint8_t r, uint8_t gr, uint8_t b) {
  (void)g;
  return 0xff000000u | ((uint32_t)b << 16) | ((uint32_t)gr << 8) | r; // RGBA bytes in memory
}
static void on_vblank(GB_gameboy_t *g, GB_vblank_type_t type) { (void)g; (void)type; frame_done = 1; }
static void on_sample(GB_gameboy_t *g, GB_sample_t *s) {
  (void)g;
  if (audio_len < AUDIO_CAP) { audio[audio_len * 2] = s->left; audio[audio_len * 2 + 1] = s->right; audio_len++; }
}

EMSCRIPTEN_KEEPALIVE int emu_init(const uint8_t *rom, size_t rom_size, unsigned sample_rate) {
  if (gb) { GB_free(gb); GB_dealloc(gb); }
  gb = GB_init(GB_alloc(), GB_MODEL_DMG_B);
  GB_load_boot_rom_from_buffer(gb, dmg_boot, sizeof dmg_boot);
  GB_set_rgb_encode_callback(gb, rgb_encode);
  GB_set_pixels_output(gb, pixels);
  GB_set_palette(gb, &GB_PALETTE_GREY);
  GB_set_vblank_callback(gb, on_vblank);
  GB_apu_set_sample_callback(gb, on_sample);
  GB_set_sample_rate(gb, sample_rate);
  GB_load_rom_from_buffer(gb, rom, rom_size);
  GB_reset(gb);
  audio_len = 0; hook_hit_id = -1; suppress_pc = -1;
  return 1;
}
EMSCRIPTEN_KEEPALIVE void emu_reset(void) { GB_reset(gb); suppress_pc = -1; }

static int hook_at(uint16_t pc) {
  if (!(hook_filter[pc >> 3] & (1 << (pc & 7)))) return -1;
  uint16_t bank = 0;
  if (pc >= 0x4000 && pc < 0x8000) { size_t size; GB_get_direct_access(gb, GB_DIRECT_ACCESS_ROM, &size, &bank); }
  for (unsigned i = 0; i < hook_count; i++) {
    if (hooks[i].address == pc && (pc >= 0x8000 || hooks[i].bank == bank)) return hooks[i].id;
  }
  return -1;
}

// Runs until a frame completes, a hook is reached, or `max_cycles` (8 MHz units, 0 = no limit)
// have elapsed. Returns a bitmask of EV_*; on EV_HOOK, emu_hook_hit() says which.
EMSCRIPTEN_KEEPALIVE int emu_run(double max_cycles) {
  double cycles = 0;
  frame_done = 0;
  last_cycles = 0;
  for (;;) {
    uint16_t pc = GB_get_registers(gb)->pc;
    if (pc != suppress_pc) {
      suppress_pc = -1;
      if (hook_count) {
        int id = hook_at(pc);
        if (id >= 0) { hook_hit_id = id; suppress_pc = pc; last_cycles = cycles; return EV_HOOK; }
      }
    }
    cycles += GB_run(gb);
    if (frame_done || (max_cycles > 0 && cycles >= max_cycles)) {
      last_cycles = cycles;
      return frame_done ? EV_FRAME : EV_CYCLES;
    }
  }
}
EMSCRIPTEN_KEEPALIVE int emu_hook_hit(void) { return hook_hit_id; }
// Cycles (8 MHz units) the last emu_run call advanced.
EMSCRIPTEN_KEEPALIVE double emu_last_cycles(void) { return last_cycles; }

EMSCRIPTEN_KEEPALIVE int emu_add_hook(int bank, int address, int id) {
  if (hook_count == MAX_HOOKS) return 0;
  hooks[hook_count++] = (Hook){ (uint16_t)bank, (uint16_t)address, id };
  hook_filter[address >> 3] |= 1 << (address & 7);
  return 1;
}
EMSCRIPTEN_KEEPALIVE void emu_remove_hook(int id) {
  memset(hook_filter, 0, sizeof hook_filter);
  unsigned out = 0;
  for (unsigned i = 0; i < hook_count; i++) {
    if (hooks[i].id == id) continue;
    hooks[out++] = hooks[i];
    hook_filter[hooks[i].address >> 3] |= 1 << (hooks[i].address & 7);
  }
  hook_count = out;
}

EMSCRIPTEN_KEEPALIVE void emu_set_buttons(unsigned mask) {
  static const GB_key_t order[8] = { GB_KEY_A, GB_KEY_B, GB_KEY_SELECT, GB_KEY_START,
                                     GB_KEY_RIGHT, GB_KEY_LEFT, GB_KEY_UP, GB_KEY_DOWN };
  for (int i = 0; i < 8; i++) GB_set_key_state(gb, order[i], (mask >> i) & 1);
}

EMSCRIPTEN_KEEPALIVE int emu_read(int address) { return GB_safe_read_memory(gb, address); }
EMSCRIPTEN_KEEPALIVE void emu_write(int address, int value) { GB_write_memory(gb, address, value); }
// af, bc, de, hl, sp, pc as six uint16 values.
EMSCRIPTEN_KEEPALIVE uint16_t *emu_registers(void) { return GB_get_registers(gb)->registers; }

EMSCRIPTEN_KEEPALIVE uint32_t *emu_pixels(void) { return pixels; }
EMSCRIPTEN_KEEPALIVE int16_t *emu_audio(void) { return audio; }
EMSCRIPTEN_KEEPALIVE unsigned emu_audio_len(void) { return audio_len; }
EMSCRIPTEN_KEEPALIVE void emu_audio_clear(void) { audio_len = 0; }

EMSCRIPTEN_KEEPALIVE int emu_state_size(void) { return (int)GB_get_save_state_size(gb); }
EMSCRIPTEN_KEEPALIVE void emu_save_state(uint8_t *buffer) { GB_save_state_to_buffer(gb, buffer); }
EMSCRIPTEN_KEEPALIVE int emu_load_state(const uint8_t *buffer, size_t size) {
  suppress_pc = -1;
  return GB_load_state_from_buffer(gb, buffer, size) == 0;
}

EMSCRIPTEN_KEEPALIVE int emu_sram_size(void) { return GB_save_battery_size(gb); }
EMSCRIPTEN_KEEPALIVE void emu_save_sram(uint8_t *buffer, size_t size) { GB_save_battery_to_buffer(gb, buffer, size); }
EMSCRIPTEN_KEEPALIVE void emu_load_sram(const uint8_t *buffer, size_t size) { GB_load_battery_from_buffer(gb, buffer, size); }
EMSCRIPTEN_KEEPALIVE int emu_sram_dirty(void) { return GB_get_battery_dirty(gb); }
EMSCRIPTEN_KEEPALIVE void emu_sram_clear_dirty(void) { GB_clear_battery_dirty(gb); }
