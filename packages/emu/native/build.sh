#!/usr/bin/env bash
# Builds SameBoy (vendor/SameBoy, pinned submodule) plus wrapper.c into src/generated/sameboy.{mjs,wasm}.
# The outputs are committed so the app, tests and CI don't need Emscripten; rerun this only when
# the wrapper or the SameBoy pin changes, and commit the result. Same inputs give identical bytes.
#
# Needs: git submodules, the mise toolchain (rgbds builds SameBoy's own MIT boot ROM), a C
# compiler for SameBoy's logo compressor, and Emscripten, which is installed on first run into
# ${XDG_CACHE_HOME:-~/.cache}/pokehd/emsdk at the pinned version below (outside the repo, so
# Vitest and oxlint never see it).
set -euo pipefail
EMSDK_VERSION=6.0.11

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
sameboy="$root/vendor/SameBoy"
out="$here/../src/generated"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

git -C "$root" submodule update --init vendor/SameBoy

emsdk="${XDG_CACHE_HOME:-$HOME/.cache}/pokehd/emsdk"
if [ ! -x "$emsdk/upstream/emscripten/emcc" ] || ! grep -q "\"$EMSDK_VERSION\"" "$emsdk/upstream/emscripten/emscripten-version.txt"; then
  [ -d "$emsdk" ] || git clone -q https://github.com/emscripten-core/emsdk.git "$emsdk"
  "$emsdk/emsdk" install "$EMSDK_VERSION" >/dev/null
  "$emsdk/emsdk" activate "$EMSDK_VERSION" >/dev/null
fi
# shellcheck disable=SC1091
source "$emsdk/emsdk_env.sh" >/dev/null 2>&1

# SameBoy's DMG boot ROM, assembled from its source (MIT; not Nintendo data, see D14).
rgbasm=$(cd "$root" && mise which rgbasm)
PATH="$(dirname "$rgbasm"):$PATH" make -s -C "$sameboy" "BIN=$tmp/bin" "OBJ=$tmp/obj" \
  "$tmp/bin/BootROMs/dmg_boot.bin" >/dev/null 2>&1
(cd "$root" && mise exec -- node -e '
  const b = require("fs").readFileSync(process.argv[1]);
  console.log("static const unsigned char dmg_boot[] = {" + [...b].join(",") + "};");
' "$tmp/bin/BootROMs/dmg_boot.bin") > "$tmp/dmg_boot.h"

core=()
for f in gb sgb apu memory mbc timing display camera sm83_cpu joypad save_state random rumble; do
  core+=("$sameboy/Core/$f.c")
done
emcc -O3 -flto -std=gnu11 -D_GNU_SOURCE -DGB_INTERNAL -DGB_VERSION='"pokehd"' \
  -DGB_COPYRIGHT_YEAR='"2026"' -DGB_DISABLE_TIMEKEEPING -DGB_DISABLE_REWIND \
  -DGB_DISABLE_DEBUGGER -DGB_DISABLE_CHEATS -DGB_DISABLE_CHEAT_SEARCH -w \
  -I"$sameboy" -I"$tmp" -ffile-prefix-map="$root"=. \
  "${core[@]}" "$here/wrapper.c" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker -sFILESYSTEM=0 -sMALLOC=emmalloc \
  -sALLOW_MEMORY_GROWTH=1 -sEXPORTED_FUNCTIONS=_malloc,_free '-sINCOMING_MODULE_JS_API=["wasmBinary"]' \
  '-sEXPORTED_RUNTIME_METHODS=["HEAPU8","HEAP16","HEAPU16","HEAPU32"]' \
  -o "$tmp/sameboy.mjs"

mkdir -p "$out"
cp "$tmp/sameboy.mjs" "$tmp/sameboy.wasm" "$out/"
chmod 644 "$out/sameboy.mjs" "$out/sameboy.wasm"
printf 'sameboy.wasm: %d bytes, %d gzipped\n' "$(wc -c < "$out/sameboy.wasm")" "$(gzip -9c "$out/sameboy.wasm" | wc -c)"
