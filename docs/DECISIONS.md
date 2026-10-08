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

## D17. Link play: one emulator each, the game's link routines exchanged as messages

Nick chose this direction on 2026-10-07 ("patch the ROM/emulator rather than run two") after the
p3-link-spike first results; the spike then confirmed it. Amends D12's "emulated serial over
WebSockets". Evidence and reproduction in `spikes/link/README.md`.

`packages/emu` hooks the game's link routines at the emulator level by symbol (no ROM change):
`Serial_ExchangeBytes`, `Serial_SyncAndExchangeNybble`, `LinkBattleExchangeData` and
`Serial_ExchangeLinkMenuSelection`, plus the receptionist's connection handshake. When the game
enters one, its core waits (in a frame loop, so the screen stays live) for the friend's matching
message, writes the friend's data where the routine would have, and returns from the routine.
The room relays these messages in order; it knows nothing about serial timing.

Why: the game's serial code assumes a byte crosses the cable in ~1 ms. Forwarding bytes and
pausing the master per byte made a trade 3× slower at 50 ms one-way and deadlocked its closing
handshake from 100 ms; forwarding without pausing silently corrupted trades from 16 ms (the
received mon became species 253). With hooks a trade is ~20 messages each way and completed,
verified, at 0–500 ms, 5.5 s slower at 200 ms than at 0 ms. Every traded byte, random number and
battle action is still the game's own; only how they travel changes.

Alternative kept as the fallback: each client runs both Game Boys and only joypad input crosses
the network (input lockstep). It also worked at 0–200 ms with no hooks, at the cost of two
emulators per client and input delay.

## D18. World style: Hybrid

Picked by Nick on 2026-10-07 from the p0-styles comparison (`/dev/styles`, PR #10). Buildings
pop up from their Game Boy drawing: the bottom rows of a building's tiles become the front wall
and the rows above a gabled roof. Trees become rounded voxel volumes swelled from their pixels;
fences and signs become thin pixel slabs. Tall grass is instanced swaying blades, and water is an
animated shader on the pixel grid. Terrain is the tile grid with raised ledges.

Alternatives: **Extruded diorama** (the same buildings, with trees and props as flat cut-out
cards) was cleaner but flatter from low angles. **Voxel** (every pixel a column) gave great ground
texture but turned buildings into slabs, because the Game Boy draws walls as if seen from above.
Every dimension stays a tunable `StyleParams` value; refine within this direction.

## D19. Friends join with invite codes; a player is a name and a session cookie (superseded by D23)

Nick chose invite codes over Cloudflare Access on 2026-10-07. Nick makes a code (`pnpm invite`,
authorised by the `ADMIN_TOKEN` Worker secret) and sends it to a friend; the friend enters it
with a display name and becomes a player. Codes are 12 Crockford base32 characters
(`XXXX-XXXX-XXXX`, 60 bits), work once and expire after 7 days. Joining sets a long-lived
`__Host-` session cookie (HttpOnly, Secure, SameSite=Strict); that cookie is the identity the
room, gifts and cloud saves use. A signed-in player can make a one-hour device code to sign the
same player in on another device. Nick can list players and remove one, which ends their
sessions. Only SHA-256 hashes of codes and session tokens are stored, in a `Directory` Durable
Object (SQLite); no D1 database or other setup is needed beyond the secret.

Why: friends don't need a Cloudflare or Google account, or an email on an allowlist, and
joining is one code typed on a phone. The cost is that we own the account logic (small, and
covered by tests), and that a lost cookie on a player's only device loses the player unless
Nick removes them and sends a new invite. Since the API and room are the only things behind
the gate, the static site stays public; a ROM is still needed to play, and no game data is
served.

Alternative: **Cloudflare Access** (one-time PIN email or Google login on an allowlist) would
have given identity for free but put a login wall on every page and needed each friend's email.

## D20. Gifts land through a PC hook on the overworld loop, calling the game's own routines

Approved by Nick on 2026-10-07 after the p3-gifts-spike, with the three rules at the end. Amends D12's "a small assembly patch adds a mailbox check to the
overworld loop". Evidence and reproduction in `spikes/gifts/README.md`.

`packages/emu` hooks `OverworldLoop` by symbol (no ROM change, CLAUDE.md level 1). When the
player is standing still with no menu, text, script, battle or warp in progress, the hook makes
the CPU call the game's own routines with the inputs its own callers use, then resume the loop:
`AddBCDPredef` for money (as Pay Day does), `AddItemToInventory` for items (as NPC gifts do),
and `AddEnemyMonToPlayerParty` for a Pokémon (the Trade Center's routine, so the friend's
44-byte struct, OT and nickname land byte for byte). With a full party the Pokémon goes to the
current box: there the game has no routine for a ready-made mon, so we append it in the PC's
layout and set the Pokédex flags with the game's `FlagActionPredef`. A gift that doesn't fit
(full bag, full party and box, money over ¥999,999) waits in the queue untouched.

Why: the spike's ROM test gave money, items and Pokémon (party and box), saved with the game's
own `SaveGameData`, rebooted from the battery save and found them all, and held gifts that
didn't fit without changing anything. A mailbox patch would run its check at the same
instruction and call the same routines, so it isn't safer; it adds a modified ROM, a second
hash to pin, assembly for the idle check, and mailbox bytes in WRAM, to buy emulator
independence D14 doesn't need. It stays the fallback if a future core can't hook.

Rules that come with it:
- A gift counts as delivered only once a save containing it is written; until then the server
  keeps it pending and the client re-delivers it after a reboot, with a ledger of applied gift
  IDs kept next to the save so it never lands twice.
- The receiver checks a gifted Pokémon's species, level, moves and names before it reaches the
  game.

- Sending a gift makes the sender's game save first, as the Cable Club does before a trade, so
  a friend who reloads an older save can't keep what they gave away.
- Key items can't be gifted: they would skip story steps.
- A Pokémon gift goes to the current box when the party is full, as the game's own gifts do.

## D21. Friends' ghosts: a green palette swap with a name tag

Nick picked "tint-tag" on 2026-10-07 from the p3-ghosts comparison (`/dev/live?ghost=<look>`,
PR #24). A friend's ghost uses the player's billboard with a green cap and yellow shirt, and a
small name label above the head. Ghosts trail their newest presence by 100 ms so network jitter
doesn't show.

Alternatives (Claude's notes, not Nick's words): **plain** (the player's own colours) can't be
told apart from you; **translucent** looks faded and loses detail under the tilt-shift blur;
**tint** or **tag** alone each work, but together they're clearest. Name tags soften with the depth of
field away from the focus; drawing them after post-processing is a later refinement if needed.

## D22. Place colour: each town's SGB colour on its roofs, its people and a light grade

Claude's call while Nick was away (p1-colour, 2026-10-07), flagged for his review. Implements
D11's baseline. On a Super Game Boy the overworld is one palette per town (routes share one):
near-white, the town's colour, a pale blue and near-black, sprites included. Painting the HD world
with those four colours would flatten it, so the town colour goes where it reads as identity:

- **Roofs** take the town colour as a hue-shifted ramp (Viridian green, Cerulean blue, Vermilion
  orange, Lavender purple, Celadon mint…). Everything else keeps the base label ramps.
- **People** wear it, as on the Super Game Boy. The player is always red (PAL_REDMON), restoring
  a colour lost when ROM sprite sheets replaced the placeholder (PR #36).
- **The grade** leans midtones toward it (`grade.placeTint`, 0.15), eased over about a second
  as the player crosses into a town. Black and white stay put.
- Buildings take the palette of the town or route outside (wLastMap), as the game does.
- Pallet Town's colour is almost white, so its roofs stay the base red and its grade neutral;
  its people wear the palette's pale blue so no one is grey.

Alternatives: the literal four-colour SGB palette (authentic, but every surface turns one hue
plus pale blue, and it fights the lighting); tinting the ground per map (seams at map edges,
which a post grade avoids). `/dev/live?map=CERULEAN_CITY&sgb=0` shows the base look for comparison.

## D23. Friends sign in by email; Nick is the admin, set in the repo

Nick's call on 2026-10-08. Supersedes D19's invite and device codes and the `#dev=<token>` link.
A player is an email address. One mechanism, two ways in:

- **By email.** `/login` asks for an email; if it belongs to a player, Cloudflare Email Service
  (the `EMAIL` binding, sending from `pokehd@hearth.dncr.me`) sends a six-digit code that works
  for 15 minutes. Wrong guesses count against all of a player's emailed codes (5, then they
  stop), and a player gets at most one code a minute and five an hour. The answer never says
  whether an address is on the list.
- **By link.** Nick adds a friend by email and name from Settings, Friends (in the game) or
  `/login`, then copies a sign-in link to send himself or has it emailed. The link carries the
  email and a 12-character code in its fragment, works once, for 7 days. After that the friend
  signs in by email.

Either way the result is D19's long-lived `__Host-` session cookie, now pushed out to the
400-day maximum on every visit, so a player who keeps playing never signs in again. Nick is
`ADMIN_EMAIL` in `wrangler.jsonc`: his player is made the first time he asks for a code (taking
over a D19 player of the same name, with its saves), he sees the friends list, and his session
opens `/api/dev-rom`, so any link works on a browser where he's signed in. `ADMIN_TOKEN` and
`DEV_ROM_TOKEN` stay for scripts, tests and the cloud sandbox. D19 players keep their sessions;
Nick gives them an email from the friends list. Codes and tokens are still stored only as
SHA-256 hashes.

On an iPhone home-screen app, which keeps its own cookies, a friend signs in inside the app with
their email and the emailed code; the code is in the subject and body, so it can be typed
without leaving the app. A link opens in Safari and signs Safari in, not the app.

Why: Nick shouldn't have to keep a token, and friends shouldn't have to keep a code. Email is
the recovery path D19 lacked: a lost cookie no longer loses the player.

Alternative: **Cloudflare Access** (reconsidered). Its sign-in page can't be ours (only logo and
colours), sessions last at most a month, and sign-in leaves for `*.cloudflareaccess.com`, which
breaks out of an iPhone home-screen app.
