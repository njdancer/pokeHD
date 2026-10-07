# @pokehd/emu

The Game Boy, emulated by SameBoy's core compiled to wasm (D14). One `GameBoy` per instance,
synchronous, framework-free: it runs in a Web Worker in the app and in plain Node in tests.

```ts
const gb = await GameBoy.create({ rom, sram, sampleRate: audioContext.sampleRate });
gb.addHook("OverworldLoop", (gb) => {/* paused before that instruction; read/write safely */});
gb.setButtons(Button.A | Button.Right);
gb.runFrame();                  // ~59.73 times a second; the caller owns pacing
gb.readSymbol("wCurMap");       // WRAM by pokeblue.sym name (@pokehd/rom)
gb.frame;                       // 160×144 RGBA
gb.drainAudio();                // interleaved stereo int16 since the last call
gb.saveState(); gb.saveSram(); gb.sramDirty;
```

`runCycles(n)` steps by master-clock cycles instead of frames, for lockstep work such as the
link cable.

## The wasm build

`src/generated/sameboy.{mjs,wasm}` are committed build outputs, so nothing else needs
Emscripten. `pnpm --filter @pokehd/emu build:wasm` (`native/build.sh`) rebuilds them from the
pinned `vendor/SameBoy` submodule and `native/wrapper.c`, fetching Emscripten into
`~/.cache/pokehd/emsdk` on first run. The same inputs give byte-identical outputs; commit them
together with any wrapper or pin change. The boot ROM baked in is SameBoy's own (MIT), built
from source with the pinned rgbds.

## Extending the native API

New capabilities (the link cable's serial callbacks, for p3-link) go in `native/wrapper.c` as
`emu_*` exports, typed in `src/generated/sameboy.d.mts` and wrapped on `GameBoy`. SameBoy's
`GB_set_serial_transfer_bit_start_callback` / `..._bit_end_callback` are the entry points for
the link.
