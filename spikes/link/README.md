# p3-link-spike: can the link cable survive the network?

Throwaway. Two SameBoy cores (D14) in one process, joined by a simulated cable whose latency and
synchronisation strategy are parameters. Both games run the real Cable Club code end to end: the
receptionist, saving, the room menu, the Trade Center and the Colosseum. Nothing here is imported
by the app. No ROM, boot ROM, save or screenshot is committed.

**Answer: don't put the serial port on the network. Put the joypads on it.** Each client runs
*both* Game Boys (its own and a replica of the friend's) on a perfect local cable, and the room
only relays button presses in lockstep with a few frames of input delay. That completed every
trade and battle at 0–200 ms with both clients' replicas identical byte for byte, and the game's
link timing never sees the network. Forwarding serial bytes, the obvious design, is either slow
and fragile (stall the master per byte) or silently corrupts trades (don't stall).

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

Times include the scripted walking and text (about 72 s at 0 ms), so the cost of latency is the
difference from the 0 ms row. "One-way" latency; round trip is double.

### stall: forward each byte, pause the master until the reply arrives

| one-way | trade | battle |
|---|---|---|
| 0 ms | ✅ 72 s | ✅ 70 s |
| 25 ms | ✅ 144 s | ✅ 108 s |
| 50 ms | ✅ 217 s | ✅ 150 s |
| 100 ms | ❌ hangs after "Trade completed!" | ✅ 225 s |
| 200 ms | ❌ hangs after "Trade completed!" | ✅ 379 s |

Every byte costs one round trip of frozen game on the master's screen (≈1,460 × 100 ms = 146 s
at 50 ms). From 100 ms the trade itself lands (both parties swap) but the closing handshake
deadlocks: the master is still in `Serial_SyncAndExchangeNybble` while the slave, running at
full speed, has finished its fixed frame counts and moved on to `Serial_ExchangeByte` waiting
for a block. Inferred from where both CPUs sat for the last 100 s; the fixed-frame loops assume
an exchange takes ~1 ms, and with a 200 ms round trip the two sides' loops no longer overlap.

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
accepts it: a silently broken trade is the worst failure a player could get. Battles reach the
first turn and then both sides wait forever on each other.

### dual: each client runs both Game Boys; only joypad input crosses the network

Input delay D frames: a press is applied D frames after it's made, on both clients.

| one-way | D | trade | battle | waiting on the network | replicas |
|---|---|---|---|---|---|
| 0 ms | 6 | ✅ 74 s | ✅ 80 s | 0 s | identical (15/16 checks) |
| 50 ms | 6 | ✅ 74 s | ✅ 80 s | 0 s | identical |
| 100 ms | 6 | ✅ 74 s | ✅ 80 s | 0 s | identical |
| 200 ms | 6 | ✅ 146 s | ✅ 159 s | 73 s / 79 s | identical |
| 200 ms | 14 | ✅ 75 s | ✅ 79 s | 0 s | identical |

No breakage at any latency, because the cable is local and perfect; latency only shows up as
input lag (D frames, 100 ms at D = 6) and, if latency exceeds D, as both games slowing together
(the 200 ms / D = 6 row). Turn-based menus hide 100–250 ms of input lag well.

## Recommendation for p3-link (networked link)

1. **Linking = start a dual session.** When both players are at the receptionist, each client
   snapshots its own Game Boy (SameBoy save state, ~82 KB) and sends it to the other through the
   room. Both clients then run the pair from the identical (A, B) snapshots, stepped in a fixed
   order on fixed tick slices (`Pair` in `lib.mjs`) so the result is deterministic. The client
   pauses its own game for the one round trip this takes, in the Pokémon Center.
2. **Lockstep input with adaptive delay.** The room relays one byte of joypad per player per
   frame (~60 B/s each way). Pick D from measured RTT (e.g. one-way ÷ 16.7 ms + 2, clamped
   4–15); stall rather than roll back when input is late. No rollback needed for turn-based play.
3. **Leaving the club = drop the replica.** Each player keeps their own core, which ran the exact
   same frames as the friend's replica of it. Before resuming, compare a WRAM hash once (the room
   can relay it) and refuse to save on mismatch. A desync would mean nondeterminism we introduced,
   e.g. reading wall-clock time, the RTC (Blue has none) or unequal wasm builds; pin the build.
4. **Costs.** Two cores per client while linked: ~32 s CPU for a ~73 s trade here, about 2× a
   single game, which is still several times real time on a desktop Xeon. Worth a phone check in
   B2; binjgb (D14's fallback) has no serial port, but in this design serial is local, so adding
   one there would be simple. The friend's save travels to me inside the snapshot; it's their own
   game data, never stored server-side beyond relaying.
5. **Fairness/cheating** isn't addressed by either design (a modified client can always send a
   modified snapshot), which is acceptable for friends-only.

Not tried: bit-level forwarding (strictly worse than byte stall: 8 round trips per byte), and
patching the game's serial routines to batch blocks (would change game code, against the
non-negotiables, and the dual design makes it unnecessary).

## Reproduce

```sh
# emcc on PATH (emsdk 6.0.11), mise toolchain, ROM at rom/pokeblue.gb, disassembly built
spikes/link/build.sh /tmp/link-spike
cd spikes/link
node run.mjs /tmp/link-spike/out ../../rom/pokeblue.gb ../../vendor/pokered/pokeblue.sym \
  /tmp/link-spike/out/dmg_boot.bin stall:0:trade stall:50:battle async:16:trade dual:200:trade:14
```
Each spec is `strategy:one-way-ms:trade|battle[:delay-frames]`; one JSON line per run.
