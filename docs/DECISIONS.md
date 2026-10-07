# Decisions

Settled decisions and why. Don't reopen one without new information; if you do, add a new entry
that supersedes the old one rather than editing history. Newest last.

## D1. Run the real ROM in an emulator; never reimplement game logic

Nick wants behaviour identical to the original (drop rates, stats, AI, glitches). Emulation gives
that for free. A reimplementation (from pret/pokered data plus a new engine) was the alternative;
it would have allowed true co-op questing but costs a full battle and script engine rewrite.
Nick's multiplayer goals turned out to fit emulation: friends occupy the same world as
"ghosts" (each player has their own game state), and they help each other through gifts
(money, items, Pokémon) and link-cable trades and battles. **Known limitation:** friends can't
join each other's battles, and each player sees their own story state (a friend may walk
through a Snorlax that's still blocking the road in your game). Accepted.

## D2. TypeScript and Three.js, not Rust/Bevy

Nick was open to Rust/Bevy. Rejected because its strengths (ECS, raw performance) solve
problems this project doesn't have (tiny maps, logic inside the emulator), while its costs
(slow wasm compile, big binaries, API churn every release) land on visual iteration speed,
which is the point of the project. Three.js's WebGPU renderer and TSL node materials give us
the modern pipeline.

## D3. Plain Three.js in a framework-free engine; React for UI chrome only

`packages/engine` owns the canvas and frame loop; React mounts it once. No react-three-fiber:
the scene is generated from ROM data and driven by emulator state at 60fps, the opposite of
R3F's strength (declarative, hand-authored scenes). Engine→UI state via a vanilla Zustand store.

## D4. Vite SPA + Hono on one Cloudflare Worker; no SSR framework

Nick first suggested React Router, then proposed Hono as something simpler; we went with a
plain Vite + React SPA and a Hono Worker. SSR adds nothing to a full-screen WebGPU canvas and fights client-only
rendering. One Worker serves static assets (SPA fallback), `/api/*` via Hono, and later the
room Durable Objects.

## D5. Toolchain pinned with mise; pnpm workspaces

Nick's preference. Everything (node, pnpm, rgbds) lives in `mise.toml`; nothing global.
TypeScript 6 (not 7) because the Vite/Cloudflare tooling targets 6.

## D6. CI on GitHub Actions using the mise toolchain

Cloudflare Workers Builds was rejected because it can't read `mise.toml` (the toolchain would be
defined twice). GitHub-hosted runners are blocked by an account billing issue, so Nick is moving
jobs to self-hosted VMs on his Mac via his "Hearthstone" node (separate PR). Deploys use the
account-owned `pokehd-github-actions` Cloudflare token stored as `CLOUDFLARE_API_TOKEN`.

## D7. No Nintendo data in the repo or on servers, with one testing exception

Players supply their own ROM; everything is derived from it client-side. Exception: Nick's ROM
in the private R2 bucket behind a token (see CLAUDE.md). Agents fetch it with `pnpm rom:fetch`.

## D8. Pixel art stays crisp; HD comes from everything around it

No xBR/HQx-style smoothing. HD-2D (Octopath Traveler, the Dragon Quest III remake) keeps
characters as pixel sprites and spends fidelity on geometry, lighting, materials, depth of
field, bloom, fog and colour grading.

## D9. Always daytime, drifting from morning to late afternoon

Gen 1 has no clock. Nick wants atmosphere without night: the sky and lighting cycle between
morning and late afternoon. If this project grows to later generations, their real clock can
drive it.

## D10. World art is generated from ROM data plus a reviewed label table

Fully automatic semantics are impossible (the data doesn't say a tile is a roof or a fence),
but most come for free: collision lists, door, ledge, warp, grass and water tiles, and
bookshelf tiles are defined per tileset in the ROM. The remainder goes in a small
committed label table (tileset, tile ID → semantic), which Nick reviews in a viewer. Nick does
no hand art; he gives preferences between options.

## D11. Colour: in-ROM SGB palettes first; vision-model palettes later

The ROM carries Super Game Boy palettes (per town, per Pokémon). The baseline maps each 4-shade
ramp to a richer ramp (hue-shifted shadows and highlights). Later (P4) an offline job can ask a
vision-capable model for per-region colours of each sprite (it knows what each Pokémon looks
like) and bake them into a reviewed palette file. Nothing generated ships without review.
Alternative colourisations (e.g. pokered-gbc's palettes) can be optional, user-supplied skins.

## D12. Multiplayer: link cable over the network for trades/battles; mailbox patch for gifts

Trades and battles use the game's own link-cable code (emulated serial over WebSockets via a
room Durable Object), so they behave exactly as the original. Pokémon Showdown's Gen 1 engine
was the alternative; rejected because it differs subtly from the cartridge. **Main technical
risk:** the serial protocol's latency tolerance. Gifts are written into WRAM only at a safe
point: a small assembly patch adds a mailbox check to the overworld loop.

## D13. Rendering is state-driven for the overworld, screen-driven for text

The HD camera sees far more than the Game Boy's 10×9-tile screen, so the overworld renders whole
maps (and connected neighbours) from ROM data, positioned by WRAM state. Text boxes and menus
are decoded from the window tilemap via the charmap and re-typeset with a modern font.

## D14. Emulator core: SameBoy, compiled to wasm

Approved by Nick on 2026-10-07 after the p1-emu spike. Evidence and reproduction in
`spikes/emu/README.md`. SameBoy also had far more recent upstream activity than binjgb (69 vs 14
commits in the past year), though mostly from one author; we pin a commit either way.

Use SameBoy's core (`Core/*.c`, Expat/MIT licence) built with Emscripten into `packages/emu`,
pinned to a commit, with a thin C wrapper and the debugger, rewind and cheat modules compiled
out. Run it in a Web Worker as a DMG (not SGB: D11 takes palettes from the ROM ourselves). Use
SameBoy's own MIT boot ROM, built from its source with the rgbds we already pin; it isn't
Nintendo data, so committing or serving it is fine.

Why: all three candidates booted Blue to Red's room with the same input script and passed WRAM
reads, PC hooks and save-state round trips. The differences are in what we'd have to own.
SameBoy has upstream APIs for everything p1–p3 need: per-instruction execution callbacks (PC
hooks by symbol, checked in C and only crossing into JS on a hit), read and write watch
callbacks (useful for the gift mailbox), BESS save states, and bit-level link-cable callbacks
that its author uses to link two instances in one process, which is p3-link-spike's first step.
It's also the most accurate open core. Cost: 77 KB gzip and ~600 frames/s on a cloud Xeon
(10× realtime), against binjgb's 29 KB and ~3,400 frames/s. Both are far past 59.73 Hz.

Alternatives: **binjgb** (MIT, smallest and fast) has no link cable at all (serial always reads
0xFF) and PC hooks only in a special build, so D12's main risk would sit in our own fork; it's
the fallback if SameBoy's CPU cost bites on phones. **Gambatte** (gambatte-core fork) is rejected:
GPLv2 would put `packages/emu` and the shipped wasm under the GPL once friends load it, its
original repo went private, and its wasm is the largest (202 KB gzip). **mGBA** (MPL-2.0) was a
reference point only; a GBA-first core with nothing extra for DMG.

## D15. The look: a day cycle of Golden hour → Diorama → Golden hour

From the p0-lookdev presets (Diorama, Clear day, Golden hour, Storybook), Nick sat between
Diorama and Golden hour, disliked Clear day, and left the call to Claude. The engine blends three
looks across the day: Golden hour in the morning, Diorama at midday, Golden hour again in the late
afternoon. Mornings still read paler than afternoons because the sun's own colour and angle
follow the time of day. What this commits to: a filmic AgX tone curve, a strong tilt-shift
miniature feel, soft shadows, light haze and gentle bloom. Clear day (flat, saturated, little
blur) was dropped. Every value stays tunable in the `?lookdev` panel; refine within this
direction rather than reopening it.

## D16. The day runs forwards into a low evening, and wraps to morning out of sight

Supersedes D9's "drifting between morning and late afternoon". Ping-ponging the clock made the
sun visibly reverse and shadows swing back, and Nick wanted an evening with long, low shadows.
The sun now only moves east to west: morning (phase 0, low in the east) to evening (phase 1,
about 9° above the western horizon). After an evening hold the clock wraps to morning. In-game
the wrap happens inside one of Gen 1's own fades to black (doors, caves, route changes) through
`look.wrapToMorning(true)`, so it's never seen; the look-dev preview fades out and back in
instead. Still never night.
