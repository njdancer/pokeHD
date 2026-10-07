// Emulator Web Worker: owns one GameBoy and paces it.
//
// With audio, the audio clock drives emulation: the worker keeps about AUDIO_LEAD frames of
// sound queued in the worklet and runs a frame whenever the queue drops below that, so sound
// never starves and video follows at the core's own ~59.73 Hz. Without audio (no user gesture
// yet, or muted), a wall-clock timer runs frames at FRAME_RATE instead.
import { FRAME_RATE, GameBoy } from "./core.ts";
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

const post = (message: FromWorker, transfer?: Transferable[]) => scope.postMessage(message, transfer);

function runOneFrame() {
  if (!gb) return;
  gb.runFrame();
  frames++;

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

  const now = performance.now();
  if (gb.sramDirty && now - lastSramFlush > SRAM_FLUSH_MS) {
    gb.clearSramDirty();
    lastSramFlush = now;
    post({ type: "sram", sram: gb.saveSram() });
  }
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

scope.onmessage = async ({ data }) => {
  try {
    switch (data.type) {
      case "start": {
        gb = await GameBoy.create({ rom: data.rom, sram: data.sram, sampleRate: data.sampleRate });
        samplesPerFrame = data.sampleRate / FRAME_RATE;
        nextFrameAt = performance.now();
        tick();
        post({ type: "ready" });
        break;
      }
      case "audio":
        audio = data.port;
        queuedSamples = 0;
        audio.onmessage = ({ data: msg }: MessageEvent<FromWorklet>) => {
          queuedSamples = Math.max(0, queuedSamples - msg.consumed);
          fillAudio();
        };
        fillAudio();
        break;
      case "buttons":
        gb?.setButtons(data.mask);
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
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
