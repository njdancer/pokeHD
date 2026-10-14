// The game driver: the real game in Chromium, played only through touches on the screen, with
// what happened written out from what the screen shows. See types.ts for the contract.
//
// Two ways to open the game: through the stream page (`streamPath`, default /dev/stream), whose
// <iframe id="game"> holds it, or (`streamPath: "game"`) the game page alone at the game's size.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type CDPSession, type ElementHandle, type Frame, type Page } from "@playwright/test";
import { ScreenTextDecoder, TEXT_WATCHES, type TextWatched } from "@pokehd/emu";
import { parseWorld, readGlyphs, stitchOverworld, SYMBOLS, type StitchedWorld, type WorldData } from "@pokehd/rom";
import { GlitchWatcher } from "./glitches.ts";
import { describeMessages, readiness, type LoggedLine } from "./idle.ts";
import { continueButton, describeButtons, describeGameBoyText, describePanels, mapName, startingUp } from "./outcome.ts";
import { describeLayouts, installLayoutLog, type LayoutEntry } from "./layout-log.ts";
import { composeSheet, cropShot, MAX_SHEET_FRAMES, pickFrames, Recorder } from "./recorder.ts";
import { readScreen, type ScreenRead, type StateLite } from "./screen-read.ts";
import { blockerAt, buildTextMap } from "./textmap.ts";
import type { Direction, GameDriver, GameStatus, Glitch, Move, Outcome, RestartOptions } from "./types.ts";
import { countSteps, DIRS, interruption, MapEntry, stallFrames, walkNote, walkPath, type PathResult, type Stop } from "./walk.ts";

export interface DriverOptions {
  /** The app's origin, e.g. http://localhost:5173. */
  appUrl: string;
  /** The stream page's path (default /dev/stream), or "game" for the game page alone. */
  streamPath?: string;
  /** This run's folder; the browser profile (the game's saves) lives next to it, in ../profile. */
  runDir: string;
  headless?: boolean;
  /**
   * The game page's query, in both modes (the stream page gets it as `?game=`). Default
   * "stats&qa&maxfps=60": a 120 Hz display would otherwise draw 120 fps and starve the stream's
   * encoder. E.g. add "&render=0" where there's no GPU.
   */
  gameQuery?: string;
  /** The ROM for the text map (default rom/pokeblue.gb in the repo). */
  romPath?: string;
}

const GAME_SIZE = { width: 528, height: 1000 } as const;
/**
 * The stream page's window: 1280 wide, and tall enough that the page under Chromium's bars is
 * about 720. Headed, the page takes whatever the window really shows: Chromium's bars (automation, "sharing this tab") take height from it, and a
 * fixed viewport would then run off the bottom of the window and of the tab capture. The page
 * scales its 1920×1080 stage to fit. Headless there are no bars, so the viewport is fixed, at
 * 1.5× so it still records at 1920×1080.
 */
const STREAM_WINDOW = { width: 1280, height: 912 } as const;
const STREAM_VIEWPORT = { width: 1280, height: 720 } as const;
const STREAM_SCALE = 1.5;
/** How often the headed stream window is checked against STREAM_VIEWPORT. */
const FIT_EVERY_MS = 3000;
const READY_TIMEOUT_MS = 120_000;
/**
 * The longest an action waits for the game to take input again, before and after it: room for an
 * evolution or a long scene, after which the result says what the game was still doing.
 */
const READY_MAX_MS = 15_000;
/**
 * The longest one action (a tap, a swipe, a walk) takes from the call to its result, whatever the
 * game does: past it the harness lets go of the screen and says what's on it, with a note. Room
 * for a wait before (READY_MAX_MS), a 40-step walk and a wait after. A walk in a dark cave once
 * never ended (it took the cave's dim palette for a fade still under way) and the turn hung.
 */
export const ACTION_MAX_MS = 45_000;
/** Kept back from an action's deadline to read and describe what's on screen. */
const OUTCOME_MS = 6_000;
/** The longest one look into the page may take (a page that stopped answering). */
const EVAL_MAX_MS = 10_000;
const SETTLE_CALM_MS = 500;
/** Emulated frames the game must run unchanged to count as settled (a step is 16). */
const SETTLE_CALM_FRAMES = 20;
/** The same after a warp to another map. */
const SETTLE_WARP_FRAMES = 60;
const POLL_MS = 200;
const CONSOLE_LINES = 200;
const DEFAULT_ROM = fileURLToPath(new URL("../../../../rom/pokeblue.gb", import.meta.url));

/** Console errors that are the sandbox's or the mocks' doing, not the game's. */
const IGNORED_CONSOLE = [/Failed to load resource/, /\/api\/room/, /EventSource|\/events\b|:4545/];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `p`, or an error once `ms` has gone by without it. */
export function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} didn't answer in ${Math.round(ms / 1000)} s`)), Math.max(0, ms));
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/** In the page: ends a walk `walkPath` is following, lifting the thumb (see walk.ts). */
const stopWalk = () => void ((globalThis as typeof globalThis & { __qaWalkStop?: boolean }).__qaWalkStop = true);

/** One action under way: when it must stop waiting, and whether the harness gave up on it (its touches then stop). */
interface Call {
  deadline: number;
  dead: boolean;
}

interface Rom {
  world: WorldData;
  stitched: StitchedWorld;
  decoder: ScreenTextDecoder;
  key: string;
}

function loadRom(path: string): Rom | null {
  if (!existsSync(path)) return null;
  const bytes = new Uint8Array(readFileSync(path));
  const world = parseWorld(bytes);
  return {
    world,
    stitched: stitchOverworld(world),
    decoder: new ScreenTextDecoder(readGlyphs(bytes)),
    key: createHash("sha1").update(bytes).digest("hex"),
  };
}

export function createDriver(opts: DriverOptions): GameDriver {
  const direct = opts.streamPath === "game";
  const appUrl = opts.appUrl.replace(/\/$/, "");
  const gamePath = `/?${opts.gameQuery ?? "stats&qa&maxfps=60"}`;
  const gameUrl = `${appUrl}${gamePath}`;
  const streamPath = opts.streamPath ?? "/dev/stream";
  const pageUrl = direct ? gameUrl : `${appUrl}${streamPath}${streamPath.includes("?") ? "&" : "?"}game=${encodeURIComponent(gamePath)}`;
  const profileDir = resolve(opts.runDir, "..", "profile");
  const rom = loadRom(opts.romPath ?? DEFAULT_ROM);
  const watcher = new GlitchWatcher();
  const recorder = new Recorder();
  const consoleLines: string[] = [];

  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let input: CDPSession | null = null;
  let sheetPage: Page | null = null;
  /**
   * Contact sheets are drawn in a browser of their own, headless: a second tab in the headed stream
   * window comes to the front to be screenshotted, hiding the stream for a few frames (a flicker).
   */
  let sheetBrowser: Browser | null = null;
  async function sheet(): Promise<Page> {
    sheetBrowser ??= await chromium.launch({ headless: true, ...(!existsSync(chromium.executablePath()) && { channel: "chrome" }) });
    return (sheetPage ??= await sheetBrowser.newPage());
  }
  let poller: ReturnType<typeof setInterval> | null = null;
  let fitter: ReturnType<typeof setInterval> | null = null;

  /**
   * Keeps the headed stream page at exactly STREAM_VIEWPORT, so the capture is 16:9 with no bars:
   * Chromium's own bars ("controlled by automated software", "sharing this tab") come and go and
   * take their height from the page, and the window can be resized by hand.
   */
  async function fitWindow(): Promise<void> {
    if (!page || !input) return;
    const size = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    const dw = STREAM_VIEWPORT.width - size.w;
    const dh = STREAM_VIEWPORT.height - size.h;
    if (Math.abs(dw) <= 1 && Math.abs(dh) <= 1) return;
    const { windowId, bounds } = (await input.send("Browser.getWindowForTarget")) as { windowId: number; bounds: { width?: number; height?: number; windowState?: string } };
    if (bounds.windowState && bounds.windowState !== "normal") return;
    await input.send("Browser.setWindowBounds", { windowId, bounds: { width: (bounds.width ?? 0) + dw, height: (bounds.height ?? 0) + dh } });
  }
  let polling = false;
  let busy = 0;
  let slowSince = 0;
  let last: ScreenRead | null = null;
  /** The emulator's speed (frames per second), measured by `settle`; times a walk with no state to follow. */
  let emuFps = 59.7;
  /** The screen when the game was last still busy at READY_MAX_MS: the next action doesn't wait on the same again. */
  let stuck: string | null = null;
  /** How far the page's message log has been told (apps/web qa-signals.ts MessageLog). */
  let told = { boot: "", seq: 0 };
  const entry = new MapEntry();

  const need = <T>(v: T | null): T => {
    if (!v) throw new Error("The driver isn't started");
    return v;
  };

  const logLine = (line: string) => {
    consoleLines.push(`${new Date().toISOString()} ${line}`);
    if (consoleLines.length > CONSOLE_LINES) consoleLines.shift();
  };

  async function frameHandle(): Promise<ElementHandle | null> {
    if (direct) return null;
    return need(page).waitForSelector("iframe#game", { timeout: 60_000 });
  }

  async function gameFrame(): Promise<Frame> {
    if (direct) return need(page).mainFrame();
    const handle = await frameHandle();
    const frame = await handle!.contentFrame();
    if (!frame) throw new Error("The game's frame has no document");
    return frame;
  }

  /** The game's rectangle on the page, in CSS pixels. */
  async function gameBox(): Promise<{ x: number; y: number; width: number; height: number }> {
    if (direct) return { x: 0, y: 0, ...GAME_SIZE };
    const box = await (await frameHandle())!.boundingBox();
    if (!box) throw new Error("The game's frame isn't on screen");
    return box;
  }

  async function read(): Promise<ScreenRead> {
    const frame = await gameFrame();
    const r = await within(frame.evaluate(readScreen, { slowSince }), EVAL_MAX_MS, "The game's page");
    const newest = r.slow.at(-1);
    if (newest) slowSince = newest.at;
    feed(r);
    last = r;
    return r;
  }

  function feed(r: ScreenRead) {
    watcher.sample({
      at: Date.now(),
      hooked: r.hooked,
      inWorld: r.inWorld,
      mode: r.state?.mode ?? null,
      layout: r.layout,
      loading: r.loading,
      frames: r.frames,
      visible: r.visible,
      held: r.held,
      busy: busy > 0,
      slow: r.slow,
    });
  }

  function startPolling() {
    poller = setInterval(() => {
      if (polling || busy > 0) return;
      polling = true;
      read()
        .catch(() => {})
        .finally(() => (polling = false));
    }, POLL_MS);
  }

  // ---- input: touches, as a finger makes them ----

  async function toPage(x: number, y: number): Promise<{ x: number; y: number }> {
    const box = await gameBox();
    return { x: box.x + (x * box.width) / GAME_SIZE.width, y: box.y + (y * box.height) / GAME_SIZE.height };
  }

  async function touch(type: "touchStart" | "touchMove" | "touchEnd", at?: { x: number; y: number }, call?: Call) {
    // An action the harness gave up on touches nothing more (the next one may have a finger down).
    if (call?.dead) throw new Error("The action ran out of time");
    await need(input).send("Input.dispatchTouchEvent", {
      type,
      touchPoints: at ? [{ x: at.x, y: at.y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] : [],
    });
  }

  // ---- reading the outcome ----

  const signature = (r: ScreenRead) =>
    JSON.stringify([
      r.inWorld,
      r.loading,
      r.layout,
      r.state && [r.state.mode, r.state.mapId, r.state.player.x, r.state.player.y, r.state.player.facing, r.state.fade],
      r.panels,
      r.buttons.map((b) => b.label),
    ]);

  /**
   * Waits until the game will take the player's next input (`readiness`: the page's word, no fade,
   * no step) and the screen has stopped changing, or `maxMs` (or the action's `deadline`). `busy`
   * says what the game was still doing if it ran out of time, after `ms`.
   */
  async function settle(minMs = 250, maxMs = READY_MAX_MS, fromMap?: number, deadline = Infinity): Promise<Settled> {
    const start = Date.now();
    const end = Math.min(start + maxMs, deadline);
    await sleep(minMs);
    let sig = "";
    let since = Date.now();
    let sinceFrames = 0;
    let prev: { frames: number; at: number } | null = null;
    for (;;) {
      const r = await read();
      const now = Date.now();
      if (prev && r.frames > prev.frames && now > prev.at) emuFps = emuFps * 0.7 + Math.min(70, Math.max(10, ((r.frames - prev.frames) * 1000) / (now - prev.at))) * 0.3;
      prev = { frames: r.frames, at: now };
      const s = signature(r);
      if (s !== sig) {
        sig = s;
        since = Date.now();
        sinceFrames = r.frames;
      }
      const ready = readiness(r);
      // Quiet while the game actually ran: a game starved of CPU looks still between its frames,
      // and would carry on (finish a step, say) after the outcome was read. A menu that holds the
      // game stops its frames on purpose.
      // After a warp (stairs, a ladder, a door) the new map is loaded, placed and faded in over a
      // second or so: give it longer, so the map is read with the player where they landed.
      const warped = fromMap !== undefined && !!r.state && r.state.mapId !== fromMap;
      const ran = r.held || !r.state || r.frames - sinceFrames >= (warped ? SETTLE_WARP_FRAMES : SETTLE_CALM_FRAMES);
      const quiet = ran && Date.now() - since >= SETTLE_CALM_MS;
      if (ready.ready && quiet) {
        stuck = null;
        return { read: r, busy: null, ms: Date.now() - start };
      }
      if (Date.now() > end) {
        const busy = ready.ready ? "the screen still changing" : ready.why;
        stuck = stuckKey(r);
        return { read: r, busy, ms: Date.now() - start };
      }
      await sleep(100);
    }
  }

  type Settled = { read: ScreenRead; busy: string | null; ms: number };
  type Waited = { busy: string; ms: number } | null;
  const waited = (s: Settled): Waited => (s.busy ? { busy: s.busy, ms: s.ms } : null);

  const stuckKey = (r: ScreenRead) => JSON.stringify([signature(r), r.input]);

  /**
   * Before an action: waits for the game to take it, unless it's as it was when it last ran out
   * of time (then the action may be just what it's waiting for). What it was still busy with, if
   * it ran out of time again.
   */
  async function untilReady(deadline: number): Promise<Waited> {
    const r = await read();
    if (readiness(r).ready || (stuck !== null && stuck === stuckKey(r))) return null;
    return waited(await settle(0, READY_MAX_MS, undefined, deadline));
  }

  /** The page's messages since it last told them (and none from before a reload). */
  async function newMessages(): Promise<LoggedLine[]> {
    type Hook = { messages?(after: number): { boot: string; lines: LoggedLine[] } };
    const got = await (await gameFrame())
      .evaluate(({ boot, seq }) => {
        const hook = (window as unknown as { __pokehd?: Hook }).__pokehd;
        if (!hook?.messages) return null;
        const all = hook.messages(0);
        return all.boot === boot ? hook.messages(seq) : all;
      }, told)
      .catch(() => null);
    if (!got) return [];
    const fresh = got.boot === told.boot;
    told = { boot: got.boot, seq: Math.max(fresh ? told.seq : 0, ...got.lines.map((l) => l.seq)) };
    return fresh ? got.lines : [];
  }

  /** The result's notes on waiting: before the action, and after it. */
  function waitNotes(before: Waited, after: Waited): string[] {
    const secs = (w: NonNullable<Waited>) => Math.round(w.ms / 1000);
    return [
      before ? `(The game was still busy with ${before.busy} after ${secs(before)} s, so your action went in anyway.)` : "",
      after ? `(The game was still busy with ${after.busy} after ${secs(after)} s. Your next action waits for it first.)` : "",
    ].filter(Boolean);
  }

  /**
   * Runs one action with a hard deadline (ACTION_MAX_MS). The action itself stops waiting at
   * `call.deadline`; should it still not be done (a look into the page that never came back), the
   * harness lets go of the screen and returns what's on it.
   */
  async function bounded(work: (call: Call) => Promise<Outcome>): Promise<Outcome> {
    const call: Call = { deadline: Date.now() + ACTION_MAX_MS - OUTCOME_MS, dead: false };
    const done = work(call);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((r) => (timer = setTimeout(() => r(null), ACTION_MAX_MS)));
    try {
      const got = await Promise.race([done, late]);
      if (got) return got;
    } finally {
      clearTimeout(timer);
    }
    call.dead = true;
    done.catch(() => {});
    return giveUp();
  }

  /** After an action ran out of time: lift every touch, stop any walk, and say what's on screen. */
  async function giveUp(): Promise<Outcome> {
    const secs = ACTION_MAX_MS / 1000;
    logLine(`[qa] an action ran past ${secs} s; letting go`);
    await within(touch("touchEnd"), 2000, "Lifting the touch").catch(() => {});
    const frame = await within(gameFrame(), 3000, "The game's frame").catch(() => null);
    if (frame) await within(frame.evaluate(stopWalk), 2000, "Stopping the walk").catch(() => {});
    const r = await read().catch(() => null);
    if (!r) return { text: `(The game's page didn't answer for ${secs} s, so the harness gave up and let go of the screen. It may be stuck: take a screenshot, and restart_game if it stays that way.)` };
    stuck = stuckKey(r);
    const ready = readiness(r);
    const o = await within(outcome(null, r), 5000, "Reading the screen").catch(() => null);
    const note = `(The game was still busy${ready.ready ? "" : ` with ${ready.why}`} after ${secs} s, so the harness stopped waiting and let go of the screen. This is what's on it now; your next action doesn't wait on the same again.)`;
    return { text: [note, o?.text ?? ""].filter(Boolean).join("\n") };
  }

  /** Text boxes decoded from the Game Boy screen, for screens the page draws none of its own for. */
  async function gameBoyText(shown: boolean): Promise<string> {
    if (!rom) return "";
    const frame = await gameFrame();
    const watches = Object.entries(TEXT_WATCHES) as [keyof TextWatched, readonly [number, number]][];
    const bytes = await frame.evaluate(async (list: [number, number][]) => {
      const hook = (window as Window & { __pokehd?: { read(a: number, n: number): Promise<number[]> } }).__pokehd;
      if (!hook) return null;
      return Promise.all(list.map(([a, n]) => hook.read(a, n)));
    }, watches.map(([, w]) => [w[0], w[1]] as [number, number]));
    if (!bytes) return "";
    const watched = Object.fromEntries(watches.map(([name], i) => [name, new Uint8Array(bytes[i]!)])) as TextWatched;
    return describeGameBoyText(rom.decoder.decode(watched).boxes, shown);
  }

  async function outcome(before: ScreenRead | null, after: ScreenRead): Promise<Outcome> {
    const parts: string[] = [];
    const s = after.state;
    const b = before?.state;
    if (!after.hooked || after.loading) {
      parts.push("The game is loading.");
    } else {
      if (s && after.inWorld && (!before?.inWorld || (b && b.mapId !== s.mapId))) parts.push(`You're now in ${mapName(s.mapId)}.`);
      const battleCards = after.panels.filter((p) => p.kind.startsWith("battle-card"));
      if (s?.mode === "battle" && b?.mode !== "battle") {
        const foe = battleCards.find((p) => p.kind.endsWith("enemy"));
        parts.push(foe ? `A battle started! You're facing ${foe.text.replace(/\n/g, " ")}.` : "A battle started!");
      } else if (s?.mode === "battle" && battleCards.length) {
        parts.push(`Battle: ${battleCards.map((p) => `${p.kind.endsWith("enemy") ? "foe" : "you"} ${p.text.replace(/\n/g, " ")}`).join("; ")}.`);
      }
      const panels = after.panels.filter((p) => !p.kind.startsWith("battle-card"));
      const textual = panels.filter((p) => p.kind !== "toast");
      const ready = readiness(after);
      if (panels.length) parts.push(describePanels(panels, ready.ready && ready.on === "message"));
      // The game's own screen in front (or a dialog the page has no HD box for): read its tiles.
      const gameBoyShown = after.layout === "full" || after.layout === "dialog";
      const gameBoyUp = gameBoyShown || (s && s.mode !== "overworld");
      if (!textual.length && gameBoyUp) {
        const text = await gameBoyText(gameBoyShown).catch(() => "");
        if (text) parts.push(text);
      }
      if (s && after.inWorld && s.mode === "overworld" && !textual.length && after.layout !== "full") {
        parts.push(rom ? buildTextMap(rom.world, rom.stitched, s) : "(No ROM here, so no map of the screen.)");
      }
    }
    // Mid-fade, or a screen the page has no words for yet: say so rather than nothing.
    if (!parts.length) parts.push("Nothing to read on screen right now (it may be changing). Take a screenshot to see it.");
    const buttons = describeButtons(after);
    if (buttons) parts.push(buttons);
    return { text: parts.join("\n") };
  }

  function act(fn: (call: Call) => Promise<void>, minMs = 250): Promise<Outcome> {
    return bounded(async (call) => {
      const before = await untilReady(call.deadline);
      const prev = last ?? (await read());
      const from = Date.now();
      await fn(call);
      const after = await settle(minMs, READY_MAX_MS, undefined, call.deadline);
      const result = await outcome(prev, after.read);
      const said = describeMessages(await newMessages(), messageText(after.read));
      const log = await (await gameFrame()).evaluate(() => (window as unknown as { __qaLayouts?: LayoutEntry[] }).__qaLayouts ?? []).catch(() => []);
      const screen = describeLayouts(log, from, Date.now());
      return { text: [...waitNotes(before, waited(after)), said, result.text, screen ?? ""].filter(Boolean).join("\n") };
    });
  }

  /** The message box's text on screen now. */
  const messageText = (r: ScreenRead) => r.panels.filter((p) => p.kind === "message").map((p) => p.text);

  // ---- start and reload ----

  async function waitReady(): Promise<ScreenRead> {
    const start = Date.now();
    for (;;) {
      const r = await read().catch(() => null);
      if (r?.hooked && !r.loading && (r.inWorld || r.panels.length || r.buttons.some((b) => !b.pad && b.label !== "Menu"))) return r;
      if (Date.now() - start > READY_TIMEOUT_MS) {
        if (r) return r;
        throw new Error("The game never became ready");
      }
      await sleep(250);
    }
  }

  /**
   * Taps the start screen's Continue and waits until the game is back in the world. Without
   * `always`, only when Continue is the sole choice (anything else is left to the player).
   */
  async function passContinueScreen(r: ScreenRead, always = false): Promise<void> {
    const c = continueButton(r, !always);
    if (!c) return;
    const at = await toPage(c.x + c.w / 2, c.y + c.h / 2);
    await touch("touchStart", at);
    await sleep(60);
    await touch("touchEnd");
    const start = Date.now();
    for (;;) {
      const now = await read().catch(() => null);
      if (now?.inWorld && !now.loading && !startingUp(now)) return;
      if (Date.now() - start > READY_TIMEOUT_MS) return;
      await sleep(250);
    }
  }

  /** The play time the game shows ("1:16"), or null mid-reload. */
  async function playTime(): Promise<string | null> {
    try {
      const frame = await gameFrame();
      const bytes = await frame.evaluate(
        ([a, n]) => (window as Window & { __pokehd?: { read(a: number, n: number): Promise<number[]> } }).__pokehd?.read(a, n) ?? null,
        [SYMBOLS.wPlayTimeHours.address, SYMBOLS.wPlayTimeMinutes.address - SYMBOLS.wPlayTimeHours.address + 1] as const,
      );
      return bytes ? `${bytes[0]}:${String(bytes.at(-1)).padStart(2, "0")}` : null;
    } catch {
      return null;
    }
  }

  async function navigate(url: string): Promise<void> {
    if (direct) await need(page).goto(url);
    else await (await gameFrame()).goto(url);
  }

  /** The newest resume point's time in the game's storage (IndexedDB "pokehd", store "saves"). */
  const resumePointTime = (frame: Frame) =>
    frame.evaluate(
      () =>
        new Promise<number>((done) => {
          const req = indexedDB.open("pokehd");
          req.onerror = () => done(0);
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("saves")) return done(0);
            const store = db.transaction("saves", "readonly").objectStore("saves");
            const all = store.openCursor();
            let newest = 0;
            all.onsuccess = () => {
              const c = all.result;
              if (!c) {
                db.close();
                return done(newest);
              }
              if (String(c.key).endsWith(":resume")) newest = Math.max(newest, (c.value as { takenAt?: number }).takenAt ?? 0);
              c.continue();
            };
            all.onerror = () => done(newest);
          };
        }),
    );

  const deleteResumePoints = (frame: Frame) =>
    frame.evaluate(
      () =>
        new Promise<number>((done) => {
          const req = indexedDB.open("pokehd");
          req.onerror = () => done(0);
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("saves")) return done(0);
            const tx = db.transaction("saves", "readwrite");
            const store = tx.objectStore("saves");
            let n = 0;
            const all = store.openCursor();
            all.onsuccess = () => {
              const c = all.result;
              if (!c) return;
              if (String(c.key).endsWith(":resume")) {
                c.delete();
                n++;
              }
              c.continue();
            };
            tx.oncomplete = () => {
              db.close();
              done(n);
            };
            tx.onerror = () => done(n);
          };
        }),
    );

  /**
   * As when the player switches app: the game takes a fresh resume point, so a reload (or the next
   * run) comes back exactly here. False if it didn't take one in time; true when not in the world.
   */
  async function takeResumePoint(): Promise<boolean> {
    const frame = await gameFrame();
    const r = await read().catch(() => null);
    if (!r?.inWorld) return true;
    const before = await resumePointTime(frame);
    await frame.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const start = Date.now();
    while ((await resumePointTime(frame)) <= before && Date.now() - start < 10_000) await sleep(200);
    return (await resumePointTime(frame)) > before;
  }

  async function restart(o: RestartOptions = {}): Promise<Outcome> {
    const from = o.from ?? "now";
    busy++;
    const notes: string[] = [];
    try {
      const frame = await gameFrame();
      const url = frame.url() && !frame.url().startsWith("about:") ? frame.url() : gameUrl;
      if (from === "now") {
        if (!(await takeResumePoint())) notes.push("(The game didn't take a fresh resume point, so it may come back a little earlier.)");
        await navigate(url);
      } else {
        // Leave the game first (it may take a last point on its way out), then drop every point.
        const blank = new URL("/__qa/blank", url).href;
        await navigate(blank);
        await sleep(1000);
        const f = await gameFrame();
        await deleteResumePoints(f);
        await sleep(300);
        await deleteResumePoints(f);
        await navigate(url);
      }
      watcher.reset();
      slowSince = 0;
      last = null;
      const ready = await waitReady();
      // Restarting means carrying on: Continue loads the battery save, never "New game".
      await passContinueScreen(ready, true);
    } finally {
      busy--;
    }
    const { read: after } = await settle(500);
    await newMessages();
    if (from === "save" && after.inWorld && after.state) {
      // Say where the save put the player: autosaves land every 5 minutes and after battles, so
      // the last save can be later (or earlier) than the player remembers.
      const time = await playTime();
      notes.push(`Back at your last save (yours or an autosave): ${mapName(after.state.mapId)}${time ? `, ${time} played` : ""}.`);
    }
    const out = await outcome(null, after);
    return { text: [...notes, out.text].join("\n") };
  }

  // ---- the contract ----

  async function sheetBetween(from: number, to: number, fps: number, zero: number, title: string): Promise<Buffer> {
    const now = Date.now();
    if (to > now) await sleep(Math.min(to - now, 10_000));
    const picked = pickFrames(recorder.frames, from, to, fps, MAX_SHEET_FRAMES);
    const box = await gameBox();
    if (!picked.length) throw new Error("No recorded frames in that span");
    const scale = picked[0]!.frame.scale;
    const crop = { x: Math.round(box.x * scale), y: Math.round(box.y * scale), w: Math.round(box.width * scale), h: Math.round(box.height * scale) };
    return composeSheet(await sheet(), {
      frames: picked.map(({ frame, at }) => ({ data: frame.data, label: `${at - zero >= 0 ? "+" : ""}${((at - zero) / 1000).toFixed(2)} s` })),
      crop,
      cellWidth: Math.min(264, crop.w),
      title,
    });
  }

  /** The joystick action's walk (see GameDriver.joystick), within `call`'s deadline. */
  async function walk(moves: Move[], call: Call): Promise<Outcome> {
    // A run leg ("↑*") goes until something stops it, at most 40 steps.
    const runs = moves
      .map((m) => ({ direction: m.direction, steps: m.run ? 40 : Math.max(1, Math.min(20, Math.round(m.tiles))), run: !!m.run }))
      .filter((m) => m.direction in DIRS);
    let total = runs.reduce((n, r) => n + (r.run ? 0 : r.steps), 0);
    const waitedBefore = await untilReady(call.deadline);
    const before = await read();
    const stick = before.joystick;
    if (!stick || !runs.length) {
      const o = await outcome(before, before);
      return { text: [...waitNotes(waitedBefore, null), stick ? "No moves given." : "The joystick isn't on screen right now.", o.text].join("\n") };
    }
    const layoutsFrom = Date.now();
    const centre = { x: stick.x + stick.w / 2, y: stick.y + stick.h / 2 };
    const p0 = await toPage(centre.x, centre.y);
    const from = before.state;
    if (from) entry.see(from);
    const stepFrames = from?.player && (from.player as { transport?: string }).transport === "bike" ? 8 : 16;
    // The thumb leans 55 px (page) from where it went down; in the game's own pixels for the page side.
    const lean = 55;
    const box = await gameBox();
    const frame = await gameFrame();
    // Armed before the touch goes down, so it sees the first step from its first frame.
    const following = from
      ? await frame
          .evaluate(walkPath, {
            legs: runs.map((r) => ({ ...DIRS[r.direction], steps: r.steps, run: r.run })),
            centre,
            reach: (lean * GAME_SIZE.width) / box.width,
            stall: stallFrames(stepFrames),
            idleMs: 5000,
            // The rest of the action's time, less a wait after it.
            maxMs: Math.max(1000, call.deadline - Date.now() - 4000),
          })
          .catch(() => false)
      : false;
    await touch("touchStart", p0, call);
    // From here walkPath moves the thumb (leans, turns, lifts) in the page. The harness used to
    // slide it toward the first leg through the browser too; on a busy machine that slide could
    // land after walkPath's first turn and undo it, walking on the old way until a wall.
    const seesTouch = following && (await frame.evaluate(() => (globalThis as typeof globalThis & { __qaStickPointer?: number }).__qaStickPointer !== undefined).catch(() => false));
    if (!seesTouch) {
      const { dx, dy } = DIRS[runs[0]!.direction];
      for (const f of [0.3, 0.6, 1]) {
        await sleep(16);
        await touch("touchMove", { x: p0.x + dx * f * lean, y: p0.y + dy * f * lean }, call);
      }
    }
    let result: PathResult | null = null;
    if (following) {
      // walkPath stops itself by the deadline; this is for a page that stopped answering.
      const walking = frame.evaluate(() => (globalThis as typeof globalThis & { __qaWalk?: Promise<PathResult> }).__qaWalk ?? null);
      result = await within(walking, Math.max(2000, call.deadline - Date.now()), "The walk").catch(() => null);
      if (!result) await within(frame.evaluate(stopWalk), 2000, "Stopping the walk").catch(() => {});
    } else {
      // No decoded state to follow (shouldn't happen with the joystick up): hold for the steps.
      await sleep(Math.min((total - 0.5) * ((stepFrames * 1000) / emuFps), call.deadline - Date.now()));
    }
    // walkPath already lifted the thumb in the page; this ends the touch itself.
    await touch("touchEnd", undefined, call);
    const stop: Stop | null = result && result.end !== "done" ? result.end : null;
    const stoppedGoing: Direction = runs[Math.min(result?.leg ?? 0, runs.length - 1)]!.direction;
    const seen: (StateLite | null)[] = [from, ...(result?.trail ?? [])];
    const settled = await settle(150, READY_MAX_MS, from?.mapId, call.deadline);
    const after = settled.read;
    const o = await outcome(before, after);
    const to = after.state;
    seen.push(to);
    // What the game did after the walk (a battle, text, a warp) says more than how the walk ended.
    const why = from && to ? (interruption(from, to) ?? stop) : stop;
    const blocker = why === "blocked" && rom && to ? blockerAt(rom.world, rom.stitched, to, DIRS[stoppedGoing]) : null;
    const walked = countSteps(seen);
    // Each run says how far it went and what stopped it; its steps count as asked for.
    const runNotes = (result?.ran ?? []).map((r) => {
      const dir = runs[r.leg]!.direction;
      total += r.steps;
      const what = rom && to ? blockerAt(rom.world, rom.stitched, { ...to, player: { ...to.player, x: r.x, y: r.y } }, DIRS[dir]) : null;
      return `You ran ${r.steps} step${r.steps === 1 ? "" : "s"} ${dir}${what ? ` until ${what} was in the way` : ", until something stopped you"}.`;
    });
    // A run that ended the walk ended it as asked.
    const lastRun = result?.ran?.at(-1);
    if (lastRun && result?.end === "done" && lastRun.leg === runs.length - 1) total = walked;
    const note = from ? [...runNotes, walkNote({ asked: total, walked, stop: why, direction: stoppedGoing, blocker })].filter(Boolean).join("\n") : "";
    const debug = process.env["POKEHD_QA_DEBUG"] && from && to ? ` [debug: (${from.player.x},${from.player.y}) → (${to.player.x},${to.player.y}), ${walked} counted, stop ${why}]` : "";
    const log = await (await gameFrame()).evaluate(() => (window as unknown as { __qaLayouts?: LayoutEntry[] }).__qaLayouts ?? []).catch(() => []);
    const screen = describeLayouts(log, layoutsFrom, Date.now());
    // After the text map, before the buttons: where the player is from where they came into the map.
    const where = to && to.mode === "overworld" ? entry.line(to) : "";
    const at = o.text.indexOf("\nButtons:");
    const text = where && at >= 0 ? `${o.text.slice(0, at)}\n${where}${o.text.slice(at)}` : where ? `${o.text}\n${where}` : o.text;
    const said = describeMessages(await newMessages(), messageText(after));
    return { text: [...waitNotes(waitedBefore, waited(settled)), note || debug ? `${note}${debug}` : "", said, text, screen ?? ""].filter(Boolean).join("\n") };
  }

  const driver: GameDriver = {
    size: GAME_SIZE,

    async start() {
      mkdirSync(profileDir, { recursive: true });
      mkdirSync(opts.runDir, { recursive: true });
      context = await chromium.launchPersistentContext(profileDir, {
        // Playwright's own Chromium when it's installed, else the machine's Google Chrome.
        ...(!existsSync(chromium.executablePath()) && { channel: "chrome" }),
        headless: opts.headless ?? true,
        ...(direct
          ? { viewport: GAME_SIZE }
          : (opts.headless ?? true)
            ? { viewport: STREAM_VIEWPORT, deviceScaleFactor: STREAM_SCALE }
            : { viewport: null }),
        hasTouch: true,
        isMobile: false,
        // The stream must keep playing whatever else the browser shows.
        args: [
          ...(!direct && !(opts.headless ?? true) ? [`--window-size=${STREAM_WINDOW.width},${STREAM_WINDOW.height}`] : []),
          "--disable-background-timer-throttling",
          "--disable-renderer-backgrounding",
          "--disable-backgrounding-occluded-windows",
          // The stream page broadcasts itself (?broadcast): tab capture without a prompt, sound
          // without a tap, and plain LAN addresses in its WebRTC offers so phones can connect.
          "--auto-accept-this-tab-capture",
          "--autoplay-policy=no-user-gesture-required",
          "--disable-features=WebRtcHideLocalIpsWithMdns",
        ],
      });
      // Signed in as far as the page can tell, without a room (as the e2e checks do).
      await context.route("**/api/me", (r) =>
        r.fulfill({ json: { player: { id: "qa", name: "Claude" }, email: "qa@example.com", admin: false, romAccess: true } }),
      );
      await context.route("**/api/room", (r) => r.abort());
      // Times every switch to and from the Game Boy screen, in the page (see layout-log.ts).
      await context.addInitScript(installLayoutLog);
      await context.route("**/__qa/blank", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>reloading</title>" }));
      page = context.pages()[0] ?? (await context.newPage());
      page.on("pageerror", (e) => {
        logLine(`[pageerror] ${e.message}`);
        watcher.push("page-error", `The page hit an error: ${e.message.split("\n")[0]}`);
      });
      page.on("console", (m) => {
        const text = m.text();
        logLine(`[${m.type()}] ${text}`);
        if (m.type() === "error" && !IGNORED_CONSOLE.some((re) => re.test(text))) {
          watcher.push("console-error", `The page logged an error: ${text.split("\n")[0]!.slice(0, 300)}`);
        }
      });
      page.on("crash", () => watcher.push("crash", "The page crashed."));
      input = await context.newCDPSession(page);
      await recorder.start(page);
      busy++;
      try {
        await page.goto(pageUrl);
        const ready = await waitReady();
        await passContinueScreen(ready);
      } finally {
        busy--;
      }
      startPolling();
      if (!direct && !(opts.headless ?? true)) fitter = setInterval(() => void fitWindow().catch(() => {}), FIT_EVERY_MS);
      const { read: after } = await settle(500);
      await newMessages();
      return outcome(null, after);
    },

    restart,

    onFrame(listener) {
      recorder.listeners.add(listener);
      return () => recorder.listeners.delete(listener);
    },

    markTurn(turn) {
      recorder.markTurn(turn);
    },

    tap(x, y) {
      return act(async (call) => {
        const at = await toPage(x, y);
        await touch("touchStart", at, call);
        await sleep(70);
        await touch("touchEnd", undefined, call);
      });
    },

    swipe(x1, y1, x2, y2, ms) {
      return act(async (call) => {
        const from = await toPage(x1, y1);
        const to = await toPage(x2, y2);
        const steps = Math.max(4, Math.round(ms / 16));
        await touch("touchStart", from, call);
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          await touch("touchMove", { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, call);
          await sleep(ms / steps);
        }
        await sleep(40);
        await touch("touchEnd", undefined, call);
      });
    },

    joystick(moves: Move[]) {
      return bounded((call) => walk(moves, call));
    },

    wait(ms) {
      return act(async (call) => void (await sleep(Math.max(0, Math.min(ms, call.deadline - Date.now())))), 0);
    },
    async screenshot() {
      busy++;
      try {
        const box = await gameBox();
        if (direct) return await need(page).screenshot({ clip: box, type: "png" });
        // The whole window, then cropped elsewhere: a clipped capture (Playwright's, or CDP's with
        // `clip`) emulates a viewport on the clip for a moment, which the headed stream window shows
        // as the game zooming to fill the stream for a few frames (a flicker).
        const { data } = (await need(input).send("Page.captureScreenshot", { format: "png" })) as { data: string };
        const viewportWidth = await need(page).evaluate(() => innerWidth);
        return await cropShot(await sheet(), data, box, viewportWidth);
      } finally {
        busy--;
      }
    },

    contactSheet(turn, before, after, fps) {
      const zero = recorder.turns.get(turn) ?? Date.now();
      return sheetBetween(zero - before * 1000, zero + after * 1000, fps, zero, `Turn ${turn}: ${-before} s to +${after} s at ${fps} fps`);
    },

    takeGlitches(): Glitch[] {
      return watcher.take();
    },

    async status(): Promise<GameStatus> {
      const r = await read();
      const map = r.loading || !r.hooked ? "Loading" : r.inWorld && r.state ? mapName(r.state.mapId) : "Title screen";
      // Not readable mid-reload; the time stays at 0:00 this once.
      return { map, playTime: (await playTime()) ?? "0:00", fps: r.fps };
    },

    async collectEvidence(dir, turn) {
      mkdirSync(dir, { recursive: true });
      const names: string[] = [];
      const write = (name: string, data: string | Buffer) => {
        writeFileSync(join(dir, name), data);
        names.push(name);
      };
      write("screenshot.png", await driver.screenshot());
      const now = Date.now();
      try {
        write("contact.png", await sheetBetween(now - 3000, now + 2000, 4, now, `Turn ${turn}: the last 3 s and the next 2 s`));
      } catch (e) {
        logLine(`[qa] no contact sheet: ${String(e)}`);
      }
      const frame = await gameFrame();
      const pageState = await frame
        .evaluate(() => {
          const h = (window as Window & { __pokehd?: { state: unknown; page: unknown; slow: unknown[]; inWorld: boolean; frames: number } }).__pokehd;
          return h ? JSON.parse(JSON.stringify({ state: h.state, page: h.page, inWorld: h.inWorld, frames: h.frames, slow: h.slow.slice(-50) })) : null;
        })
        .catch(() => null);
      write("state.json", JSON.stringify({ turn, at: new Date().toISOString(), url: frame.url(), emuFps, page: pageState, screen: last, glitches: watcher.history }, null, 2));
      write("console.log", consoleLines.join("\n") + "\n");
      const save = await frame
        .evaluate(
          (key: string | null) =>
            new Promise<number[] | null>((done) => {
              const req = indexedDB.open("pokehd");
              req.onerror = () => done(null);
              req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains("saves")) return done(null);
                const store = db.transaction("saves", "readonly").objectStore("saves");
                const keys = store.getAllKeys();
                keys.onsuccess = () => {
                  const k = keys.result.map(String).find((x) => (key ? x === key : /^[0-9a-f]{40}$/.test(x)));
                  if (!k) return done(null);
                  const get = store.get(k);
                  get.onsuccess = () => done(get.result ? Array.from(new Uint8Array(get.result as ArrayBuffer)) : null);
                  get.onerror = () => done(null);
                };
                keys.onerror = () => done(null);
              };
            }),
          rom?.key ?? null,
        )
        .catch(() => null);
      if (save) write("save.sav", Buffer.from(save));
      return names;
    },

    async close() {
      // Stopping the harness mustn't cost the game any progress: the next run resumes from here.
      if (context && !(await takeResumePoint().catch(() => false))) console.warn("The game didn't take a resume point before closing; the next run may come back a little earlier.");
      if (poller) clearInterval(poller);
      if (fitter) clearInterval(fitter);
      poller = fitter = null;
      await recorder.stop();
      await context?.close().catch(() => {});
      await sheetBrowser?.close().catch(() => {});
      sheetBrowser = null;
      context = page = sheetPage = null;
      input = null;
    },
  };
  return driver;
}

