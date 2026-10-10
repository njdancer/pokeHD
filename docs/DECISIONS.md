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

## D24. Autosave with the game's own save, plus resume points that never beat the save file

Nick's call on 2026-10-08: quality-of-life features such as autosave are in scope; the "game
behaviour is the original" rule protects play (stats, RNG, AI, glitches), not every detail of
the software. Two layers:

- **Autosave** runs `SaveGameData` (what the start menu's SAVE calls) through D20's overworld
  idle point, so it writes a normal save file. It runs every 5 minutes of play, and after a
  battle ends, a map change or a gift landing, at most once a minute. Any save by hand restarts
  the clock. It never replaces another trainer's save: if the save file holds a valid save with
  a different trainer ID or name (NEW GAME over an old save), it waits until the player saves
  the new game once themselves, as the game's own "older file will be erased" prompt would
  have them do. Settings has a switch to turn it off.
- **Resume points** are emulator save states, taken every minute in the world and whenever the
  page is hidden, kept in IndexedDB next to the save with a SHA-1. On start-up the emulator
  uses one only if it loads and its battery RAM is byte-for-byte the stored save; otherwise it
  boots on the save as usual and the point is deleted. So a save made later, an imported .sav
  or a cloud restore all make a point stale, and a damaged one can never win over the save
  file. None is taken during a link session, mid-way through a safe-point call, or while a gift
  sits in the game unsaved (the room would resend it). After resuming, "Load the save file
  instead" goes back to the title screen.

Why two: Nick doesn't want to rely on a memory dump alone, and the save file alone loses play
since the last save when a tab closes. Resume points stay on the device for now; a cloud copy
can follow.

## D25. Kid-proofing: nothing a child taps loses a save

Nick, 2026-10-08: the game is mostly for his young son, on an iPhone 13 Pro as a home-screen
app, and never losing progress comes first. Made while Nick was away; flagged for his review.

- **Resume points in the cloud too.** For signed-in players each resume point (D24) also goes
  to R2 (`saves/<player>/<rom>.resume`, gzipped, a few KB), with the SHA-1 of the save it holds.
  At start-up the page picks the newest point, local or cloud, that holds the save it has; the
  emulator still checks it byte for byte. A device with no save at all (new phone, storage
  cleared) restores the cloud save automatically before the game starts, instead of offering
  it in Settings, since there's nothing local to lose.
- **Earlier saves.** The page keeps a copy of the battery save at most every 30 minutes of
  play (the newest 20), and always before anything replaces it: a different trainer's save
  (NEW GAME), an import, a cloud restore or going back (the newest 10 of those). Each is copied
  to R2 (`…/history/`), where the server keeps the newest 30. Settings, under Grown-ups, lists
  both with trainer, badges, Pokémon caught and play time, and "Go back" restores one (keeping
  the current save in the list first). Periodic rather than every save, so a long session's
  autosaves don't push the interesting copies out.
- **The erase question.** When the game is about to ask "The older file will be erased to
  save. Okay?", the page shows its own: one big "Keep my old adventure" button, and a smaller
  one that has to be held for 2 seconds to erase. The player's buttons don't reach the game
  until it's answered, then the page presses A (YES) or B (NO) for them the game's own way, so
  the game's logic is untouched. The old save is copied to Earlier saves before the question
  even shows.
- **"Saved" toast** when an autosave lands (a manual save already says so in the game).
- **Home-screen app.** A web manifest (`display: standalone`) and an icon of our own; no pinch
  or double-tap zoom, no pull-to-refresh or rubber-banding, and touches starting on the screen's
  side edges are cancelled so a swipe can't go back a page. Touch targets are at least 44 px
  (Select and Start were 26).
- **Grown-ups check.** Import save, Export, cloud restore, Earlier saves, the autosave switch,
  Forget ROM (now also confirmed) and Nick's friends list sit behind a multiplication question
  (6–9 × 3–8). Not security, just enough that a curious child doesn't wander in.
- **Sign-in stays put.** Checked, no change needed: the session cookie lasts 400 days (the most
  browsers allow) and every start-up pushes it out again; server sessions don't expire. On
  iPhone a home-screen app has its own cookies, separate from Safari, so sign in from inside
  the app by typing the emailed code (the login page says so there); the email's link would
  sign in Safari instead. Home-screen apps are exempt from Safari's 7-day storage clearing.

## D26. Friends Nick invites play on his cartridge

Nick's call on 2026-10-08, after inviting Charlie, who could sign in but then had to find a ROM
of his own before they could play together. Nick's ROM was already in the private R2 bucket for
his own testing (D23); now every player Nick adds may load it too.

- `GET /api/rom` (`/api/dev-rom` stays as an alias for tools) serves it to a signed-in player
  who is Nick or has `romAccess`. Everyone else, signed out included, gets the same 404.
- `romAccess` is a per-player flag in the Directory, on by default: every friend Nick adds, and
  every player already there when this shipped, gets it. Nick turns it off or back on per
  friend in Friends ("Stop sharing" / "Share cartridge"); players can't change their own.
- The browser keeps the shared ROM in IndexedDB like one the player loaded, marked as shared,
  so the game starts offline and quickly. On each start, if the server says the player is
  signed out or no longer allowed it, the shared copy is deleted and they're asked for their
  own. A device that never comes back online keeps its copy; that's the limit of revoking.
- The ROM screen knows who's signed in: signed out, it offers sign-in ("you won't need a ROM of
  your own"); signed in with access, a Play button loads the cartridge; signed in without it,
  it says to load their own. A ROM a player loads themselves still never leaves their browser.

Why: asking friends to find a ROM of their own is the step that stops them playing together. Sharing stays limited to people Nick added
by email, and he can take it back.

Alternative: friends always bring their own ROM (the original rule). Kept as an option on the
same screen, and the default for anyone Nick stops sharing with.

## D27. Phones get a mobile quality tier, and everyone gets dynamic resolution

Touch-only devices (coarse pointer, no hover) render with a patch over every look: ambient
occlusion at quarter resolution and FXAA instead of SMAA (`?quality=full|mobile` overrides).
On every device, dynamic resolution lowers the render scale in steps down to 50% while frames
miss 60 fps, then drops depth of field as the last step, and climbs back when there's headroom
(`?dynres=0` turns it off). Details in `docs/PERF.md`.

Why: the iPhone 13 Pro ran under 60 fps. Nick (2026-10-08) prefers a slight blur to a low frame
rate, but not blur where it isn't needed, so resolution drops only on a device and in a scene
that need it, and a fast machine stays sharp.

Alternative: a fixed 1.5 pixel-ratio cap on phones (the first version of this tier). Simpler,
but blurs every phone all the time, including ones with headroom.

## D28. Battles are read off the screen and staged in the overworld

The battle scene is rebuilt each frame from what the Game Boy draws: both Pokémon pictures from
the tile map and VRAM (so slides, faints, substitutes, transforms and the trainer's return all
follow the game), move effects from OAM, flashes from the palette registers and shakes from the
scroll/window registers (`BattleScreenReader` in `packages/emu`). Pictures stand as lit
billboards in the 3D world where the player is, coloured with the SGB palette the game would use
(`battlePalette`); the camera swings from the overworld to a side-on battle view. Names, levels
and HP come from `BattleState` as HD cards. The Game Boy screen stays on top, masked down to the
menus and text, which the HD text layer (p2-text) can take over cell by cell.

Why: reading the screen keeps every animation and edge case the original's, with no battle logic
of our own, and needs no list of move animations. Staging the battle where it happens keeps the
place's own lighting and time of day.

Arena look: three styles (`field`, on the spot; `bases`, on the spot with stone bases; `stage`,
a separate round stage). Nick picked `field` (2026-10-08): the battle plays out where the player
stands, on the overworld's own ground. The other styles stay behind the `arena` option.

Alternative: a separate arena scene per environment with its own move effects. More control of
the look, but every effect would be ours, not the game's.

## D29. The game lives at pokehd.dncr.me

Nick's pick on 2026-10-08. The Worker serves `pokehd.dncr.me` as a Cloudflare custom domain
(set in `wrangler.jsonc`), on his own `dncr.me` zone, the same one the sign-in emails come from.
`pokehd.nick-01a.workers.dev` keeps serving the same Worker, with no redirect, so a home-screen
app already installed from it keeps working until it's reinstalled from the new address.

Moving is a one-off per device: the home-screen app, the saves kept in the browser and the
sign-in cookie all belong to one address. On the new address a player signs in again, and the
game restores their cloud save (p1-saves-cloud) and resume points (D25). Sign-in links use the
address the request came in on, so both addresses work.

Why: settle it now, while only a few devices have the app installed, so saves and sign-ins
move once. Nick chose to keep the project name in the address.

Alternatives: `play.dncr.me` (recommended for a neutral name), or staying on workers.dev.

## D30. Interiors are dollhouses

Indoors, the Hybrid style builds the room rather than laying it flat. The back wall, shelves and
machines stand up at their front edge with their drawing on the front face (the Game Boy draws
them as elevations). Tables, counters and chairs become raised slabs, and plants and statues
become voxel volumes. The filler blocks around a room are left out. Of three enclosures (open
room, dollhouse, walls down; `/dev/styles?map=OAKS_LAB&interiors=all`), Nick picked
**dollhouse** on 2026-10-08: a tall back wall, and side walls that step down toward the camera,
so the room reads as a room without hiding the floor or the exit. He found the differences
small, so this is easy to revisit.

## D31. Words and menus use the Storybook look

The HD text layer (p2-text) draws the game's text boxes and menus as warm cream panels with a
soft gold edge and rounded bold letters (Nunito 800), at the places the game puts them on its
20×18 tile grid. The cursor is an orange triangle with a soft highlight on the chosen row, and
an item's quantity sits at the end of its own row. Settings can turn the layer off, which brings
back the Game Boy screen for text.

Why: Nick chose it (thread "HD text and menus", 2026-10-08) from three options side by side
(`/mnt/project-files/text/text-looks.png`). It's the easiest to read for a young child on a
phone and fits the warm Diorama/golden-hour tones.

Alternatives: Lantern (serif on dark navy glass with gold lines, the classic HD-2D panel; harder
for a beginner to read) and Game Boy letters (the ROM's own pixel font on a light panel).

## D32. Tap-first UI: the page's own start, names and buttons; the game still runs every screen

Nick asked on 2026-10-09 for the start of the game not to feel like an emulator, for real
keyboards and real buttons, and for Oak to check the name Nick already invited the player with.
Everything works by pressing the game's own buttons for the player, the way D25's erase question
does, so the game's code still runs every screen (`Controls` in `packages/emu`):

- **Start screen.** Instead of the title screen and CONTINUE / NEW GAME, the page shows its own
  panel over Pallet Town in HD: Continue (with the save's badges, catches and play time), or
  start a new adventure. The page then presses START and picks the choice in the game's menu,
  unseen (`Starter`, `onboarding.ts`). A resume point still skips all of it.
- **Oak in HD.** Until the world loads, the HD text layer draws the introduction's words, and
  the pictures (Oak, the Nidorino, the player, the rival) are lifted off the Game Boy screen,
  background cleared, and stood crisp over the HD world.
- **Names on the device's keyboard.** When the intro asks a name, or the naming screen opens for
  a nickname, the page asks instead with a text field (the game's suggestions as chips). The
  answer goes in through the naming screen: the letters are written into its buffer, what typing
  them would leave there, and START submits them, so only names the Game Boy keyboard could type
  are allowed (its letters and symbols, 7 for people, 10 for Pokémon).
- **Oak checks the invited name.** A signed-in player hears "It says here your name is NICK. Is
  that right?" and can keep it or change it. A change also renames their player (`PATCH
  /api/me`), so friends see the same name; names stay unique, and a taken one is said so.
- **Real buttons.** Every HD menu choice is a button: a tap moves the game's cursor there (one
  Up or Down at a time, watching wCurrentMenuItem) and presses A. A tapped message presses A, ×
  presses B, and lists and quantities get arrow and −/+ buttons. On touch devices the D-pad is
  for the world only: it hides while anything with its own buttons is open. Keys and gamepads
  still move the cursor as before.
- **Classic.** Turning "HD words and menus" off in Settings, or `?classic`, brings back the
  game's own title and naming screens.

Phone polish (Nick, 2026-10-09): Oak skips "First, what is your name?" and goes straight to
"It says here your name is …" in his own message box; a message that stops mid-sentence is read
on for the player, so up to four lines of a sentence show at once (the game still prints every
page); and everything that isn't the game sits behind one ball button in the corner.

The panels' look is Storybook with corner pokéballs (Nick's pick, 2026-10-09, over the Game Boy
frame in HD and chunky candy buttons; all three stay on `/dev/ui` and `?look=`).
Made while Nick was away; flagged for his review.

Why: a child on a phone shouldn't meet a Game Boy menu driven by a D-pad before anything else,
and pressing the game's buttons for them keeps every rule of the original game in place.

Alternative: patching the ROM's intro text and menus (level 3 state injection). More control,
but every screen would be ours to keep right.

## D33. Render at a whole fraction of the screen's pixel ratio

Nick, 2026-10-09: a 3× screen shouldn't get a 2× render, but a 1.5× one, so rendered pixels line
up with screen pixels. The engine now takes the largest whole fraction of `devicePixelRatio`
within `render.maxPixelRatio` (3 → 1.5, 2 → 2, 2.625 → 1.3125) and scales the canvas up with
`image-rendering: pixelated` when each rendered pixel is a whole block of screen pixels. On an
iPhone that's 2×2 blocks, no resampling blur, and 44% fewer pixels to shade. Dynamic
resolution's finer rungs stay fractional (whole-fraction steps would be 1.5 → 1 → 0.75, cuts of
over 40% each) and keep smooth scaling. See docs/PERF.md, "Pixel ratio".

## D34. Draw only frames that change; ambient motion steps 3 times a second

Nick, 2026-10-09 (thread "Phone performance"): only draw a frame when its contents changed, with
grass and other ambient motion on a few fixed steps a second like the original game; he picked
3 a second over 10, 30 or smooth. Grass sway, water ripples and the time of day (sun, shadows,
sky, colour grade) now advance on that tick, and the engine skips any frame whose scene graph,
camera and clocks match the last one drawn. A still view draws about 3 frames a second instead
of 60; walking still draws every frame. Why: idle time (text, menus, standing about) is a large
share of play on a phone, and a phone that idles cheaply runs cooler and throttles less when the
player walks. `?ambient=N` overrides the rate. See docs/PERF.md, "Drawing only frames that change".

## D35. The town's shadows are cached; only sprites' shadows are drawn every frame

Nick asked (2026-10-09) whether render passes can run on their own schedules. The screen-space
passes (AO, bloom, depth of field) change whenever the camera does, but the sun's shadow map
doesn't: it's the same until the sun steps, the shadow frustum moves or the scene changes. Its
static casters are now drawn into a cached depth map only then, and each frame its depths are
written into the live map by one full-screen triangle and the moving casters (sprites, marked
`markMovingShadow`) drawn on top. The frustum is re-centred on the player only after they move 6
units. The first versions copied the depth texture and made the maps 32-bit float depth; that
blanked the world on iPhone's WebGPU, so it now draws the depths into three.js's own depth format (Nick, 2026-10-09: there's no reason not to cache, so make it work there). Alternative: re-render everything every frame (as before, `?shadowcache=0`), or temporal
reuse of screen-space passes, which needs motion vectors and risks ghosting.

## D36. Whole messages from the script

**Status:** always on since 2026-10-09 15:00Z (Nick: "enable it permanently. Same with hd ui. Remove the
checkboxes"). It began as an off-by-default trial setting. The "HD words and menus" setting is gone
too: the HD text layer always shows when it fits, and `?classic` still gives the game's own title and
naming screens.

Joining the game's pages from the screen (D32) can't tell what follows a ▼, so it stops early or
presses past the end of a message (see /dev/dialog). Instead, when the game starts printing a
message (`PrintText_NoCreatingTextBox`), we read the whole message from the ROM's text script, with
the names and numbers it is about to fill in from RAM, and show it in the HD box in sentence-sized
boxes. The game prints its first page and waits as usual while the player's A and B go to the page.
When the player reaches the last box, the game runs through the waits inside the message; when
they tap past it, it runs through the last one. It does this with its own "no text delay" flag set
and A pressed at each `WaitForTextScrollButtonPress`, so every step (and any code) runs the game's
own way (but see below: no presses any more). A menu taking input, the box closing or the next message ends it. If the HD text can't
show a message, it goes back to the game untouched.

**Why not static analysis of the scripts:** the branches depend on live state (flags, the bag,
answers) and their effects must happen the game's way, so the game has to decide anyway. The
moment it calls PrintText it has decided, and that is when we read the message.

**Our code takes the place of the button waits only (2026-10-09, Nick: "replace it like an FFI",
"as thin a wrapper as possible, call back into the game's own code"):** the game's text engine
prints every message itself, with its sounds, boxes and code. Only the waits for A or B
(`ManualTextScroll`, and `WaitForTextScrollButtonPress` when called directly) are ours while a
message is on the page. Until the page has read that far, the CPU waits a frame at a time in
`DelayFrame`, which returns to the wait. After that, the wait returns at once, with no button
press and no click. A first try that replaced the whole printing routine for plain messages
worked, but it left out 46 messages (sounds inside the text) and duplicated the printer's job, so
we didn't keep it.

## D37. Colour and relief come from a process run on the player's ROM; nothing baked ships

**Status:** decided by Nick on 2026-10-08. Supersedes D11's "reviewed palette file".

Big image models (Qwen-Image-Edit, depth and normal models) run offline on Nick's Mac as teachers
only. Their outputs train a small model that ships and runs at runtime on the player's own ROM
(WebGPU, phones included). No colourised sprites, height maps or palette tables are committed or
served, ours included. Personal use, so weights trained on the game's art are fine.

## D38. The relief editor's edits are training data only

**Status:** decided by Nick on 2026-10-09.

`/tools/relief` lets Nick paint which way each pixel faces (a normal per tile pixel, or per Pokémon
picture pixel) and see the 3D shape it makes. The edits are saved to his browser and to his account
(`/api/admin/relief`, in the private bucket), and can be exported for local processing. The game
never reads them, and they aren't committed as game data: they're teaching material for the small
runtime model (D37).

## D39. Save slots: any number of saves per ROM; the save everyone had becomes the main slot in place

**Status:** asked for by Nick on 2026-10-10 (multiple saves with duplicate, delete and new; checkpoints
belong to a save; an intro with Resume). The storage choices below were made while he was away.

- **Keys, not moves.** Every slot's data sits under its own key, the way the one save did: battery
  save, resume point, earlier saves, Pokédex journal and gift ledger, on the device and in R2. The
  main slot's key is the ROM's SHA-1, so the save players already had is the main slot without a
  byte moving; other slots are `<sha1>-<8 letters/digits>`. Nothing in the game had to learn about
  slots: it's handed a slot's key.
- **The list merges, never replaces.** The slot list is kept in IndexedDB and, signed in, in R2
  (`saves/<player>/<rom>.slots.json`). A PUT merges into the stored list (per slot, the newer
  rename or bin change wins and the latest play wins), so two devices that each changed it never
  drop a slot. Resume plays the slot played last.
- **Delete is a bin.** Deleting only marks a slot; its data stays, and it can be brought back
  (D25: nothing a child taps loses a save). Emptying the bin for good is left for later, behind
  the grown-ups check.
- **Duplicate** copies the battery save, resume point, journal and gift ledger, but not gifts still
  on their way out (they'd be sent twice) or earlier saves (they stay with the original).

Until Nick picks the intro, the live game plays the main slot as before.

## D40. The Pokédex menu works the game through its routines, never its menus

**Status:** Nick's rule, 2026-10-10 ("inject code to interact with the fundamental routines of
the mechanism", not orchestrate the existing UI). Mechanism chosen by Claude.

- **Actions** (`GameActions`) run at the overworld idle point (SafePoint, D20) as calls of the
  game's own routine for the job: `UseItem` with wCurItem and the item's place in the bag, inside
  the frame any person's message gets (`DisplayTextIDInit` … `CloseTextDisplay`); toss is
  `RemoveItemFromInventory`; team order is the party menu's data swap
  (`SwitchPartyMon_InitVarOrSwapData`) without its drawing. With no routine of the game's own
  (moves and bag order outside battle, options), the data is changed directly, the same change the
  game's in-battle or menu code makes.
- **Stand-ins** (`ffi.ts`): where a routine would draw a menu and wait for buttons
  (`DisplayPartyMenu`, `DisplayListMenuID`, `DisplayChooseQuantityMenu`, a yes/no), a hook at its
  first instruction writes the outputs its callers read and returns, or idles the CPU through
  `DelayFrame` until the page answers. During our own actions the answers come from the action;
  otherwise (`GameAsks`) the page is asked, so the battle bag, the Poké Mart and Bill's PC become
  sheets while the game's rules decide what happens. Lists the page doesn't ask are left to the game.
- **Opt-in.** Only a page that passes `onAsk` to `EmulatorHost` turns them on; the live game is
  unchanged until Nick picks the menu.
