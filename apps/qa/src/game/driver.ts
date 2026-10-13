// The game driver: the real game in Chromium, played only through touches on the screen, with
// what happened written out from what the screen shows. See types.ts for the contract.
//
// Two ways to open the game: through the stream page (`streamPath`, default /dev/stream), whose
// <iframe id="game"> holds it, or (`streamPath: "game"`) the game page alone at the game's size.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type CDPSession, type ElementHandle, type Frame, type Page } from "@playwright/test";
import { ScreenTextDecoder, TEXT_WATCHES, type TextWatched } from "@pokehd/emu";
import { parseWorld, readGlyphs, stitchOverworld, SYMBOLS, type StitchedWorld, type WorldData } from "@pokehd/rom";
import { GlitchWatcher } from "./glitches.ts";
import { describeButtons, describeGameBoyText, describePanels, mapName } from "./outcome.ts";
import { describeLayouts, installLayoutLog, type LayoutEntry } from "./layout-log.ts";
import { composeSheet, MAX_SHEET_FRAMES, pickFrames, Recorder } from "./recorder.ts";
import { readScreen, type ScreenRead } from "./screen-read.ts";
import { buildTextMap } from "./textmap.ts";
import type { Direction, GameDriver, GameStatus, Glitch, Outcome, RestartOptions } from "./types.ts";

export interface DriverOptions {
  /** The app's origin, e.g. http://localhost:5173. */
  appUrl: string;
  /** The stream page's path (default /dev/stream), or "game" for the game page alone. */
  streamPath?: string;
  /** This run's folder; the browser profile (the game's saves) lives next to it, in ../profile. */
  runDir: string;
  headless?: boolean;
  /** The game page's query in "game" mode (default "stats&qa"); e.g. add "&render=0" where there's no GPU. */
  gameQuery?: string;
  /** The ROM for the text map (default rom/pokeblue.gb in the repo). */
  romPath?: string;
}

const GAME_SIZE = { width: 528, height: 1000 } as const;
/**
 * The stream page's window: 1280×720 so it fits a laptop's screen, at 1.5× so the page (which
 * scales its 1920×1080 stage to fit) still renders, records and broadcasts at 1920×1080.
 */
const STREAM_VIEWPORT = { width: 1280, height: 720 } as const;
const STREAM_SCALE = 1.5;
const READY_TIMEOUT_MS = 120_000;
const SETTLE_MAX_MS = 4000;
const SETTLE_CALM_MS = 500;
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
  const gameUrl = `${appUrl}/?${opts.gameQuery ?? "stats&qa"}`;
  const pageUrl = direct ? gameUrl : `${appUrl}${opts.streamPath ?? "/dev/stream"}`;
  const profileDir = resolve(opts.runDir, "..", "profile");
  const rom = loadRom(opts.romPath ?? DEFAULT_ROM);
  const watcher = new GlitchWatcher();
  const recorder = new Recorder();
  const consoleLines: string[] = [];

  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let input: CDPSession | null = null;
  let sheetPage: Page | null = null;
  let poller: ReturnType<typeof setInterval> | null = null;
  let polling = false;
  let busy = 0;
  let slowSince = 0;
  let last: ScreenRead | null = null;
  /** The emulator's measured speed (frames per second), which times the joystick's steps. */
  let emuFps = 59.7;

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
  async function settle(minMs = 250, maxMs = SETTLE_MAX_MS): Promise<ScreenRead> {
    const start = Date.now();
    await sleep(minMs);
    let sig = "";
    let since = Date.now();
    for (;;) {
      const r = await read();
      const s = signature(r);
      if (s !== sig) {
        sig = s;
        since = Date.now();
      }
      const calm = r.hooked && !r.loading && (!r.state || (!r.state.player.step && r.state.fade === 0));
      const quiet = Date.now() - since >= (r.printing ? SETTLE_CALM_MS * 2 : SETTLE_CALM_MS);
      if ((calm && quiet) || Date.now() - start > maxMs) return r;
      await sleep(100);
    }
  }

  /** Text boxes decoded from the Game Boy screen, for screens the page draws none of its own for. */
  async function gameBoyText(): Promise<string> {
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
    return describeGameBoyText(rom.decoder.decode(watched).boxes);
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
      const gameBoyUp = after.layout === "full" || after.layout === "dialog" || (s && s.mode !== "overworld");
      if (!textual.length && gameBoyUp) {
        const text = await gameBoyText().catch(() => "");
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

  /** Taps through a start screen that only offers to carry on; anything else is left to the player. */
  async function passContinueScreen(r: ScreenRead): Promise<void> {
    if (!r.panels.some((p) => p.kind === "start")) return;
    const choices = r.buttons.filter((b) => !b.pad && b.label !== "Menu");
    if (choices.length !== 1 || !/continue|resume|carry on|keep playing/i.test(choices[0]!.label)) return;
    const c = choices[0]!;
    const at = await toPage(c.x + c.w / 2, c.y + c.h / 2);
    await touch("touchStart", at);
    await sleep(60);
    await touch("touchEnd");
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

  async function restart(o: RestartOptions = {}): Promise<Outcome> {
    const from = o.from ?? "now";
    busy++;
    const notes: string[] = [];
    try {
      const frame = await gameFrame();
      const url = frame.url() && !frame.url().startsWith("about:") ? frame.url() : gameUrl;
      if (from === "now") {
        // As when the player switches app: the game takes a fresh resume point.
        const r = await read().catch(() => null);
        if (r?.inWorld) {
          const before = await resumePointTime(frame);
          await frame.evaluate(() => {
            Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
            document.dispatchEvent(new Event("visibilitychange"));
          });
          const start = Date.now();
          while ((await resumePointTime(frame)) <= before && Date.now() - start < 10_000) await sleep(200);
          if ((await resumePointTime(frame)) <= before) notes.push("(The game didn't take a fresh resume point, so it may come back a little earlier.)");
        }
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
      await passContinueScreen(ready);
    } finally {
      busy--;
    }
    const after = await settle(500);
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
    sheetPage ??= await need(context).newPage();
    return composeSheet(sheetPage, {
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
        viewport: direct ? GAME_SIZE : STREAM_VIEWPORT,
        ...(!direct && { deviceScaleFactor: STREAM_SCALE }),
        hasTouch: true,
        isMobile: false,
        // The stream must keep playing whatever else the browser shows.
        args: [
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

    async joystick(direction: Direction, tiles: number) {
      const steps = Math.max(1, Math.min(20, Math.round(tiles)));
      const before = await read();
      const stick = before.joystick;
      if (!stick) {
        const o = await outcome(before, before);
        return { text: `The joystick isn't on screen right now.\n${o.text}` };
      }
      const centre = { x: stick.x + stick.w / 2, y: stick.y + stick.h / 2 };
      const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction];
      const p0 = await toPage(centre.x, centre.y);
      await touch("touchStart", p0);
      for (const f of [0.3, 0.6, 1]) {
        await sleep(16);
        await touch("touchMove", { x: p0.x + dx! * 55 * f, y: p0.y + dy! * 55 * f });
      }
      // Hold until the player is on their last step (the game reads the pad only between steps, so
      // letting go mid-step finishes that step and no more), something else happens, or they stop.
      // Reads can lag behind a busy page, so the clock lets go too: a step is 16 emulated frames
      // (8 on the bike), timed from when the player first moves.
      const start = Date.now();
      const from = before.state;
      const stepFrames = from?.player && (from.player as { transport?: string }).transport === "bike" ? 8 : 16;
      let pos = from ? `${from.player.x},${from.player.y}` : "";
      let moved = 0;
      let lastMove = start;
      let firstMove: number | null = null;
      let prevFrames = before.frames;
      let prevAt = start;
      for (;;) {
        await sleep(15);
        const r = await read();
        const s = r.state;
        const now = Date.now();
        if (r.frames > prevFrames && now > prevAt) {
          const fps = ((r.frames - prevFrames) * 1000) / (now - prevAt);
          emuFps = emuFps * 0.7 + Math.min(70, Math.max(10, fps)) * 0.3;
        }
        prevFrames = r.frames;
        prevAt = now;
        const stepMs = (stepFrames * 1000) / emuFps;
        if (s) {
          const p = `${s.player.x},${s.player.y}`;
          if (p !== pos) {
            pos = p;
            moved++;
            lastMove = now;
          }
          if (s.player.step) lastMove = now;
          if ((s.player.step || moved) && firstMove === null) firstMove = now - (s.player.step ? ((s.player.step as { progress?: number }).progress ?? 0) * stepMs : 0);
          if (s.mapId !== from?.mapId || s.mode !== "overworld") break;
          if (s.player.step && moved >= steps - 1) break;
        }
        if (moved >= steps) break;
        if (firstMove !== null && now - firstMove > (steps - 0.5) * stepMs) break;
        if (now - lastMove > Math.max(900, stepMs * 3)) break; // blocked (or only turned)
      }
      await touch("touchEnd");
      const after = await settle(150);
      const o = await outcome(before, after);
      const to = after.state;
      const walked = from && to && to.mapId === from.mapId ? Math.abs(to.player.x - from.player.x) + Math.abs(to.player.y - from.player.y) : null;
      const note = walked === 0 ? "You didn't move." : walked !== null && walked < steps ? `You moved ${walked} of ${steps} steps.` : "";
      const debug = process.env["POKEHD_QA_DEBUG"] && from && to ? ` [debug: (${from.player.x},${from.player.y}) → (${to.player.x},${to.player.y}), ${moved} counted, ${Date.now() - start} ms]` : "";
      return { text: note || debug ? `${note}${debug}\n${o.text}` : o.text };
    },

    wait(ms) {
      return act(async () => void (await sleep(Math.max(0, ms))), 0);
    },

    async screenshot() {
      busy++;
      try {
        const box = await gameBox();
        return await need(page).screenshot({ clip: box, type: "png" });
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
      let playTime = "0:00";
      try {
        const frame = await gameFrame();
        const bytes = await frame.evaluate(
          ([a, n]) => (window as Window & { __pokehd?: { read(a: number, n: number): Promise<number[]> } }).__pokehd?.read(a, n) ?? null,
          [SYMBOLS.wPlayTimeHours.address, SYMBOLS.wPlayTimeMinutes.address - SYMBOLS.wPlayTimeHours.address + 1] as const,
        );
        if (bytes) playTime = `${bytes[0]}:${String(bytes.at(-1)).padStart(2, "0")}`;
      } catch {
        // Not readable mid-reload; the time stays at 0:00 this once.
      }
      return { map, playTime, fps: r.fps };
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
      if (poller) clearInterval(poller);
      poller = null;
      await recorder.stop();
      await context?.close().catch(() => {});
      context = page = sheetPage = null;
      input = null;
    },
  };
  return driver;
}

