# p1-emu spike: which Game Boy core

Throwaway. Compares binjgb, SameBoy and Gambatte compiled to wasm, to back the proposed **D14** in
`docs/DECISIONS.md`. Nothing here is imported by the app; B2 builds `packages/emu` once D14 is
agreed. No ROM, boot ROM or screenshot is committed.

## What was run

`build.sh` clones each core at a pinned commit and builds it with Emscripten 6.0.11 (`-O3 -flto`)
together with a ~30-line wrapper in `wrap/` that exposes the same API for every core: new, keys,
run one frame, read/write memory, a PC hook on one address, save and load state.
`compare.mjs` then runs the same script on each core under Node 22 (V8, as in Chrome) on a
2.1 GHz cloud Xeon:

1. Boot the dev ROM and mash A (with occasional Down/Start) until a PC hook on `OverworldLoop`
   (00:03ff, from `pokeblue.sym`) fires, i.e. a new game has reached the overworld.
2. Read `wCurMap`/`wXCoord`/`wYCoord` from WRAM.
3. Run 1,200 frames in the overworld without a hook, then 1,200 with a hook on `DelayFrame`
   (00:20af, called once per frame).
4. Save state, walk the player, load state, re-read position.

## Results

| | binjgb | SameBoy | Gambatte (gambatte-core) |
|---|---|---|---|
| Licence | MIT | MIT (Expat) | **GPLv2** |
| Upstream | binji/binjgb, 1 maintainer, last commit 2026-09-25 | LIJI32/SameBoy, very active, 2026-10-04 | original repo went private; pokemon-speedrunning fork, 2026-04-16 |
| Boots Blue to Red's room (map 0x26, x 3, y 6) | yes | yes | yes |
| wasm size, gzip | **29 KB** (83 KB raw) | 77 KB (182 KB raw) | 202 KB (678 KB raw) |
| Speed, overworld, frames/s (×realtime) | ~3,400 (57×) | ~600 (10×) | ~12,500 (210×) |
| Speed with a PC hook active | ~3,300 | ~550 | ~11,000 |
| PC hook | bitmap of banked-PC breakpoints, **only in its `RGBDS_LIVE` build**; returns from `run_until` with an event | per-instruction execution callback (C); bank via MBC state | per-instruction exec callback |
| Memory read/write | `emulator_read_mem`/`write_mem`, direct WRAM pointer | `GB_safe_read_memory`/`GB_write_memory`, `GB_get_direct_access`; read and write **watch callbacks** | `externalRead`/`externalWrite`; read/write callbacks |
| Save states | yes, 195 KB, round trip OK | yes (BESS format), 82 KB, round trip OK | yes, 65 KB, round trip OK |
| Link cable | **none**: serial always shifts in 0xFF, external clock never completes; needs a patch in our fork | **bit-level callbacks** (`GB_set_serial_transfer_bit_start/end_callback`), which SameBoy's own frontends use to link two instances in one process | byte-level `setLinkCallback`/`linkStatus`, as BizHawk's linked-GB core uses |
| Boot ROM | none needed | needs one; SameBoy ships its own MIT boot ROM source, built here with the rgbds we already pin | `NO_BIOS` flag |
| Accuracy (per each README) | "cycle accurate, passes many timing tests"; ample for Gen 1 | passes all blargg, mooneye and Wilbert Pol tests | built around an extensive hardware test suite |

Speeds varied ±10% between runs. Every core is far past the 59.73 Hz we need; even SameBoy runs
two linked instances at ~5× realtime on this CPU. Phones will be a few times slower, which is why
B2 should run the core in a Web Worker either way.

mGBA (MPL-2.0) was kept as a reference point only and not built: it's a GBA-first codebase with a
much larger wasm, and offers nothing for DMG here that SameBoy lacks.

## Reading the results

- **Gambatte is out** on licence. Shipping its wasm to friends is distribution under GPLv2,
  which pulls `packages/emu` (and arguably the bundle) under the GPL with a source offer. Its
  speed lead doesn't matter at these margins, and upstream going private is a maintenance flag.
- **binjgb vs SameBoy** is size and speed against features. binjgb is tiny and fast, but the
  two things this project leans on hardest are missing or build-gated: link cable (D12's main
  risk) would be our own fork's serial code, and PC hooks need the `RGBDS_LIVE` build, which also
  carries an `EM_ASM` callout we'd remove. SameBoy has exec, read and write callbacks and a
  link-cable API upstream, used and maintained by its author for exactly the two-instance case
  p3-link-spike starts with.
- 48 KB more gzip and ~5× the CPU of binjgb is a cheap price for not owning the riskiest code.

## Reproduce

```sh
# emcc on PATH (emsdk), mise toolchain installed, ROM at rom/pokeblue.gb (pnpm rom:fetch)
spikes/emu/build.sh /tmp/emu-spike
node spikes/emu/compare.mjs /tmp/emu-spike/out rom/pokeblue.gb /tmp/emu-spike/out/dmg_boot.bin binjgb-live,sameboy
IDLE=100 node spikes/emu/compare.mjs /tmp/emu-spike/out rom/pokeblue.gb /tmp/emu-spike/out/dmg_boot.bin gambatte
```
