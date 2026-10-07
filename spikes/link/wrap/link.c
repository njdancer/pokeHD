// Throwaway: up to four SameBoy instances with a byte-level link-cable bridge driven from JS.
// A core that starts an internally clocked transfer (it is the master) stops in h_run with
// RUN_XFER; JS decides when the partner sees the byte and when the reply arrives
// (h_set_reply), which is how latency and the sync strategies are simulated.
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>
#include "Core/gb.h"

typedef struct {
  GB_gameboy_t *gb;
  uint32_t pixels[160 * 144];
  unsigned frames;
  int xfer_pending;   // master transfer started, waiting for a reply
  uint8_t xfer_out;   // byte the master sent
  int reply_ready;
  uint8_t reply;      // byte shifted into the master, MSB first
  int bit;            // bits consumed from reply
  uint16_t hook_addr; unsigned hook_hits;
} core_t;
#define NCORES 4 // two for a direct cable; four for two clients that each run both Game Boys
static core_t cores[NCORES];

static int idx(GB_gameboy_t *gb) { for (int i = 1; i < NCORES; i++) if (gb == cores[i].gb) return i; return 0; }
static uint32_t rgb(GB_gameboy_t *g, uint8_t r, uint8_t gg, uint8_t b) { return 0xff000000u | (b << 16) | (gg << 8) | r; }
static void sample_cb(GB_gameboy_t *g, GB_sample_t *s) {}
static void vblank(GB_gameboy_t *g, GB_vblank_type_t t) { cores[idx(g)].frames++; }
static void exec_cb(GB_gameboy_t *g, uint16_t addr, uint8_t op) { core_t *c = &cores[idx(g)]; if (addr == c->hook_addr) c->hook_hits++; }

// Called on the SC write that starts an internal-clock transfer (bit 0) and before bits 1..7.
static void bit_start(GB_gameboy_t *gb, bool bit) {
  core_t *c = &cores[idx(gb)];
  if (gb->serial_count == 0) {  // a new byte
    c->xfer_pending = 1; c->reply_ready = 0; c->bit = 0;
    c->xfer_out = GB_safe_read_memory(gb, 0xff01);
  }
}
static bool bit_end(GB_gameboy_t *gb) {
  core_t *c = &cores[idx(gb)];
  bool b = c->reply_ready ? (c->reply >> (7 - c->bit)) & 1 : 1;
  if (++c->bit == 8) c->xfer_pending = 0;
  return b;
}

EMSCRIPTEN_KEEPALIVE int h_new(int i, uint8_t *rom, size_t size, uint8_t *boot, size_t bootsize) {
  core_t *c = &cores[i]; memset(c, 0, sizeof *c);
  c->gb = GB_init(GB_alloc(), GB_MODEL_DMG_B);
  GB_load_boot_rom_from_buffer(c->gb, boot, bootsize);
  GB_set_rgb_encode_callback(c->gb, rgb); GB_set_pixels_output(c->gb, c->pixels);
  GB_set_vblank_callback(c->gb, vblank); GB_apu_set_sample_callback(c->gb, sample_cb); GB_set_sample_rate(c->gb, 48000);
  GB_set_serial_transfer_bit_start_callback(c->gb, bit_start);
  GB_set_serial_transfer_bit_end_callback(c->gb, bit_end);
  GB_load_rom_from_buffer(c->gb, rom, size); GB_reset(c->gb); return 1;
}
EMSCRIPTEN_KEEPALIVE void h_keys(int i, unsigned mask) {
  static const GB_key_t map[8] = {GB_KEY_A, GB_KEY_B, GB_KEY_SELECT, GB_KEY_START, GB_KEY_RIGHT, GB_KEY_LEFT, GB_KEY_UP, GB_KEY_DOWN};
  for (int k = 0; k < 8; k++) GB_set_key_state(cores[i].gb, map[k], (mask >> k) & 1);
}
// Run up to `ticks` (8 MHz units). Returns ticks run; sets *stopped to 1 if a master transfer
// started and has no reply yet (the caller must not run this core until h_set_reply).
static int stopped;
EMSCRIPTEN_KEEPALIVE int h_run(int i, int ticks) {
  core_t *c = &cores[i]; int done = 0; stopped = 0;
  if (c->xfer_pending && !c->reply_ready) { stopped = 1; return 0; }
  while (done < ticks) {
    done += GB_run(c->gb);
    if (c->xfer_pending && !c->reply_ready) { stopped = 1; break; }
  }
  return done;
}
EMSCRIPTEN_KEEPALIVE int h_stopped(void) { return stopped; }
EMSCRIPTEN_KEEPALIVE int h_xfer_out(int i) { return cores[i].xfer_out; }
EMSCRIPTEN_KEEPALIVE void h_set_reply(int i, int v) { cores[i].reply = v; cores[i].reply_ready = 1; }
// Deliver a byte from the master to this core as an external clock: 8 bit exchanges, done
// atomically. Returns what this core shifted out (0x00 if its serial port was not armed,
// 0xff if it is itself clocking, as SameBoy reports for those cases).
EMSCRIPTEN_KEEPALIVE int h_clock_in(int i, int v) {
  GB_gameboy_t *gb = cores[i].gb; int out = 0;
  for (int k = 7; k >= 0; k--) { out = (out << 1) | GB_serial_get_data_bit(gb); GB_serial_set_data_bit(gb, (v >> k) & 1); }
  return out;
}
EMSCRIPTEN_KEEPALIVE int h_sb(int i) { return GB_safe_read_memory(cores[i].gb, 0xff01); }
EMSCRIPTEN_KEEPALIVE int h_sc(int i) { return GB_safe_read_memory(cores[i].gb, 0xff02); }
EMSCRIPTEN_KEEPALIVE unsigned h_frames(int i) { return cores[i].frames; }
EMSCRIPTEN_KEEPALIVE int h_read(int i, int addr) { return GB_safe_read_memory(cores[i].gb, addr); }
// Direct access, not GB_write_memory: a bus write from outside the CPU is dropped while the
// game's OAM DMA runs, which is exactly when a frame boundary returns control to us.
EMSCRIPTEN_KEEPALIVE void h_write(int i, int addr, int v) {
  size_t size; uint16_t bank; GB_gameboy_t *gb = cores[i].gb;
  if (addr >= 0xc000 && addr < 0xe000) ((uint8_t *)GB_get_direct_access(gb, GB_DIRECT_ACCESS_RAM, &size, &bank))[addr - 0xc000] = v;
  else if (addr >= 0xff80 && addr < 0xffff) ((uint8_t *)GB_get_direct_access(gb, GB_DIRECT_ACCESS_HRAM, &size, &bank))[addr - 0xff80] = v;
  else GB_write_memory(gb, addr, v);
}
EMSCRIPTEN_KEEPALIVE int h_pc(int i) { return GB_get_registers(cores[i].gb)->pc; }
EMSCRIPTEN_KEEPALIVE void h_hook(int i, int addr) { cores[i].hook_addr = addr; GB_set_execution_callback(cores[i].gb, addr >= 0 ? exec_cb : NULL); }
EMSCRIPTEN_KEEPALIVE unsigned h_hook_hits(int i) { return cores[i].hook_hits; }
EMSCRIPTEN_KEEPALIVE uint32_t *h_pixels(int i) { return cores[i].pixels; }
EMSCRIPTEN_KEEPALIVE size_t h_state_size(int i) { return GB_get_save_state_size(cores[i].gb); }
EMSCRIPTEN_KEEPALIVE size_t h_save(int i, uint8_t *buf) { GB_save_state_to_buffer(cores[i].gb, buf); return GB_get_save_state_size(cores[i].gb); }
EMSCRIPTEN_KEEPALIVE int h_load(int i, uint8_t *buf, size_t n) {
  core_t *c = &cores[i]; c->xfer_pending = 0; c->reply_ready = 0;
  return GB_load_state_from_buffer(c->gb, buf, n) == 0;
}
