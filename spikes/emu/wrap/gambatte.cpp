#include <emscripten.h>
#include <stdlib.h>
#include "gambatte.h"
using namespace gambatte;
static GB *gb; static uint_least32_t video[160*144]; static uint_least32_t audio[35112 + 2064];
static unsigned keys; static int hook_addr = -1; static unsigned hook_hits;
static unsigned getInput(void *) { return keys; }
static void exec_cb(int32_t addr, int64_t) { if (addr == hook_addr) hook_hits++; }
extern "C" {
EMSCRIPTEN_KEEPALIVE int h_new(char *rom, size_t size, char *, size_t) {
  gb = new GB(); int r = gb->load(rom, size, GB::NO_BIOS); gb->setInputGetter(getInput, 0); return r == 0;
}
EMSCRIPTEN_KEEPALIVE void h_keys(unsigned m) { keys = m; }
EMSCRIPTEN_KEEPALIVE void *h_video() { return video; }
EMSCRIPTEN_KEEPALIVE void h_run_frame() {
  for (;;) { std::size_t s = 35112; if (gb->runFor(video, 160, audio, s) >= 0) return; }
}
EMSCRIPTEN_KEEPALIVE int h_read(int a) { return gb->externalRead(a); }
EMSCRIPTEN_KEEPALIVE void h_write(int a, int v) { gb->externalWrite(a, v); }
EMSCRIPTEN_KEEPALIVE void h_hook(int a) { hook_addr = a; gb->setExecCallback(a >= 0 ? exec_cb : 0); }
EMSCRIPTEN_KEEPALIVE unsigned h_hook_hits() { return hook_hits; }
EMSCRIPTEN_KEEPALIVE std::size_t h_state_size() { return gb->saveState(video, 160, 0); }
EMSCRIPTEN_KEEPALIVE std::size_t h_save(char *buf) { return gb->saveState(video, 160, buf); }
EMSCRIPTEN_KEEPALIVE int h_load(char *buf, std::size_t n) { return gb->loadState(buf, n); }
}
