# p3-link-spike: can the link cable survive the network?

Throwaway. Two SameBoy cores (D14) in one process, joined by a simulated cable whose latency and
synchronisation strategy are parameters. Both games run the real Cable Club code end to end: the
receptionist, saving, the room menu, the Trade Center and the Colosseum. Nothing here is imported
by the app. No ROM, boot ROM, save or screenshot is committed.

**Answer: hook the game's four link routines in the emulator and send each one's exchange as a
single message.** One emulator per player, no ROM change. A trade becomes about 20 messages each
way plus 8 raw bytes at the receptionist, instead of ~1,500 byte round trips, and the game's
frame-counted handshakes become "wait for the friend's message". Trades and battles completed
and verified at 0, 50, 100, 200 and 500 ms one-way; at 200 ms a trade took 5.5 s longer than at
0 ms. Forwarding serial bytes as-is is slow and deadlocks trades from 100 ms (pausing the master
per byte) or silently corrupts trades from 16 ms (not pausing). Running both Game Boys on each
client with input lockstep also works (kept below for comparison), but Nick prefers one emulator.

## What was run

- `build.sh` builds SameBoy at the commit pinned in `spikes/emu` (D14) with `wrap/link.c`, a
  wrapper for four cores whose serial callbacks hand each byte to JavaScript: when a core starts
  an internally clocked transfer (it's the master for that byte) it stops, and the harness
  decides when the partner shifts it in and when the reply comes back.
- `scenario.mjs` boots a new game, then for each player writes a two-mon party (built from the
  ROM's own base stats), the got-Pokédex flag the receptionist checks, a name and trainer ID,
  repoints Red's-room stairs at Viridian's Pokémon Center and walks to the link receptionist.
  That's test setup through WRAM; from the first A press on it's the game's own code. Input
  scripts then do what players do: talk, save, choose the room, sit, press A on the Game Boy on
  the table, and either trade first mons or mash FIGHT/first move until one side faints (battles
  use one mon each so no switch menu is needed). Menus are detected by reading the tilemap.
- `HookedLink` in `lib.mjs` is the chosen design: PC hooks (by `pokeblue.sym`, bank-checked)
  on the link routines, which pause that core, send one message and resume it with the friend's
  data written where the routine would have put it (see "Hooks" below).
- `run.mjs` runs each strategy × latency on a simulated wall clock (both Game Boys at real
  speed), so the times below are what players would wait, not CPU time.

**Checks.** Trade: each side's new mon is byte-identical (all 44 bytes) to the one the other side
sent. Battle: each side's last view of [own HP, enemy HP] mirrors the other's and exactly one mon
fainted. Dual: every 300 frames, and at the end, each client hashes WRAM and HRAM of both of its
Game Boys; the two clients' hashes must match.

## How the game uses the cable

Read from `home/serial.asm`, `engine/link/cable_club*.asm`, `engine/menus/main_menu.asm`.

- Whoever talks to the receptionist first becomes the master (internal clock); the other side
  is armed as slave each frame by the Pokémon Center's map script. The master's `wLinkTimeoutCounter`
  gives up after 90 frames.
- One byte per transfer, 8 bits at 8192 Hz (~1 ms). The slave's reply is whatever its interrupt
  handler preloaded into `rSB` at the *previous* transfer, so data is pipelined one byte behind and
  `$FE` means "nothing yet". Blocks (`Serial_ExchangeBytes`) are framed by `$FD` preambles.
- Handshakes (`Serial_SyncAndExchangeNybble`) exchange a nybble once per frame until both agree,
  then run **fixed frame counts** of exchanges (10 + 10 frames) on each side independently,
  assuming each exchange is instant. Some waits time out via `wUnknownSerialCounter` (e.g. 768
  frames at the receptionist).
- The room menu exchanges the cursor every frame and reads the joypad only between exchanges.
  Whoever presses A first decides for both.
- Traffic is small: about 1,500 master transfers for a whole trade session and 800–1,000 for a
  short battle, counting every handshake and retry.

## Results

Times include the scripted walking and text (about 66–71 s at 0 ms), so the cost of latency is
the difference from the 0 ms row. Latency is one-way; a round trip is double.

### hooks: one emulator each, link routines exchanged as messages (chosen)

| one-way | trade | battle | messages each way | raw bytes | time paused waiting |
|---|---|---|---|---|---|
| 0 ms | ✅ 67 s | ✅ 66 s | 20 / 19 | 8 / 6 | 1 s |
| 50 ms | ✅ 68 s | ✅ 67 s | 20 / 19 | 8 / 6 | 2–4 s |
| 100 ms | ✅ 69 s | ✅ 68 s | 20 / 19 | 8 / 6 | 4–5 s |
| 200 ms | ✅ 72 s | ✅ 71 s | 20 / 19 | 8 / 6 | 7–8 s |
| 500 ms | ✅ 176 s | ✅ 173 s | 20 / 19 | 186 / 184 | 105 s |

Up to 200 ms the only cost is one round trip per message, at "Please wait" and "Waiting..."
moments. At 500 ms the receptionist's raw connection handshake (90-frame timeout, both sides
trying to clock at once) needed many retries before it caught; it still connected and the trade
and battle were correct. Hooking that handshake too would remove the last raw bytes.

### stall: forward each byte, pause the master until the reply arrives

| one-way | trade | battle |
|---|---|---|
| 0 ms | ✅ 71 s | ✅ 69 s |
| 25 ms | ✅ 142 s | ✅ 116 s |
| 50 ms | ✅ 213 s | ✅ 156 s |
| 100 ms | ❌ hangs after "Trade completed!" | ✅ 211 s |
| 200 ms | ❌ hangs after "Trade completed!" | ✅ 380 s |

Every byte costs one round trip of frozen game on the master's screen (≈1,450 × 100 ms = 145 s
at 50 ms). From 100 ms the trade itself lands (both parties swap) but the closing handshake
deadlocks: the master is still in `Serial_SyncAndExchangeNybble` while the slave, running at
full speed, has finished its fixed frame counts and is waiting in `Serial_ExchangeByte` for a
block. Inferred from where both CPUs sat for the last 100 s of the run; the fixed-frame loops
assume an exchange takes ~1 ms.

### async: forward each byte, never pause (master gets the partner's port as last seen)

| one-way | trade | battle |
|---|---|---|
| 1 ms | ✅ | ✅ |
| 4 ms | ✅ | ✅ |
| 16 ms | ❌ **corrupt**: completes, but Alice receives species 253 (glitch mon) | ❌ freezes mid-battle |
| 50 ms | ❌ hangs during the trade | ❌ freezes mid-battle |
| 100 ms | ❌ **corrupt**: species 253 again | ❌ freezes mid-battle |
| 200 ms | ❌ never settles: one side drops back to the Pokémon Center (48k bytes of retries) | ❌ freezes mid-battle |

The pipelining tolerates a frame or so of staleness, then data shifts by a byte and the game
accepts it: a silently broken trade is the worst failure a player could get. (These rows are
from the first run, with 2-frame button taps; the 16 ms trade was re-run with the final script
and corrupted the same way.)

### dual: each client runs both Game Boys; only joypad input crosses the network

Input delay D frames: a press is applied D frames after it's made, on both clients.

| one-way | D | trade | battle | waiting on the network | replicas |
|---|---|---|---|---|---|
| 0 ms | 6 | ✅ 86 s | ✅ 71 s | 0 s | identical |
| 100 ms | 6 | ✅ 86 s | ✅ 71 s | 0 s | identical |
| 200 ms | 6 | ✅ 171 s | ✅ 141 s | 85 s / 70 s | identical |
| 200 ms | 14 | ✅ 72 s | ✅ 89 s | 0 s | identical |

Robust at any latency (the cable is local and perfect), at the cost of input lag and two cores
per client. Kept as the fallback if hooks hit a routine we can't express as a message.

## Hooks

Each hook fires when the CPU reaches the routine's first instruction (SameBoy's execution
callback, bank-checked); the core rewinds to the registers it had there and pauses. The harness
sends one message, and once the friend's arrives it writes the result and returns from the
routine (`pc = [sp]`, `sp += 2`), so the game continues exactly as if the routine had run.

| routine | used for | message | on the friend's reply |
|---|---|---|---|
| `Serial_ExchangeBytes` (hl → de, bc bytes) | random numbers, party data, patch lists | our `bc + 16` bytes | write theirs from byte 1 (the real loop stores after the first preamble `$FD`), `hl += bc`, `de += bc`, `bc = 0` |
| `Serial_SyncAndExchangeNybble` | receptionist, trade choice, cancel | `wSerialExchangeNybbleSendData` | write it to both nybble receive bytes |
| `LinkBattleExchangeData.syncLoop1` (bank $0F) | each battle turn's action | `wSerialExchangeNybbleSendData` | write `wSerialExchangeNybbleReceiveData` |
| `Serial_ExchangeLinkMenuSelection` | room menu, every poll | 2-byte selection buffer | write the receive buffer, then tail-call `DelayFrame` |

Messages pair up per routine in order (the n-th call on each side), which holds because both
games run the same link script. What these do not do yet, and p3-link must:

- **Pausing freezes the screen and music.** Fine for a round trip; not for the first player at
  the receptionist, who waits until the friend talks too. Wait in a `DelayFrame` loop instead
  (when `rIE` includes V-Blank; block exchanges run with serial-only interrupts and are short).
- **Timeouts.** The game's own "link closed because of inactivity" (`wUnknownSerialCounter`)
  no longer fires inside a hooked routine. Give up after the same number of frames.
- **The receptionist handshake** still uses raw bytes over the byte bridge. It's 8 bytes and
  works to 200 ms; at 500 ms it took a minute of retries. Hook it as a fifth message.
- **Room menu cursor** runs one round trip per poll, so at 200 ms the cursor answers about
  2.5 times a second. Turning it into "send on change" would remove that.
- Script note: menus poll the joypad every few frames, so input scripts hold buttons 6 frames,
  as a person does. With 2-frame taps the hooked menu could miss presses entirely.

## Recommendation for p3-link (networked link)

1. **`packages/emu` exposes link hooks.** The wrapper already needed for PC hooks (D14) gets the
   four (five, with the receptionist) routine hooks and a "pause here, resume with these
   registers" call. Symbols come from the generated table, so a disassembly change can't
   silently move a hook.
2. **The room relays link messages.** A Durable Object passes each message to the friend in
   order, tagged with the routine; ~40 messages per trade or short battle. No timing, no serial
   semantics on the server.
3. **The game's link code still decides everything.** Which mon is traded, every random number
   and every battle action are the game's own bytes; the hooks only replace how they travel.
   That keeps D1 and D12's intent. It does touch game timing (waits become message waits), which
   is why this is a decision rather than an implementation detail.
4. **Fallback:** if a routine turns up that can't be expressed as a message, the dual design
   above works without any hooks.

Not tried: bit-level forwarding (strictly worse than byte stall: 8 round trips per byte), and an
assembly patch to the ROM (the emulator-level hooks do the same job without changing a byte of
the game, which is CLAUDE.md's preferred injection level).

## Reproduce

```sh
# emcc on PATH (emsdk 6.0.11), mise toolchain, ROM at rom/pokeblue.gb, disassembly built
spikes/link/build.sh /tmp/link-spike
cd spikes/link
node run.mjs /tmp/link-spike/out ../../rom/pokeblue.gb ../../vendor/pokered/pokeblue.sym \
  /tmp/link-spike/out/dmg_boot.bin hooks:200:trade hooks:200:battle stall:50:trade async:16:trade dual:200:trade:14
```
Each spec is `strategy:one-way-ms:trade|battle[:delay-frames]`; one JSON line per run.
