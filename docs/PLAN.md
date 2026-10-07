# Plan

The roadmap, task specs and coordination rules. Task IDs match the status dashboard
(`tasks/<id>` documents). Read `CLAUDE.md` and `docs/DECISIONS.md` first.

## How work is organised

### Roles

- **Coordinator** (one thread): owns this file, the dashboard and the merge queue. Breaks work
  into tasks, dispatches them to worker threads, reviews PRs, keeps tracks from colliding, and
  escalates decisions that belong to Nick. Doesn't do large implementation work itself.
- **Workers** (one thread per task): implement one task on its own branch and open a PR.
- **Nick**: technical advisor and art director. Decides anything visual (picks between
  options), anything touching the non-negotiables, and scope changes.

### Rules

1. **One task, one branch, one PR.** Branch `claude/<task-id>`. Keep PRs small enough to
   review in one sitting; split a task rather than ship a giant PR.
2. **Claim before starting.** Set the task's dashboard status to `doing` with a note naming the
   thread. Set `blocked` with a reason when stuck; `done` when merged.
3. **Stay in your track's packages** (see Tracks). Changes to another track's package, to shared
   config (`tsconfig.base.json`, `mise.toml`, `pnpm-workspace.yaml`, CI) or to public interfaces
   between packages go in their own small PR, flagged to the coordinator.
4. **CI must pass** (lint, typecheck, test, build). Tests that need the ROM use
   `describe.skipIf(!romAvailable)` so they skip in CI without it.
5. **Merging:** the coordinator merges green PRs. Anything that changes the look, a
   non-negotiable or a decision in `docs/DECISIONS.md` waits for Nick.
6. **Visual work is shown, not described.** Post screenshots (or short clips) to the dashboard
   dev log as artifact assets. When there's a choice, show options side by side and ask Nick.
7. **Record decisions** in `docs/DECISIONS.md` (new entry, never rewrite history) and post a
   dev log entry.
8. **Never commit Nintendo data** (ROM, extracted graphics, dumps). Generated assets live in
   gitignored paths. Screenshots of our renderer for the dashboard are fine.

### Getting the ROM in a sandbox

`pnpm rom:fetch` downloads and verifies `rom/pokeblue.gb` using `POKEHD_DEV_ROM_TOKEN` from the
environment. To read the disassembly source: `git submodule update --init vendor/pokered`. To
rebuild `pokeblue.sym`: `pnpm rom:build-disasm` (needs rgbds from `mise.toml`).

## Tracks

Tracks can run in parallel. Each owns specific packages.

| Track | Owns | Starts | Depends on |
|---|---|---|---|
| **A. World data** | `packages/rom` | now | — |
| **B. Emulator** | `packages/emu` (new) | now | — |
| **C. Look-dev** | `packages/engine` render pipeline | now | — (placeholder geometry until A lands) |
| **D. World renderer** | `packages/engine/world` | after `p0-extract` | A, C |
| **E. Multiplayer** | `packages/protocol`, worker Durable Objects | after `p1-emu` | B |
| **F. App shell** | `apps/web/src/client` | as needed | — |

Integration points between tracks are TypeScript interfaces; define them first in a small PR
and get the coordinator's sign-off before building on them.

## Phase 0: Foundations and look-dev

Done: `p0-rom`, `p0-repo`, `p0-scaffold`, `p0-deploy`, `p0-devrom`.
In progress: `p0-ci` (Nick's Hearthstone runner PR).
Not needed: `p0-access` (friends join with invite codes instead, D19).

### p0-symbols: typed symbol table (Track A)
Generate `packages/rom/src/generated/symbols.ts` from `vendor/pokered/pokeblue.sym` with a
script in `tools/` (`pnpm rom:symbols`). Each entry: `{ bank, address }` plus a helper converting
to a ROM file offset (`bank * 0x4000 + (address - 0x4000)` for banked ROM; bank 0 is direct) and
a WRAM address for `w*` symbols. Generate only the symbols we use (an allowlist in the script)
so the file stays small and reviewable; extend the list as tasks need more.
**Done when:** script regenerates the file deterministically; tests resolve a few known
symbols (e.g. `MapHeaderPointers` = `00:01ae`, `wCurMap` = `d35e`) against the ROM.

### p0-extract: map, tileset and collision extraction (Track A)
Parse from ROM bytes (formats documented in `vendor/pokered`):
- Map headers via `MapHeaderPointers` / `MapHeaderBanks` (see `data/maps/headers/*.asm`):
  tileset, height/width in blocks, block data pointer, connections (N/S/W/E), object data
  (warps, signs, NPCs; `data/maps/objects/*.asm`).
- Tileset headers via `Tilesets` (`data/tilesets/tileset_headers.asm`): bank, blockset
  pointer (4×4-tile metatiles), 2bpp graphics pointer, collision list pointer, grass tile,
  counter tiles, animation flags.
- Per-tileset semantic lists: `collision_tile_ids`, `door_tile_ids`, `ledge_tiles`,
  `warp_carpet_tile_ids`, `bookshelf_tile_ids`, `cut_tree_blocks`, `spinner_tiles`,
  `pair_collision_tile_ids` (all in `data/tilesets/`). Where these are code rather than tables,
  port them as committed constants with a comment pointing at the source.
- Decode 2bpp tile graphics to 2-bit index arrays (no colour yet).
Output a typed `WorldData` model. Units: 1 tile = 8 px; 1 block = 4×4 tiles; 1 player step =
2×2 tiles (16 px).
**Done when:** all maps parse; a test checks Pallet Town (map 0) is 10 blocks wide × 9 tall, uses
the OVERWORLD tileset and connects north to Route 1 and south to Route 21; a debug page in `apps/web` (dev only) draws any
map flat in 2D from extracted data, with a map picker.

### p0-labels: semantic label table and review viewer (Track A + F)
Assign every tile in every tileset a semantic (`ground`, `grass`, `tall-grass`, `water`,
`tree`, `roof`, `wall`, `door`, `window`, `fence`, `ledge`, `sign`, `flower`, `counter`, …).
Seed from the ROM's lists; fill the rest by hand in `packages/rom/src/labels/<tileset>.ts`.
Add a dev-only viewer: tileset grid, colour-coded by label, click to inspect.
**Done when:** every tile in the tilesets used by Pallet Town, Route 1 and Viridian City is
labelled, and Nick has reviewed them in the viewer.

### p0-lookdev: lighting rig, sky and tuning panel (Track C)
In `packages/engine`: a render pipeline with directional sun plus sky light, shadow maps,
time-of-day driving sun angle and colour (morning ↔ late afternoon, never night),
post-processing (depth of field with a tilt-shift feel, bloom, ambient occlusion, fog,
colour grading via LUT, vignette) and a Tweakpane panel (dev only) exposing every parameter,
with presets saved to JSON. Build against placeholder geometry (a few boxes and a billboarded
pixel sprite) until real maps land.
**Done when:** the panel tunes everything live; presets load and save; 60fps at 1440p on
Nick's Mac; screenshots posted to the dashboard.

### p0-styles: Pallet Town and Route 1 in competing styles (Track D)
Using `p0-extract` and `p0-labels`, generate 3D from tiles in 2–3 distinct approaches, e.g.:
1. **Extruded diorama:** terrain as tiles on a heightfield (ledges as steps), buildings
   extruded from roof/wall regions with gabled roofs, trees as cards or voxelised tiles.
2. **Voxel:** every tile's pixels become voxel columns with depth from shade.
3. **Hybrid:** extruded architecture, voxel props, instanced grass blades, shader water.
Sprites are crisp billboards in all three. Present them side by side on a dev page with the
same camera presets.
**Done when:** Nick has picked a direction (record it in `docs/DECISIONS.md`).

## Phase 1: Playable HD overworld

### p1-emu: choose and integrate a WASM Game Boy core (Track B)
Spike first: compare candidates (e.g. binjgb, SameBoy, Gambatte compiled to wasm) on accuracy,
serial/link support, memory read/write API, ability to hook on PC (breakpoints or a patchable
step loop), save states, size and speed. Write the choice up as a decision. Then build
`packages/emu`: load ROM, run at 59.73 Hz, input, audio, SRAM load/save, WRAM read/write,
PC hooks by symbol name.
**Done when:** the game boots and is playable in a plain 2D canvas debug view in `apps/web`,
with audio; a WRAM read of `wCurMap`/`wXCoord`/`wYCoord` tracks the player.

### p1-state: drive the HD overworld from live game state (Track D + B)
Each frame read map ID, player position and direction, walk animation offsets and NPC sprite
state (`wSpriteStateData1/2`) and render them in the 3D world, including connected maps and
warps (doors, cave entrances). Smoothly interpolate movement.
**Done when:** you can walk from Pallet Town through Route 1 into Viridian City in HD.

### p1-input: keyboard, gamepad and touch (Track F)
### p1-saves: SRAM persistence in IndexedDB, plus cloud backup to R2 per player (Track B + F)
### p1-colour: SGB palette baseline (Track C)
Extract SGB palettes (`data/sgb/sgb_palettes.asm`, `SetPal_Overworld` in
`engine/gfx/palettes.asm`) and map each 4-shade ramp to a richer ramp. Per-town grading derived
from the town's palette.

## Phase 2: Text, menus and battles

### p2-text: re-typeset text boxes and menus
Decode the window/BG tilemap through the charmap (`constants/charmap.asm`) and render text
boxes and menus as styled overlays with a modern font; the game still drives them.
### p2-battles: HD battle scenes
3D arenas per environment, lit billboarded battle sprites, move effects keyed off the
animation the game is playing.

## Phase 3: Multiplayer

### p3-link-spike: link cable feasibility (Track E, start right after p1-emu)
Two emulator instances in one page joined by an in-memory serial bridge; complete a trade and a
battle. Then insert artificial latency (50/100/200 ms) and find where the protocol breaks
(`engine/link/cable_club.asm`, `Serial_ExchangeByte`). Report what synchronisation strategy
works before building the networked version.
### p3-rooms: room Durable Object, presence, friends as ghosts (Track E)
Server first (PR 1): invite codes and players in a `Directory` Durable Object (D19), the
`/api/join`, `/api/me` and admin routes, and a `Room` Durable Object (hibernatable WebSockets)
at `/api/room` that greets each player with everyone's presence and relays presence changes.
Presence mirrors p1-state-read's `Player` plus the map ID. Room messages live in
`packages/protocol/src/room.ts`; a `link` message carries a D17 `LinkMessage` to one named
friend, in order, for p3-link. Next: the client side (join screen, a room connection that sends the local player's
presence from the state decoder) and ghosts drawn by `LiveWorld` on the same map, after p1-play.
**Done when:** two friends on different machines see each other walk around in the deployed build.
### p3-gifts: mailbox patch and gifting (money, items, Pokémon)
### p3-link: networked link cable for trades and battles

## Phase 4: Polish

### p4-bundle: code-split three.js; Playwright screenshot regression tests
### p4-vlm-colour: offline vision-model colourisation of sprites (see D11)

## Open questions for Nick

- Name and URL: keep `pokehd.nick-01a.workers.dev` or add a custom domain?
