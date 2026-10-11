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
  **One deliberate exception: Nick's cartridge.** His ROM sits in the private R2 bucket
  `pokehd-private` and `GET /api/rom` (old name `/api/dev-rom`) returns it only to signed-in
  players allowed it: Nick (the admin email in `wrangler.jsonc`, D23) and the friends he invited,
  unless he turned it off for them in Friends (D26); or to tools with
  `Authorization: Bearer <DEV_ROM_TOKEN>` (Worker secret). A browser whose player is allowed it
  loads it when it has no ROM. Locally, the Vite dev server serves `rom/pokeblue.gb` at
  `/__dev/rom` and the app auto-loads it. Never expose the ROM any other way (no public assets,
  no public bucket, nobody who isn't signed in).
- **Keep it private.** The GitHub repo is private. Don't name public things "Pokémon".
- **Visuals are the point.** Pixel art stays crisp (no xBR/HQx smoothing on sprites); the
  HD treatment comes from 3D geometry, lighting, materials and post-processing. It's always
  daytime, but time of day runs forward from morning to a low evening and a shadowless dusk for
  atmosphere (D16, D42); indoors and caves have their own fixed light.

## Reference ROM

- `rom/pokeblue.gb` (gitignored). SHA-1 `d7037c83e1ae5b39bde3c30787637ba1d4c48ce2`.
- `vendor/pokered` is the pret disassembly (git submodule). It builds a byte-identical ROM and
  `pokeblue.sym`, our source of truth for every routine and RAM/ROM address.
  Init with `git submodule update --init vendor/pokered`; build with `pnpm rom:build-disasm`
  (rgbds comes from `mise.toml`).
- No ROM in your sandbox? `pnpm rom:fetch` downloads and verifies it using the
  `POKEHD_DEV_ROM_TOKEN` environment variable. Never print, log or commit that token.
  Use the disassembly's source as documentation for data formats, but **extract data from the
  ROM bytes at runtime**, never by bundling files from `vendor/`.

## Architecture (TypeScript end to end)

- `apps/web`: one Cloudflare Worker project, built by Vite + `@cloudflare/vite-plugin`.
  - `src/client`: React 19 SPA for UI chrome only (ROM loader, lobby, gift/trade pickers,
    settings, in-game overlays). Plain CSS with custom properties. `/explore` is a ROM explorer
    (disassembly, step debugger, asset viewers) over every pokeblue.sym label, generated into
    `packages/rom/src/generated/explorer-db.ts` by `tools/gen-explorer.ts` (`pnpm rom:symbols`).
    `/admin/lab` is the relief lab, Nick's console for the relief-model training on his Mac: it reads
    the run tree the trainer mirrors to the private bucket under `lab/` (docs/relief-ml/LAB-CONTRACT.md;
    `node tools/lab-seed.ts` makes demo data for it).
  - `src/worker`: Hono app under `/api/*` (`run_worker_first`); everything else is static
    assets with SPA fallback. Durable Objects (multiplayer rooms, hibernatable WebSockets)
    arrive in the multiplayer phase.
- `packages/engine`: plain Three.js (`three/webgpu` + TSL), framework-agnostic. Owns the canvas
  and frame loop; React mounts it once via `createEngine(canvas)` and never re-renders per
  frame. No react-three-fiber. Engine→UI state goes through a vanilla Zustand store (when needed).
- `packages/rom`: isomorphic ROM parsing (maps, tilesets, blocksets, sprites, palettes, text
  charmap) addressed via generated symbols. Runs in Node (tools/tests) and the browser.
- Later: `packages/emu` (WASM Game Boy core + hooks), `packages/protocol` (valibot-validated
  client↔room messages).

Rendering is **state-driven** for the overworld (read map ID and coordinates from WRAM, render
the whole map plus its connections from ROM data, not the 160×144 screen), and **screen-driven**
for text and menus (decode window tiles via the charmap and re-typeset them).

### State injection

Three levels, in order of preference: (1) read/write WRAM at emulator-level hook points named by
`pokeblue.sym`; (2) a small assembly patch adding a "mailbox" check in the overworld loop, so
gifts land only at safe moments; (3) bigger ROM patches, shipped as a patch applied in-browser.

## Working conventions

- Tool versions are pinned in `mise.toml` (node, pnpm, rgbds). Run commands through mise
  (`mise exec -- pnpm …`); don't rely on globally installed tools or change global config.
- pnpm workspaces. TypeScript 6 strict (`tsconfig.base.json`), oxlint, Vitest.
- Commands: `pnpm dev` (client + Worker on :5173), `pnpm typecheck`, `pnpm test`, `pnpm lint`,
  `pnpm build`, `pnpm run deploy` (bare `pnpm deploy` is a pnpm builtin).
- Pushes to `main` run CI (`.github/workflows/ci.yml`: lint, typecheck, test and build on the mise
  toolchain), then deploy to https://pokehd.dncr.me (D29; the old
  `pokehd.nick-01a.workers.dev` still serves the same Worker). Deploy needs the
  `CLOUDFLARE_API_TOKEN` repo secret.
- **Plan and decisions:** `docs/PLAN.md` (roadmap, task specs, tracks, coordination rules) and
  `docs/DECISIONS.md` (settled decisions with reasons). Read both before starting work.
- Commit small and often with descriptive messages. Work on a branch per task
  (`claude/<task-id>`) and open a PR; don't push to `main` directly.
- **Status dashboard**: https://claude.ai/artifact/UUefXDjuKGfRUNtF6SLNNQ (source in
  `dashboard/status.html`). Keep it current with the `ArtifactData` tool:
  `project/meta` (headline, phases, currentPhase, repo, updatedAt), `project/metrics`
  (`items: [{label, value, unit?, hint?}]`), `tasks/<id>` (`title, status: todo|doing|done|blocked,
  phase, order, note?`), `devlog/<id>` (`ts` ISO, `title`, `body` with paragraphs, `- ` bullets,
  `code`, **bold** and links, `tags[]`, optional `images: [{url, caption}]` with urls from
  uploading screenshots as artifact assets). Post a dev log entry at every meaningful milestone
  or decision, and update tasks as they change state. Task document IDs match `docs/PLAN.md`.
- The user is an experienced TS/3D developer acting as technical advisor: explain trade-offs,
  push back on bad ideas, show visual options side by side rather than picking silently.
