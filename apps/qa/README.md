# Claude QA's pokeHD

A Haiku player plays the real game from the title screen through the touch controls, hunting for
bugs, while an Opus developer session fixes them. The whole thing streams: OBS captures the
stream page (`/dev/stream`, 1920×1080), which shows the game, the player's thoughts and actions,
its party and badges, the bug tracker, and the chat with the developer when the player pauses to
talk.

## Running it (on the Mac)

1. `POKEHD_NO_HMR=1 pnpm dev` (the app on :5173; it serves `rom/pokeblue.gb`). No hot reload: with it,
   every code change reloads the game mid-play and drops it back to its last resume point. Fixes
   land when the player uses `restart_game`, which takes a fresh resume point first.
2. `pnpm qa run`. It opens Chromium on the stream page, starts the bus on :4545 and the player.
   The player runs through Claude Code (the Agent SDK) signed in with the Mac's own Claude login,
   so it counts against that subscription; `--via api` uses `ANTHROPIC_API_KEY` instead.
   Better: run `claude setup-token` once and save the token in `~/.config/pokehd/claude-oauth-token`
   (or export `CLAUDE_CODE_OAUTH_TOKEN`). Then the player gets
   an empty Claude config, so it never sees the account's email (Claude Code adds it otherwise).
   `--turns 20` for a trial, `--game` for the bare game page, `--model` to try another player.
   `--lan` also serves the live view to the network: it prints `http://<mac's address>:4545/watch`,
   video with sound in any browser (a phone included; tap for sound), and
   `http://<mac's address>:4545/context/view`: exactly what the player's model sees in the current
   chapter (system prompt, tools, every message, tool results with their text maps and images,
   tokens per reply against the chapter limit, earlier chapters' handoffs), live. Without `--lan`
   it's at `http://127.0.0.1:4545/context/view`. With Claude Code the messages are as Claude Code
   reports them; any wrapping it adds of its own isn't visible from here.
3. In OBS, add a Browser source (1920×1080, "Control audio via OBS") on
   `http://localhost:5173/dev/watch?bus=http://127.0.0.1:4545`. That page shows the stream page's
   live picture and sound (the stream page broadcasts itself over WebRTC) and a "be right back"
   screen whenever the harness, its browser or the player is restarting, then reconnects on its
   own, so the broadcast never drops. Don't point OBS at /dev/stream itself: that would be a
   second copy of the game.

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
- The player's instructions are `apps/qa/prompt.md`. To change what it's told, edit that file, then
  `pnpm qa say "…what changed…" --tag prompt`: the player rewrites its notebook as a handoff and a
  new conversation (a chapter) starts on the new prompt, with no restart. Chapters also start on
  their own when the player's context passes 150k tokens, before Claude Code's own compaction.
- Never help the player play. If it asks where to go or how to get past something, don't give
  directions or hints: check whether what it describes is a bug, say whether it is, and if it
  isn't, tell it to try something different.

The player can `restart_game` to pick up fixes (the page reloads from the dev server and resumes
exactly where it was; `from: "save"` rolls back to the last in-game save).

## Rules the harness keeps

- The player only touches the screen, like a person. No keys, no calling game code.
- What it's told is what's on screen: text, choices and where they are, a text map around
  it the size of the Game Boy's own screen (10×9 steps, columns and rows numbered), and after a joystick walk how many steps
  it took and, when short, why (a battle, text, a new map, what's in the way). No RAM, no hidden
  information. Screenshots and contact sheets on request.
- Glitch heuristics (a flip to the Game Boy screen, the scene reloading, a stalled emulator, long
  frames, page errors) arrive as harness notes; the player decides whether they're bugs.
