# Claude QA's pokeHD

A Haiku player plays the real game from the title screen through the touch controls, hunting for
bugs, while an Opus developer session fixes them. The whole thing streams: OBS captures the
stream page (`/dev/stream`, 1920×1080), which shows the game, the player's thoughts and actions,
its party and badges, the bug tracker, and the chat with the developer when the player pauses to
talk.

## Running it (on the Mac)

1. `pnpm dev` (the app on :5173; it serves `rom/pokeblue.gb`).
2. `pnpm qa run`. It opens Chromium on the stream page, starts the bus on :4545 and the player.
   The player runs through Claude Code (the Agent SDK) signed in with the Mac's own Claude login,
   so it counts against that subscription; `--via api` uses `ANTHROPIC_API_KEY` instead.
   `--turns 20` for a trial, `--game` for the bare game page, `--model` to try another player.
3. In OBS, capture the Chromium window (or add a Browser source on the printed stream URL with the
   same `?bus=` and a separate game; the window capture is what the player actually drives).

Everything a run produces stays in `apps/qa/runs/` (gitignored: it holds screenshots of the game):
one folder per run with `events.jsonl` and `transcript.jsonl`, plus `bugs.json`, `bugs/<id>/`
(screenshot, contact sheet, save, page state, console), `chat.jsonl` and the player's
`notebook.md`, which carry over between runs.

## The developer's side

The developer is a Claude Code session on the same machine. Its loop:

- `pnpm qa inbox --wait` blocks until the player says something (a bug, a question, a harness
  request), then prints it.
- `pnpm qa bug 7` shows bug 7 and where its attachments are; `pnpm qa bug 7 fixing` marks it.
- Fix it on a branch, merge, and `pnpm qa say "Fixed: … restart_game to pick it up" --tag fixed --bug 7`.
  If the player is waiting for a reply, this unpauses it.
- `pnpm qa bugs`, `pnpm qa status` for the overview.

The player can `restart_game` to pick up fixes (the page reloads from the dev server and resumes
exactly where it was; `from: "save"` rolls back to the last in-game save).

## Rules the harness keeps

- The player only touches the screen, like a person. No keys, no calling game code.
- What it's told is what's on screen: text, choices and where they are, a small text map around
  it. No RAM, no hidden information. Screenshots and contact sheets on request.
- Glitch heuristics (a flip to the Game Boy screen, the scene reloading, a stalled emulator, long
  frames, page errors) arrive as harness notes; the player decides whether they're bugs.
