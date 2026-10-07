#!/usr/bin/env bash
# Throwaway: build the three candidate cores to wasm with the harness wrappers in wrap/.
# Needs emcc on PATH (emsdk 6.0.11 was used) and rgbds via mise (for SameBoy's own boot ROM).
# Usage: spikes/emu/build.sh <work-dir>   (sources are cloned there; output in <work-dir>/out)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
work=${1:?work dir}; mkdir -p "$work/out"; cd "$work"

clone() { # repo commit dir
  [ -d "$3" ] || git clone -q "https://github.com/$1.git" "$3"
  git -C "$3" checkout -q "$2"
}
clone binji/binjgb 16621111ed0ee73bcc45c912a823bcebedcffc0f binjgb
clone LIJI32/SameBoy c458e7c5d2d350fb37a1931c40da9f758d28d240 SameBoy
clone pokemon-speedrunning/gambatte-core 5a41a68c25402421fb1983ddadc9faf2418ddb0f gambatte-core

COMMON=(-O3 -flto '-sEXPORTED_RUNTIME_METHODS=["HEAPU8"]' -sEXPORTED_FUNCTIONS=_malloc,_free
  -sMALLOC=emmalloc -sENVIRONMENT=web,node -sFILESYSTEM=0 -sMODULARIZE=1 -sEXPORT_ES6=1
  -sALLOW_MEMORY_GROWTH=1)

B=binjgb/src
emcc "${COMMON[@]}" -I$B $B/memory.c $B/common.c $B/emulator.c $B/joypad.c \
  "$here/wrap/binjgb.c" -o out/binjgb-plain.mjs
emcc "${COMMON[@]}" -DRGBDS_LIVE -I$B $B/memory.c $B/common.c $B/emulator.c $B/joypad.c \
  "$here/wrap/binjgb.c" -o out/binjgb-live.mjs

rgbdir=$(dirname "$(cd "$here/../.." && mise which rgbasm)")
PATH="$rgbdir:$PATH" make -C SameBoy build/bin/BootROMs/dmg_boot.bin CC=cc >/dev/null
cp SameBoy/build/bin/BootROMs/dmg_boot.bin out/
SB=SameBoy/Core
emcc "${COMMON[@]}" -std=gnu11 -D_GNU_SOURCE -DGB_INTERNAL -DGB_VERSION='"spike"' \
  -DGB_COPYRIGHT_YEAR='"2026"' -DGB_DISABLE_TIMEKEEPING -DGB_DISABLE_REWIND -DGB_DISABLE_DEBUGGER \
  -DGB_DISABLE_CHEATS -DGB_DISABLE_CHEAT_SEARCH -ISameBoy -w \
  $SB/{gb,sgb,apu,memory,mbc,timing,display,camera,sm83_cpu,joypad,save_state,random,rumble}.c \
  "$here/wrap/sameboy.c" -o out/sameboy.mjs

G=gambatte-core/libgambatte
GSRC=$(sed -n "/Split('''/,/'''/p" $G/SConstruct | grep -o 'src/[^ ]*\.cpp' | sed "s|^|$G/|")
em++ "${COMMON[@]}" -std=c++11 -fno-exceptions -fno-rtti -DHAVE_STDINT_H -w -I$G/src -I$G/include \
  -Igambatte-core/common $GSRC $G/src/file/crc32.cpp "$here/wrap/gambatte.cpp" -o out/gambatte.mjs

for f in out/*.wasm; do printf '%-20s raw %7d  gzip %7d\n' "$f" "$(stat -c%s "$f")" "$(gzip -9c "$f" | wc -c)"; done
