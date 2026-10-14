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
const SETTLE_MAX_MS = 4000;
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
    const r = await frame.evaluate(readScreen, { slowSince });
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

  async function touch(type: "touchStart" | "touchMove" | "touchEnd", at?: { x: number; y: number }) {
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

  /** Waits until the screen stops changing (the player not mid-step, no fade, text done) or the timeout. */
  async function settle(minMs = 250, maxMs = SETTLE_MAX_MS, fromMap?: number): Promise<ScreenRead> {
    const start = Date.now();
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
      // "Off we go…" on the start screen isn't calm: the game is still starting behind it.
      const calm = r.hooked && !r.loading && !startingUp(r) && (!r.state || (!r.state.player.step && r.state.fade === 0));
      // Quiet while the game actually ran: a game starved of CPU looks still between its frames,
      // and would carry on (finish a step, say) after the outcome was read. A menu that holds the
      // game stops its frames on purpose.
      // After a warp (stairs, a ladder, a door) the new map is loaded, placed and faded in over a
      // second or so: give it longer, so the map is read with the player where they landed.
      const warped = fromMap !== undefined && !!r.state && r.state.mapId !== fromMap;
      const ran = r.held || !r.state || r.frames - sinceFrames >= (warped ? SETTLE_WARP_FRAMES : SETTLE_CALM_FRAMES);
      const quiet = ran && Date.now() - since >= (r.printing ? SETTLE_CALM_MS * 2 : SETTLE_CALM_MS);
      if ((calm && quiet) || Date.now() - start > maxMs) return r;
      await sleep(100);
    }
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
      if (panels.length) parts.push(describePanels(panels));
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
    if (!parts.length) parts.push("Nothing to read on screen right now (it may be changing). Wait, or take a screenshot.");
    const buttons = describeButtons(after);
    if (buttons) parts.push(buttons);
    return { text: parts.join("\n") };
  }

  async function act(fn: () => Promise<void>, minMs = 250): Promise<Outcome> {
    const before = last ?? (await read());
    const from = Date.now();
    await fn();
    const after = await settle(minMs);
    const result = await outcome(before, after);
    const log = await (await gameFrame()).evaluate(() => (window as unknown as { __qaLayouts?: LayoutEntry[] }).__qaLayouts ?? []).catch(() => []);
    const screen = describeLayouts(log, from, Date.now());
    return screen ? { text: `${result.text}\n${screen}` } : result;
  }

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
    const after = await settle(500);
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
      const after = await settle(500);
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
      return act(async () => {
        const at = await toPage(x, y);
        await touch("touchStart", at);
        await sleep(70);
        await touch("touchEnd");
      });
    },

    swipe(x1, y1, x2, y2, ms) {
      return act(async () => {
        const from = await toPage(x1, y1);
        const to = await toPage(x2, y2);
        const steps = Math.max(4, Math.round(ms / 16));
        await touch("touchStart", from);
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          await touch("touchMove", { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
          await sleep(ms / steps);
        }
        await sleep(40);
        await touch("touchEnd");
      });
    },

    async joystick(moves: Move[]) {
      // A run leg ("↑*") goes until something stops it, at most 40 steps.
      const runs = moves
        .map((m) => ({ direction: m.direction, steps: m.run ? 40 : Math.max(1, Math.min(20, Math.round(m.tiles))), run: !!m.run }))
        .filter((m) => m.direction in DIRS);
      let total = runs.reduce((n, r) => n + (r.run ? 0 : r.steps), 0);
      const before = await read();
      const stick = before.joystick;
      if (!stick || !runs.length) {
        const o = await outcome(before, before);
        return { text: `${stick ? "No moves given." : "The joystick isn't on screen right now."}\n${o.text}` };
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
            })
            .catch(() => false)
        : false;
      await touch("touchStart", p0);
      // From here walkPath moves the thumb (leans, turns, lifts) in the page. The harness used to
      // slide it toward the first leg through the browser too; on a busy machine that slide could
      // land after walkPath's first turn and undo it, walking on the old way until a wall.
      const seesTouch = following && (await frame.evaluate(() => (globalThis as typeof globalThis & { __qaStickPointer?: number }).__qaStickPointer !== undefined).catch(() => false));
      if (!seesTouch) {
        const { dx, dy } = DIRS[runs[0]!.direction];
        for (const f of [0.3, 0.6, 1]) {
          await sleep(16);
          await touch("touchMove", { x: p0.x + dx * f * lean, y: p0.y + dy * f * lean });
        }
      }
      let result: PathResult | null = null;
      if (following) {
        result = await frame
          .evaluate(() => (globalThis as typeof globalThis & { __qaWalk?: Promise<PathResult> }).__qaWalk ?? null)
          .catch(() => null);
      } else {
        // No decoded state to follow (shouldn't happen with the joystick up): hold for the steps.
        await sleep((total - 0.5) * ((stepFrames * 1000) / emuFps));
      }
      // walkPath already lifted the thumb in the page; this ends the touch itself.
      await touch("touchEnd");
      const stop: Stop | null = result && result.end !== "done" ? result.end : null;
      const stoppedGoing: Direction = runs[Math.min(result?.leg ?? 0, runs.length - 1)]!.direction;
      const seen: (StateLite | null)[] = [from, ...(result?.trail ?? [])];
      const after = await settle(150, SETTLE_MAX_MS, from?.mapId);
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
      return { text: [note || debug ? `${note}${debug}` : "", text, screen ?? ""].filter(Boolean).join("\n") };
    },

    wait(ms) {
      return act(async () => void (await sleep(Math.max(0, ms))), 0);
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

