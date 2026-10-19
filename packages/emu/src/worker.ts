// Emulator Web Worker: owns one GameBoy and paces it.
//
// With audio, the audio clock drives emulation: the worker keeps about AUDIO_LEAD frames of
// sound queued in the worklet and runs a frame whenever the queue drops below that, so sound
// never starves and video follows at the core's own ~59.73 Hz. Without audio (no user gesture
// yet, or muted), a wall-clock timer runs frames at FRAME_RATE instead.
import { AutoSave, hasSave, loadResumePoint } from "./autosave.ts";
import { Controls } from "./controls.ts";
import { FRAME_RATE, GameBoy } from "./core.ts";
import { DexGuard } from "./dex-guard.ts";
import { EraseGuard } from "./erase-guard.ts";
import { GameActions } from "./game/actions.ts";
import { GameAsks } from "./game/asks.ts";
import { BattleMenus } from "./game/battle-menus.ts";
import { GiftDesk } from "./gifts/desk.ts";
import { busyReason, SafePoint } from "./gifts/safepoint.ts";
import { JournalHooks } from "./journal-hooks.ts";
import { LinkPort } from "./link.ts";
import { BlockWatch } from "./block-watch.ts";
import { StairStep } from "./stair-step.ts";
import { gameInputWait } from "./input-wait.ts";
import type { FromWorker, FromWorklet, ToWorker, ToWorklet, Watch } from "./protocol.ts";

const AUDIO_LEAD_FRAMES = 3;
const SRAM_FLUSH_MS = 1000;
/** How long a broken save file is held back before it is handed out anyway (see flushSram). */
const TORN_MAX_MS = 5000;

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
/** The save the page has is one the game would load; and since when the game's hasn't been. */
let handedWhole = false;
let tornSince: number | undefined;
let link: LinkPort | undefined;
let desk: GiftDesk | undefined;
let autosave: AutoSave | undefined;
let guard: EraseGuard | undefined;
let controls: Controls | undefined;
let dex: DexGuard | undefined;
let journal: JournalHooks | undefined;
let rom: Uint8Array | undefined;
let actions: GameActions | undefined;
/** Queued actions' cancels, by the page's id. */
const cancels = new Map<number, () => void>();
/** Menu actions the game hasn't taken up yet: from which frame, and its overworld loop count then. */
const waiting = new Map<number, { since: number; loops: number }>();
/** How long an action may wait before the page hears why (3 s). */
const WAIT_FRAMES = 180;
let asks: GameAsks | undefined;
let battleMenus: BattleMenus | undefined;
let blockWatch: BlockWatch | undefined;
let scriptText = false;

const post = (message: FromWorker, transfer?: Transferable[]) => scope.postMessage(message, transfer);

function runOneFrame() {
  if (!gb) return;
  controls?.frame();
  guard?.frame();
  dex?.frame();
  gb.runFrame();
  frames++;
  autosave?.frame();
  blockWatch?.frame();
  if (waiting.size > 0) tellWaiting(gb);

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
  const wait = gameInputWait(gb);
  post({ type: "frame", pixels, count: frames, watched, ...(actions?.running ? { acting: true } : {}), ...(wait ? { wait } : {}) }, [pixels]);

  if (gb.sramDirty && performance.now() - lastSramFlush > SRAM_FLUSH_MS) flushSram();
}

/**
 * Hands the save to the page; gifts that landed before it are now in a save. Returns false if
 * the game is part-way through writing its save over a whole one: the save file's checksum is
 * wrong for a few frames then, and a page closed before the next flush would have lost
 * CONTINUE. It's handed out once whole again, or once it has stayed broken for TORN_MAX_MS
 * (the title screen's erase, which the game means).
 */
function flushSram(): boolean {
  if (!gb) return true;
  const sram = gb.saveSram();
  const whole = hasSave(sram);
  const now = performance.now();
  if (!whole && handedWhole) {
    tornSince ??= now;
    if (now - tornSince < TORN_MAX_MS) return false;
  }
  tornSince = undefined;
  handedWhole = whole;
  gb.clearSramDirty();
  lastSramFlush = now;
  post({ type: "sram", sram });
  desk?.saved();
  return true;
}

/**
 * Audio-driven pacing: top the worklet's queue up to the lead. Without a worklet nothing fills
 * the queue, so this would never stop: the timer paces the game then (an unpause before any
 * sound, as when /dev/saves lets its game go on the very tap that starts the sound).
 */
function fillAudio() {
  while (!paused && gb && audio && queuedSamples < samplesPerFrame * AUDIO_LEAD_FRAMES) runOneFrame();
}

/** Tells the page about actions still waiting after WAIT_FRAMES, once each, and why. */
function tellWaiting(g: GameBoy) {
  const safe = SafePoint.of(g);
  for (const [id, w] of waiting) {
    if (frames - w.since < WAIT_FRAMES) continue;
    waiting.delete(id);
    const pc = g.registers.pc.toString(16).padStart(4, "0");
    const reason = safe.calling
      ? "another action is still running"
      : (busyReason(g) ?? (safe.loops === w.loops ? `the game isn't walking around (pc ${pc})` : "queued behind other actions"));
    post({ type: "action-waiting", id, reason });
  }
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
  // Paused, there's no frame due: look again a frame from now rather than spin.
  setTimeout(tick, paused || !gb ? 1000 / FRAME_RATE : Math.max(0, nextFrameAt - performance.now()));
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
        handedWhole = hasSave(gb.saveSram());
        desk = new GiftDesk(gb, {
          rom: data.rom,
          emit: (event) => {
            if (event.type === "landed") autosave?.prompt();
            post({ type: "gift", event });
          },
        });
        // After the gift desk, so its SafePoint calls are known as the page's.
        journal = data.journal ? new JournalHooks(gb, { rom: data.rom, emit: (event) => post({ type: "journal", event }) }) : undefined;
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
          script: {
            message: (message) => post({ type: "script-message", message }),
            end: (id) => post({ type: "script-end", id }),
            press: () => post({ type: "script-press" }),
          },
        });
        if (data.menu) {
          const act = (actions = new GameActions(gb, { rom: data.rom }));
          asks = new GameAsks(gb, { rom: data.rom, busy: () => act.pending > 0 && SafePoint.of(g).calling, onAsk: (id, ask) => post({ type: "ask", id, ask }) });
        }
        // Diagonals walk as a staircase, from any pad.
        new StairStep(gb);
        blockWatch = data.blocks ? new BlockWatch(gb, (blocks) => post({ type: "blocks", blocks })) : undefined;
        // A resume point holds whatever the game had changed: send it as it is.
        blockWatch?.refresh();
        battleMenus = data.battleMenus ? new BattleMenus(gb, { rom: data.rom, onAsk: (id, ask) => post({ type: "battle-ask", id, ask }) }) : undefined;
        rom = data.rom;
        if (scriptText) controls.setScriptText(rom);
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
      case "script-text":
        scriptText = data.enabled;
        controls?.setScriptText(scriptText ? (rom ?? null) : null);
        break;
      case "script-read-on":
        controls?.readOn(data.id);
        break;
      case "script-close":
        controls?.closeMessage(data.id);
        break;
      case "script-release":
        controls?.releaseMessage(data.id);
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
        journal?.resync();
        blockWatch?.refresh();
        break;
      case "resume-point": {
        // Not mid-way through one of our calls, a link session, or a gift the room would resend.
        // Signed-in players always have a port open (RoomLink keeps one ready), so it's the
        // session that counts, not the port.
        const g = gb && !link?.inSession && !guard?.asking && !controls?.busy && !dex?.open && !asks?.asking && !actions?.pending && !SafePoint.of(gb).calling && (desk?.unsettled ?? 0) === 0 ? gb : undefined;
        // Hand over any newer save first, so the stored save matches the one in the state. None
        // while the game is part-way through saving: neither is a save it would load.
        const whole = g && (!g.sramDirty || flushSram());
        post({ type: "resume-point", id: data.id, state: g && whole ? g.saveState() : null });
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
      case "action": {
        const { id } = data;
        if (!actions) post({ type: "action-done", id, result: { ok: false, reason: "menu hooks are off", messages: [] } });
        else {
          waiting.set(id, { since: frames, loops: SafePoint.of(gb!).loops });
          cancels.set(
            id,
            actions.run(
              data.action,
              (result) => {
                cancels.delete(id);
                waiting.delete(id);
                post({ type: "action-done", id, result });
              },
              () => waiting.delete(id),
            ),
          );
        }
        break;
      }
      case "action-cancel":
        cancels.get(data.id)?.();
        break;
      case "ask-answer":
        asks?.answer(data.id, data.answer);
        break;
      case "battle-answer":
        battleMenus?.answer(data.id, data.answer);
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
          const sram = gb.saveSram();
          handedWhole = hasSave(sram);
          tornSince = undefined;
          post({ type: "gift-taken", id, result, sram });
          desk?.saved();
        });
        break;
      }
    }
  } catch (err) {
    const stack = err instanceof Error ? err.stack : undefined;
    post({ type: "error", message: err instanceof Error ? err.message : String(err), ...(stack ? { stack } : {}) });
  }
}
