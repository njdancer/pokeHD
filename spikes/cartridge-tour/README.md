# Cartridge to Screen

A game-like 3D walkthrough of Pokémon Blue loading Pallet Town, from the cartridge's bytes to
the screen's pixels. It is published as a private artifact, never served from our site, because
the page embeds the ROM bytes it shows.

- `trace.ts` records the real game (SameBoy, `packages/emu`) leaving Red's house and walking 3
  steps right and 3 up, with hooks on every routine involved.
- `src/model.js` is a byte-level model of those routines, written against the pret disassembly.
  Every write carries its provenance (where the byte came from). `check.mjs` and
  `check-walk.mjs` compare it with the recording: every written byte, every frame's state and
  the screen pixels.
- `src/app/*.js` is the page: the board (three.js), the playback engine, the levels and the UI.
  `src/shell.html` is the page around it.
- `build.mjs` runs the model on the ROM to find the bytes the page needs and writes
  `out/index.html` (the artifact) and `out/preview.html` (the same page with a document
  skeleton, for local testing). `out/` is gitignored: it contains ROM bytes.

```sh
pnpm rom:fetch                      # if rom/pokeblue.gb is missing
node spikes/cartridge-tour/gen-syms.mjs <syms.json>
node spikes/cartridge-tour/trace.ts <trace dir> <syms.json>
node spikes/cartridge-tour/check.mjs <trace dir> <syms.json>
node spikes/cartridge-tour/check-walk.mjs <trace dir> <syms.json>
node spikes/cartridge-tour/build.mjs <trace dir> <syms.json>
```

`syms.json` maps every label to `"BB:AAAA"`, from `packages/rom/src/generated/explorer-db.ts`.
