# @pokehd/emu

The Game Boy, emulated by SameBoy's core compiled to wasm (D14). One `GameBoy` per instance,
synchronous, framework-free: it runs in a Web Worker in the app and in plain Node in tests.

```ts
const gb = await GameBoy.create({ rom, sram, sampleRate: audioContext.sampleRate });
gb.addHook("OverworldLoop", (gb) => {/* paused before that instruction; read/write safely */});
gb.setButtons(Button.A | Button.Right);
gb.runFrame();                  // ~59.73 times a second; the caller owns pacing
gb.readSymbol("wCurMap");       // WRAM by pokeblue.sym name (@pokehd/rom)
gb.frame;                       // 160×144 RGBA
gb.drainAudio();                // interleaved stereo int16 since the last call
gb.saveState(); gb.saveSram(); gb.sramDirty;
```

`runCycles(n)` steps by master-clock cycles instead of frames, for lockstep work such as the
link cable.

## The wasm build

`src/generated/sameboy.{mjs,wasm}` are committed build outputs, so nothing else needs
Emscripten. `pnpm --filter @pokehd/emu build:wasm` (`native/build.sh`) rebuilds them from the
pinned `vendor/SameBoy` submodule and `native/wrapper.c`, fetching Emscripten into
`~/.cache/pokehd/emsdk` on first run. The same inputs give byte-identical outputs; commit them
together with any wrapper or pin change. The boot ROM baked in is SameBoy's own (MIT), built
from source with the pinned rgbds.

## The link cable (D17)

`LinkPort` plugs a `GameBoy` into a friend's: the game's link routines are hooked by symbol and
each exchange becomes one `LinkMessage` (`@pokehd/protocol`), about 20 each way for a trade.
The transport stays outside: an in-memory pair in `link.test.ts`, the room later.

```ts
const port = new LinkPort(gb, { role: "leader", send: (m) => room.send(m) });
room.onMessage((m) => port.receive(parseLinkMessage(m)));   // in order
// In the app the worker owns it: host.openLink({ role, send }).receive(message)
```

- **Waiting keeps the game live.** A routine whose reply hasn't arrived sends the core through
  `DelayFrame` (or the game's own busy-wait when only the serial interrupt is on) and back to
  the routine, so the screen and music keep running and the game's timeouts still apply.
- **Roles.** Both players talk to their receptionist; each sends `connect` and waits for the
  friend's (768 frames by default, then the game's "reserved for 2 friends" message). The
  transport decides who is the `leader` (the game's clock master: its random numbers drive a
  battle, it sits on the left, it wins menu ties). On a real cable that's whoever talks first.
- **Sessions.** A `connect` clears whatever the friend sent before it, so a timed-out exchange
  can't pair with the next session's messages.
- Not done yet: the room menu still exchanges once per poll, so at 200 ms one way the cursor
  answers ~2.5 times a second; "send on change" would fix that. A dropped friend leaves the game
  waiting where the original would (block exchanges, battle turns); the transport should close
  the link.

## Extending the native API

New capabilities go in `native/wrapper.c` as `emu_*` exports, typed in
`src/generated/sameboy.d.mts` and wrapped on `GameBoy`. The link needed none: it is built on
PC hooks and register writes.

## Overworld state

`src/state/` turns watched WRAM into an `OverworldState` (map, player, NPCs, mode, fade) for the
live world renderer. Pass `OVERWORLD_WATCHES` to `EmulatorHost.watch`, then decode each
`FrameMessage.watched` with `decodeOverworldState`. Positions are in step cells (16 px) with
the step in progress alongside, so the renderer interpolates between frames.
