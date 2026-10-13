# Plan

The roadmap, task specs and coordination rules. Task IDs match the status dashboard
(`tasks/<id>` documents). Read `CLAUDE.md` and `docs/DECISIONS.md` first.

## Where things stand (2026-10-08)

**Done and live:** ROM data (symbols, maps, tilesets, sprites, SGB palettes, charmap) and the
label tables; the emulator (SameBoy, D14); the look and day cycle (D15, D16); the Hybrid world
style (D18); live play in HD from Pallet Town to Viridian City; input; saves (local, cloud,
autosave and resume points, kid-proofing: D24, D25); place colour (D22); email sign-in (D23);
sharing Nick's cartridge (D26); friends' ghosts (D21), gifts (D20), and trades and battles over
the network (D17); the mobile quality tier and dynamic resolution (D27); the ROM explorer at
`/explore`; CI on the Mac runner with deploy on push to `main`. Text and battles are decoded into
data (`p2-text-read`, `p2-battle-read`); battles draw in HD (`p2-battles`, D28).

**In progress** (one thread each):

| Task | What | Waits on |
|---|---|---|
| `p1-interiors` | 2–3 interior looks (open room, dollhouse, walls down) side by side | Nick's pick |
| `p1-labels-more` | Labels for the remaining tilesets (forest, gates/museum and caves merged in #51) | — |
| `p1-transitions` | Hitches between maps, and the slow first frame without WebGPU | — |
| `p2-text` | HD text boxes and menus | Nick's pick of font and box style |
| `p2-tapfirst` | Tap-first UI (D32): own start screen, Oak in HD, keyboard names, real buttons | Nick's pick of panel look (`/dev/ui`) |
| `p2-slots` | Any number of saves per ROM, a save manager and a new intro with Resume (D39) | Nick's pick of the intro (`/dev/saves`); settings wait on the Pokédex menu's |
| `p2-dex-menu` | One menu around the Pokédex (D40): game hooks, play journal and world map, the menu on `/dev/menu` | Nick's pick of the hi-fi design |
| `p2-save-lock` | One device per save: a lease with a heartbeat, takeover, quiet ghosts leave (D41) | Done |
| `p4-bundle` | Code-splitting and Playwright screenshot regression tests | — |
| `p4-vlm-colour` | Sprite colour and relief models, on Nick's Mac (brief: project file `plan/vision-model.md`) | Bake-off results for Nick |

**Left after that:** a full end-to-end HD playthrough on Nick's Mac, and the open questions at
the end of this file.

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

Done: everything in this phase. `p0-ci` runs on Nick's Mac runner (since 2026-10-07); the look
is D15 and D16, the style D18 (Hybrid).
Not needed: `p0-access` (friends sign in by email with our own codes instead, D19 then D23).

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

Done: `p1-emu`, `p1-state` (as `p1-state-read`, `p1-state-render` and `p1-play`), `p1-input`,
`p1-saves` (local and cloud), `p1-autosave`, `p1-kidproof`, `p1-colour`, and labels for the
interiors on the route and for the forest, gates/museum and caves.
In progress: `p1-interiors`, `p1-labels-more`, `p1-transitions` (see the table at the top).

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
### p1-autosave: autosave through the idle point and resume points (Track B + F, D24)
### p1-kidproof: never lose progress on a child's phone (Track B + F, D25)
Cloud resume points, a save history with "Go back", the big erase question, a "Saved" toast,
a locked-down home-screen app and a grown-ups check in Settings.
### p1-interiors: interior looks (Track D)
Houses, Oak's lab and Pokémon Centers use a plain placeholder look. Build 2–3 options (open
room, dollhouse with side walls, walls down) in Red's house, Oak's lab and a Pokémon Center,
side by side for Nick to pick; record the pick as a decision.
### p1-labels-more: labels for the remaining tilesets (Track A)
Every tileset the game uses gets a label table, so nothing past Viridian renders flat.
### p1-transitions: smooth map transitions (Track D)
No hitch when crossing into a connected map or through a warp, and a faster first frame on
browsers without WebGPU (about 2.6 s today).
### p1-colour: SGB palette baseline (Track C)
Extract SGB palettes (`data/sgb/sgb_palettes.asm`, `SetPal_Overworld` in
`engine/gfx/palettes.asm`) and map each 4-shade ramp to a richer ramp. Per-town grading derived
from the town's palette.

## Phase 2: Text, menus and battles

Done: the data side, `p2-text-read` (`ScreenText`, `/dev/text`) and `p2-battle-read`
(`BattleState`), and `p2-battles`. In progress: `p2-text`, needing Nick's pick of a look.

### p2-text: re-typeset text boxes and menus
Decode the window/BG tilemap through the charmap (`constants/charmap.asm`) and render text
boxes and menus as styled overlays with a modern font; the game still drives them.
### p2-tapfirst: tap-first UI (D32)
The page's own start screen, Oak's introduction in HD, names typed on the device's keyboard
(Oak checks the invited name and a change renames the player) and real buttons on every HD
menu, all pressing the game's own buttons (`Controls`). Battle messages are HD boxes (tap to
read on). Battle menus (FIGHT, moves, PKMN, ITEM, RUN) are HD buttons answering the game's own
menu routines (D44), with the moves up front.
### p2-slots: save slots and the intro (D39)
Any number of saves per ROM, each with its own battery save, resume point and earlier saves;
duplicate, delete (to a bin), rename and start new at any time. First load opens an intro with
Resume (the last-played save's latest point), the save manager and settings. Done: slot storage
on the device and in the cloud, the existing save kept in place as the main slot. Next: the
intro and save manager on `/dev/saves`; settings reuse the Pokédex menu's panel.
### p2-dex-menu: one menu around the Pokédex (D40)
The closed Pokédex replaces Start and Select; tabs Pokémon, People, Inventory, Map and Me
(prototype and handoff in the project files, `dex-menu/`). Done: the game hooks in
`packages/emu/src/game/` (actions run with the game's own routines at the idle point; the game's
own questions answered by the page). Next: the play journal and stitched world map, then the menu
on `/dev/menu`; wired into the game only once Nick has picked.
### p2-battles: HD battle scenes
3D arenas per environment, lit billboarded battle sprites, move effects keyed off the
animation the game is playing. Built screen-driven (D28): pictures, sprites, flashes and shakes
read off the Game Boy screen and staged where the player stands; HD HP cards; the screen masked
to menus and text. `/dev/battle?fixture=battle-rival|battle-wild&arena=field|bases|stage` shows
it from states recorded by `tools/record-battles.ts`. Nick picked the on-the-spot arena (`field`, D28).

## Phase 3: Multiplayer

Done: everything in this phase (`p3-link-spike`, `p3-link-hooks`, `p3-rooms`, `p3-rooms-client`,
`p3-ghosts`, `p3-gifts`, `p3-link`). A 60 fps check of ghosts in the HD view on the Mac is folded
into the end-to-end playthrough.

### p3-link-spike: link cable feasibility (Track E, start right after p1-emu)
Two emulator instances in one page joined by an in-memory serial bridge; complete a trade and a
battle. Then insert artificial latency (50/100/200 ms) and find where the protocol breaks
(`engine/link/cable_club.asm`, `Serial_ExchangeByte`). Report what synchronisation strategy
works before building the networked version.
### p3-rooms: room Durable Object, presence, friends as ghosts (Track E)
Server first (PR 1): players in a `Directory` Durable Object (D19; email sign-in since D23), the
`/api/auth/*`, `/api/me` and admin routes, and a `Room` Durable Object (hibernatable WebSockets)
at `/api/room` that greets each player with everyone's presence and relays presence changes.
Presence mirrors p1-state-read's `Player` plus the map ID. Room messages live in
`packages/protocol/src/room.ts`; a `link` message carries a D17 `LinkMessage` to one named
friend, in order, for p3-link. Next: the client side (join screen, a room connection that sends the local player's
presence from the state decoder) and ghosts drawn by `LiveWorld` on the same map, after p1-play.
**Done when:** two friends on different machines see each other walk around in the deployed build.
### p3-gifts: mailbox patch and gifting (money, items, Pokémon)
### p3-link: networked link cable for trades and battles

## Phase 4: Polish

Both in progress. `p4-vlm-colour` grew (Nick, 2026-10-08): big models on Nick's Mac teach a
small model that ships and runs on the player's ROM at runtime; it outputs colour plus a face
(top, front, side) and height per pixel for relief. No baked model output is ever shipped.

### p4-bundle: code-split three.js; Playwright screenshot regression tests
### p4-vlm-colour: offline vision-model colourisation of sprites (see D11)

## Open questions for Nick

- None right now. (Name and URL: settled as `pokehd.dncr.me`, D29.)
