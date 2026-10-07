# pokeHD

A web-based HD-2D presentation of Pokémon Blue (USA/Europe), with friends-only multiplayer
(shared-world presence, gifting, link-cable trades and battles over the network).

## Non-negotiables

- **Game behaviour is the original.** The real ROM runs in an emulator; we never reimplement
  game logic. Drop rates, stats, AI, glitches, RNG: all untouched. New features (gifting,
  presence) touch game state only through well-defined safe points (see "State injection").
- **No Nintendo data in the repo or on any server.** No ROM, no extracted graphics, no
  disassembly-derived PNGs committed or served. Every player loads their own ROM in the browser;
  all assets are derived from it client-side. Symbol addresses, structure layouts and our own
  label tables are fine to commit. `.gitignore` enforces the obvious cases. Check before adding
  any binary or image.
- **Keep it private.** The GitHub repo is private. Don't name public things "Pokémon".
- **Visuals are the point.** Pixel art stays crisp (no xBR/HQx smoothing on sprites); the
  HD treatment comes from 3D geometry, lighting, materials and post-processing. It's always
  daytime, but time of day drifts between morning and late afternoon for atmosphere.

## Reference ROM

- `rom/pokeblue.gb` (gitignored). SHA-1 `d7037c83e1ae5b39bde3c30787637ba1d4c48ce2`.
- `vendor/pokered` is the pret disassembly (git submodule). It builds a byte-identical ROM and
  `pokeblue.sym`, our source of truth for every routine and RAM/ROM address.
  Build: `make -C vendor/pokered blue` (needs `rgbds` 1.0.4, `brew install rgbds`).
  Use the disassembly's source as documentation for data formats, but **extract data from the
  ROM bytes at runtime**, never by bundling files from `vendor/`.

## Architecture (TypeScript end to end)

- `packages/rom`: isomorphic ROM parsing (maps, tilesets, blocksets, sprites, palettes, text
  charmap) addressed via generated symbols. Runs in Node (tools/tests) and the browser.
- `apps/web`: Vite + Three.js (WebGPU renderer, TSL node materials) client.
- Later: `packages/emu` (WASM Game Boy core + hooks), `apps/server` (Cloudflare Worker +
  Durable Objects for rooms).

Rendering is **state-driven** for the overworld (read map ID and coordinates from WRAM, render
the whole map plus its connections from ROM data, not the 160×144 screen), and **screen-driven**
for text and menus (decode window tiles via the charmap and re-typeset them).

### State injection

Three levels, in order of preference: (1) read/write WRAM at emulator-level hook points named by
`pokeblue.sym`; (2) a small assembly patch adding a "mailbox" check in the overworld loop, so
gifts land only at safe moments; (3) bigger ROM patches, shipped as a patch applied in-browser.

## Working conventions

- pnpm workspace. Node 24. TypeScript strict.
- Commit small and often with descriptive messages; push to `origin main` (private GitHub repo).
- **Status dashboard**: https://claude.ai/artifact/UUefXDjuKGfRUNtF6SLNNQ (source in
  `dashboard/status.html`). Keep it current with the `ArtifactData` tool:
  `project/meta` (headline, phases, currentPhase, repo, updatedAt), `project/metrics`
  (`items: [{label, value, unit?, hint?}]`), `tasks/<id>` (`title, status: todo|doing|done|blocked,
  phase, order, note?`), `devlog/<id>` (`ts` ISO, `title`, `body` with paragraphs, `- ` bullets,
  `code`, **bold** and links, `tags[]`, optional `images: [{url, caption}]` with urls from
  uploading screenshots as artifact assets). Post a dev log entry at every meaningful milestone
  or decision, and update tasks as they change state.
- The user is an experienced TS/3D developer acting as technical advisor: explain trade-offs,
  push back on bad ideas, show visual options side by side rather than picking silently.
