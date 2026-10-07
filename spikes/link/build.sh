#!/usr/bin/env bash
# Throwaway: build SameBoy (pinned as in spikes/emu, per D14) to wasm with the link wrapper.
# Needs emcc on PATH (emsdk 6.0.11) and rgbds via mise (for SameBoy's own MIT boot ROM).
# Usage: spikes/link/build.sh <work-dir>   (SameBoy is cloned there; output in <work-dir>/out)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
work=${1:?work dir}; mkdir -p "$work/out"; cd "$work"
[ -d SameBoy ] || git clone -q https://github.com/LIJI32/SameBoy.git SameBoy
git -C SameBoy checkout -q c458e7c5d2d350fb37a1931c40da9f758d28d240

rgbdir=$(dirname "$(cd "$here/../.." && mise which rgbasm)")
PATH="$rgbdir:$PATH" make -C SameBoy build/bin/BootROMs/dmg_boot.bin CC=cc >/dev/null
cp SameBoy/build/bin/BootROMs/dmg_boot.bin out/
SB=SameBoy/Core
emcc -O3 -flto '-sEXPORTED_RUNTIME_METHODS=["HEAPU8","HEAPU32"]' -sEXPORTED_FUNCTIONS=_malloc,_free \
  -sMALLOC=emmalloc -sENVIRONMENT=web,node -sFILESYSTEM=0 -sMODULARIZE=1 -sEXPORT_ES6=1 \
  -sALLOW_MEMORY_GROWTH=1 -std=gnu11 -D_GNU_SOURCE -DGB_INTERNAL -DGB_VERSION='"spike"' \
  -DGB_COPYRIGHT_YEAR='"2026"' -DGB_DISABLE_TIMEKEEPING -DGB_DISABLE_REWIND -DGB_DISABLE_DEBUGGER \
  -DGB_DISABLE_CHEATS -DGB_DISABLE_CHEAT_SEARCH -ISameBoy -w \
  $SB/{gb,sgb,apu,memory,mbc,timing,display,camera,sm83_cpu,joypad,save_state,random,rumble}.c \
  "$here/wrap/link.c" -o out/sameboy-link.mjs
ls -la out
