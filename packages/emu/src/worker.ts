// Emulator Web Worker: owns one GameBoy and paces it.
//
// With audio, the audio clock drives emulation: the worker keeps about AUDIO_LEAD frames of
// sound queued in the worklet and runs a frame whenever the queue drops below that, so sound
// never starves and video follows at the core's own ~59.73 Hz. Without audio (no user gesture
// yet, or muted), a wall-clock timer runs frames at FRAME_RATE instead.
import { AutoSave, loadResumePoint } from "./autosave.ts";
import { Controls } from "./controls.ts";
import { FRAME_RATE, GameBoy } from "./core.ts";
import { DexGuard } from "./dex-guard.ts";
import { EraseGuard } from "./erase-guard.ts";
import { GiftDesk } from "./gifts/desk.ts";
import { SafePoint } from "./gifts/safepoint.ts";
import { LinkPort } from "./link.ts";
import type { FromWorker, FromWorklet, ToWorker, ToWorklet, Watch } from "./protocol.ts";

const AUDIO_LEAD_FRAMES = 3;
const SRAM_FLUSH_MS = 1000;

interface WorkerScope {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

let gb: GameBoy | undefined;
let audio: MessagePort | undefined;
let samplesPerFrame = 0;
let queuedSamples = 0;
let paused = false;
let frames = 0;
let watches: Record<string, Watch> = {};
let lastSramFlush = 0;
let link: LinkPort | undefined;
let desk: GiftDesk | undefined;
let autosave: AutoSave | undefined;
let guard: EraseGuard | undefined;
let controls: Controls | undefined;
let dex: DexGuard | undefined;

const post = (message: FromWorker, transfer?: Transferable[]) => scope.postMessage(message, transfer);

function runOneFrame() {
  if (!gb) return;
  controls?.frame();
  guard?.frame();
  dex?.frame();
  gb.runFrame();
  frames++;
  autosave?.frame();

  const pcm = gb.drainAudio();
  if (audio) {
    const samples = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) samples[i] = (pcm[i] ?? 0) / 32768;
    queuedSamples += pcm.length / 2;
    audio.postMessage({ samples } satisfies ToWorklet, [samples.buffer]);
  }

  const watched: Record<string, Uint8Array> = {};
  for (const [name, [address, length]] of Object.entries(watches)) watched[name] = gb.readBytes(address, length);
  const pixels = gb.frame.slice().buffer;
  post({ type: "frame", pixels, count: frames, watched }, [pixels]);

  if (gb.sramDirty && performance.now() - lastSramFlush > SRAM_FLUSH_MS) flushSram();
}

/** Hands the save to the page; gifts that landed before it are now in a save. */
function flushSram() {
  if (!gb) return;
  gb.clearSramDirty();
  lastSramFlush = performance.now();
  post({ type: "sram", sram: gb.saveSram() });
  desk?.saved();
}

/** Audio-driven pacing: top the worklet's queue up to the lead. */
function fillAudio() {
  while (!paused && gb && queuedSamples < samplesPerFrame * AUDIO_LEAD_FRAMES) runOneFrame();
}

/** Timer pacing when there's no audio clock. */
let nextFrameAt = 0;
function tick() {
  if (audio) return;
  const now = performance.now();
  if (!paused && gb) {
    if (now - nextFrameAt > 250) nextFrameAt = now; // after a stall, don't fast-forward
    while (now >= nextFrameAt) {
      runOneFrame();
      nextFrameAt += 1000 / FRAME_RATE;
    }
  }
  setTimeout(tick, Math.max(0, nextFrameAt - performance.now()));
}

// "start" awaits the core. Messages that need the Game Boy (a friend's gift, a read) wait for
// it rather than find none; settings apply at once, so the first frame already has its watches.
let started: Promise<void> = Promise.resolve();
scope.onmessage = ({ data }) => {
  if (data.type === "start") started = handle(data);
  else if (data.type === "watch" || data.type === "pause") void handle(data);
  else void started.then(() => handle(data));
};

async function handle(data: ToWorker) {
  try {
    switch (data.type) {
      case "start": {
        const create = () => GameBoy.create({ rom: data.rom, sram: data.sram, sampleRate: data.sampleRate });
        gb = await create();
        const reason = data.resume && loadResumePoint(gb, data.resume, data.sram);
        // A failed load may have left half a state behind: start clean on the save instead.
        if (reason) gb = await create();
        desk = new GiftDesk(gb, {
          rom: data.rom,
          emit: (event) => {
            if (event.type === "landed") autosave?.prompt();
            post({ type: "gift", event });
          },
        });
        autosave = new AutoSave(gb, {
          rom: data.rom,
          skipped: (why) => post({ type: "autosave-skipped", reason: why }),
          saved: (auto) => post({ type: "saved", auto }),
        });
        guard = data.guardErase ? new EraseGuard(gb, {
          rom: data.rom,
          onPrompt: () => post({ type: "erase-prompt" }),
          onAnswered: (erase) => post({ type: "erase-answered", erase }),
        }) : undefined;
        const g = gb;
        const erase = guard;
        const toGame = (mask: number) => (erase ? erase.setButtons(mask) : g.setButtons(mask));
        dex = data.guardDex ? new DexGuard(g, {
          rom: data.rom,
          onOpen: (opened) => post({ type: "dex-open", opened }),
          onClosed: () => post({ type: "dex-closed" }),
          onTalk: (map, npc) => post({ type: "talk", map, npc }),
          onBeat: (map, npc) => post({ type: "beat", map, npc }),
        }, toGame) : undefined;
        // The page's taps and the player's buttons go through the Pokédex, then the erase guard.
        const next = dex;
        controls = new Controls(gb, {
          setButtons: (mask) => (next ? next.setButtons(mask) : toGame(mask)),
          ...(data.askNames ? { names: { ask: (ask) => post({ type: "name-ask", ask }), done: () => post({ type: "name-done" }) } } : {}),
        });
        samplesPerFrame = data.sampleRate / FRAME_RATE;
        nextFrameAt = performance.now();
        // Before the first frame, so the page knows how the game started before it sees one.
        post({ type: "ready", resumed: !!data.resume && !reason, ...(reason ? { reason } : {}) });
        tick();
        break;
      }
      case "audio": {
        // Only the newest worklet paces the game: an old one that kept reporting would make it
        // run fast (see EmulatorHost.enableAudio).
        if (audio) audio.onmessage = null;
        audio?.close();
        const port = data.port;
        audio = port;
        queuedSamples = 0;
        port.onmessage = ({ data: msg }: MessageEvent<FromWorklet>) => {
          if (audio !== port) return;
          queuedSamples = Math.max(0, queuedSamples - msg.consumed);
          fillAudio();
        };
        fillAudio();
        break;
      }
      case "buttons":
        controls?.setButtons(data.mask);
        break;
      case "tap":
        controls?.tap(data.mask);
        break;
      case "select":
        controls?.select(data.item, data.press);
        break;
      case "name-answer":
        controls?.answerName(data.name);
        break;
      case "dex-close":
        dex?.close();
        break;
      case "dex-pass":
        dex?.pass();
        break;
      case "erase-answer":
        guard?.answer(data.erase);
        break;
      case "watch":
        watches = data.watches;
        break;
      case "pause":
        paused = data.paused;
        if (!paused) fillAudio();
        break;
      case "save-state":
        if (gb) post({ type: "state", id: data.id, state: gb.saveState() });
        break;
      case "load-state":
        gb?.loadState(data.state);
        break;
      case "resume-point": {
        // Not mid-way through one of our calls, a link session, or a gift the room would resend.
        // Signed-in players always have a port open (RoomLink keeps one ready), so it's the
        // session that counts, not the port.
        const g = gb && !link?.inSession && !guard?.asking && !controls?.busy && !dex?.open && !SafePoint.of(gb).calling && (desk?.unsettled ?? 0) === 0 ? gb : undefined;
        // Hand over any newer save first, so the stored save matches the one in the state.
        if (g?.sramDirty) flushSram();
        post({ type: "resume-point", id: data.id, state: g ? g.saveState() : null });
        break;
      }
      case "autosave":
        if (autosave) autosave.enabled = data.enabled;
        break;
      case "link-open":
        link?.dispose();
        link = gb && new LinkPort(gb, {
          role: data.role,
          connectTimeoutFrames: data.connectTimeoutFrames,
          send: (message) => post({ type: "link-send", message }),
        });
        break;
      case "link-receive":
        link?.receive(data.message);
        break;
      case "link-close":
        link?.dispose();
        link = undefined;
        break;
      case "read":
        if (gb) {
          const g = gb;
          post({ type: "read", id: data.id, bytes: data.ranges.map(([address, length]) => g.readBytes(address, length)) });
        }
        break;
      case "gift-give":
        desk?.give(data.id, data.gift);
        break;
      case "gift-take": {
        const { id } = data;
        desk?.take(data.spec, (result) => {
          if (!result.ok || !gb) return post({ type: "gift-taken", id, result });
          // The game has just saved: the page stores this save before the gift goes out.
          gb.clearSramDirty();
          lastSramFlush = performance.now();
          post({ type: "gift-taken", id, result, sram: gb.saveSram() });
          desk?.saved();
        });
        break;
      }
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
}
