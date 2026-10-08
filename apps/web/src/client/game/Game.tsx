// The game page: the player's ROM running in the emulator, its overworld state decoded every
// frame and rendered as the live HD world, with the Game Boy's own screen beside it for text,
// menus and battles (p1-play). URL option: ?stats shows frame rate and decoded state.
import { useEffect, useMemo, useRef, useState } from "react";
import { EmulatorHost, OVERWORLD_WATCHES, saveSummary, type SaveSummary, OverworldDecoder, SCREEN_HEIGHT, SCREEN_WIDTH, type OverworldState, type OverworldWatched } from "@pokehd/emu";
import { createEngine, type Engine } from "@pokehd/engine";
import { createLiveWorld, type LiveWorld } from "@pokehd/engine/world";
import { parseWorld, type RomHeader } from "@pokehd/rom";
import { JoypadInput, KeyBindingsPanel, TouchPad, useTouchDevice } from "../input/index.ts";
import { SaveControls } from "../saves/SaveControls.tsx";
import { cloudBackup } from "../saves/cloud-save.ts";
import { loadSave, openSaveSlot, storeSave } from "../saves/save-store.ts";
import { EarlierSaves } from "../saves/EarlierSaves.tsx";
import { keepSave } from "../saves/history.ts";
import { giftStorage } from "../saves/gift-store.ts";
import {
  deleteResumePoint,
  fetchCloudResumePoint,
  loadAutosave,
  pickResumePoint,
  readResumePoint,
  saveAutosave,
  storeResumePoint,
  uploadResumePoint,
} from "../saves/resume-store.ts";
import { me } from "../room/account.ts";
import { Friends } from "../room/Friends.tsx";
import { RoomClient, type Friend, type RoomStatus } from "../room/client.ts";
import { RoomLink } from "../room/link.ts";
import { LinkPicker } from "../room/LinkPicker.tsx";
import { GiftCourier } from "../room/gifts.ts";
import { GiftNotices, GiftPanel } from "../room/GiftPanel.tsx";
import { GIFTABLE_RANGES } from "../room/giftables.ts";
import { toGhosts, toPresence } from "./presence.ts";
import { inWorldTracker, screenLayout, type ScreenLayout } from "./screen.ts";
import { EraseConfirm, GrownUps, SavedToast } from "./KidProof.tsx";
import "./game.css";

const showStats = new URLSearchParams(location.search).has("stats");

declare global {
  interface Window {
    /** Set with ?stats, for scripted play-throughs. */
    __pokehd?: { readonly state: OverworldState | null; readonly inWorld: boolean; readonly slow: SlowFrame[] };
  }
}
/** A display frame over 50 ms, with what the page was doing (for ?stats perf checks). */
interface SlowFrame {
  at: number;
  ms: number;
  updateMs: number;
  renderMs: number;
  /** A chunk build that started during the frame. */
  build: string | null;
  map: number | null;
  mode: string | null;
  fade: number | null;
  layout: string;
}

/** How often a resume point is taken while playing (also whenever the page is hidden). */
const RESUME_POINT_MS = 60_000;
/** How long start-up waits for the cloud (a save for an empty device, a resume point). */
const CLOUD_WAIT_MS = 4000;

/** `promise`, or `fallback` once `ms` have passed. */
const within = <T,>(promise: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([promise.catch(() => fallback), new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

const PIP_KEY = "pokehd.screen.pip.v1";
/** Toggles the picture-in-picture screen, unless the player has bound it to a button. */
const PIP_TOGGLE_CODE = "KeyP";

function loadPip(): boolean {
  try {
    return localStorage.getItem(PIP_KEY) !== "off";
  } catch {
    return true;
  }
}
function savePip(on: boolean) {
  try {
    localStorage.setItem(PIP_KEY, on ? "on" : "off");
  } catch {
    // Storage blocked (some private windows): the choice lasts until reload.
  }
}

interface Stats {
  fps: number;
  worstMs: number;
  emuFps: number;
  cpuMs: number;
  /** Dynamic resolution's render scale, and whether depth of field is on. */
  scale: number;
  dof: boolean;
  backend: string;
  state: OverworldState | null;
  inWorld: boolean;
}

interface Props {
  rom: Uint8Array;
  romKey: string;
  header: RomHeader;
  onForget(): void;
}

export function Game({ rom, romKey, header, onForget }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<EmulatorHost>(null);
  const [pip, setPip] = useState(loadPip);
  const pipRef = useRef(pip);
  const [layout, setLayout] = useState<ScreenLayout>("full");
  const [input, setInput] = useState<JoypadInput>();
  const [sound, setSound] = useState(false);
  const [settings, setSettings] = useState(false);
  /** Nick: the friends list shows in Settings. */
  const [admin, setAdmin] = useState(false);
  const [message, setMessage] = useState<string>("Starting…");
  const [stats, setStats] = useState<Stats>();
  const [noHd, setNoHd] = useState(false);
  /** The shared world: how we're connected and how many friends are in it. */
  const [room, setRoom] = useState<{ status: RoomStatus; friends: Friend[] } | null>(null);
  /** The link cable over the room, once the room has said who we are. */
  const [link, setLink] = useState<RoomLink | null>(null);
  /** Gifts to and from friends (D20), once the room is set up. */
  const [gifts, setGifts] = useState<GiftCourier | null>(null);
  const [giftOpen, setGiftOpen] = useState(false);
  /** Another device backed up a newer save than this browser's; restoring it is in Settings. */
  const [cloudNewer, setCloudNewer] = useState(false);
  const [autosave, setAutosave] = useState(loadAutosave);
  /** Started from the resume point: offer the save file instead, for a while. */
  const [resumed, setResumed] = useState(false);
  /** The game is asking whether to erase the older save (NEW GAME): the save it would replace. */
  const [erasing, setErasing] = useState<{ old: SaveSummary | null } | null>(null);
  /** When the last autosave landed, for the "Saved" toast. */
  const [savedAt, setSavedAt] = useState(0);
  const touch = useTouchDevice();
  // Bumped by a .sav import: restarts the emulator on the imported save.
  const [boot, setBoot] = useState(0);
  // The latest mode and map flag, so the layout can be recomputed when the player toggles pip.
  const sceneRef = useRef<{ mode: OverworldState["mode"]; inWorld: boolean }>({ mode: "overworld", inWorld: false });

  const enableSound = async () => {
    await hostRef.current?.enableAudio();
    setSound(hostRef.current?.audioEnabled ?? false);
  };

  const togglePip = () => {
    pipRef.current = !pipRef.current;
    savePip(pipRef.current);
    setPip(pipRef.current);
    const { mode, inWorld } = sceneRef.current;
    setLayout(screenLayout(mode, inWorld, pipRef.current));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Bound keys and rebinding prompts call preventDefault first (JoypadInput listens earlier).
      if (e.code !== PIP_TOGGLE_CODE || e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      togglePip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let disposed = false;
    let engine: Engine | null = null;
    let live: LiveWorld | null = null;
    let host: EmulatorHost | null = null;
    let roomClient: RoomClient | null = null;
    let unsubscribeRoom = () => {};
    let roomLink: RoomLink | null = null;
    let courier: GiftCourier | null = null;
    let raf = 0;
    let stopResumePoints = () => {};
    /** Takes a resume point once a save has finished, so the newest point always holds it. */
    let pointAfterSave = () => {};
    const joypad = new JoypadInput({
      onChange: (mask, source) => {
        hostRef.current?.setButtons(mask);
        // Keyboard and touch changes come from user gestures, which may start audio; gamepad polls don't.
        if (mask && source !== "gamepad") void enableSound();
      },
    });
    setInput(joypad);
    // A fresh canvas per mount: StrictMode's mount, unmount, remount must not share a GPU context.
    const canvas = document.createElement("canvas");
    canvas.className = "scene";
    holder.current!.prepend(canvas);

    (async () => {
      const world = parseWorld(rom);
      live = createLiveWorld(world);
      // Asks the browser not to clear the save under storage pressure (Safari's eviction).
      void navigator.storage?.persist?.().catch(() => false);
      // A device with no save (a new phone, or storage the browser cleared) gets the cloud's
      // back before the game starts, for signed-in players.
      let restored = false;
      if (!(await loadSave(romKey).catch(() => null))) {
        const backup = cloudBackup(romKey);
        const status = await within(backup.status(), CLOUD_WAIT_MS, null);
        if (status?.kind === "newer" && !(await loadSave(romKey))) {
          await backup.restore(status.cloud);
          restored = true;
        }
      }
      const slot = await openSaveSlot(romKey);
      // The newest resume point that holds this save: this device's, or one from the cloud.
      const resumePoint = await pickResumePoint(slot.sram, [
        await readResumePoint(romKey).catch(() => null),
        await within(fetchCloudResumePoint(romKey), CLOUD_WAIT_MS, null),
      ]);
      const resume = resumePoint?.state ?? null;
      if (disposed) return;
      if (!restored) void cloudBackup(romKey).status().then((s) => !disposed && setCloudNewer(s.kind === "newer"), () => {});

      // The emulator starts at once; the HD view joins when the renderer is ready.
      const ctx = screenRef.current!.getContext("2d")!;
      const image = ctx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
      const decoder = new OverworldDecoder();
      let trackInWorld = inWorldTracker();
      let latest: OverworldState | null = null;
      let emuFrames = 0;
      host = new EmulatorHost({
        rom,
        sram: slot.sram,
        resume: resume ?? undefined,
        autosave: loadAutosave(),
        onAutosaveSkipped: () => setMessage("Autosave is waiting until you save this new game yourself, so it can't replace the old save."),
        onSram: slot.persist,
        onSaved: (auto) => {
          if (auto) setSavedAt(Date.now());
          pointAfterSave();
        },
        onErasePrompt: () => {
          // Keep the old save before anything can replace it, then ask.
          void loadSave(romKey).then((old) => {
            if (old) void keepSave(romKey, old, "replaced");
            if (!disposed) setErasing({ old: old && saveSummary(old) });
          });
        },
        onEraseAnswered: () => setErasing(null),
        onFrame: ({ pixels, watched }) => {
          image.data.set(new Uint8Array(pixels));
          ctx.putImageData(image, 0, 0);
          emuFrames++;
          const bytes = watched as OverworldWatched;
          const state = decoder.decode(bytes);
          const inWorld = trackInWorld(bytes);
          // Before the first map loads (title, intro) the state is meaningless; the HD view waits.
          if (inWorld) live!.push(state, performance.now() / 1000);
          latest = state;
          roomClient?.sendPresence(toPresence(state, inWorld));
          const scene = sceneRef.current;
          if (scene.mode !== state.mode || scene.inWorld !== inWorld) {
            sceneRef.current = { mode: state.mode, inWorld };
            setLayout(screenLayout(state.mode, inWorld, pipRef.current));
          }
        },
        onError: (text) => setMessage(`Emulator error: ${text}`),
        onGift: (event) => courier?.onGiftEvent(event),
      });
      host.watch(OVERWORLD_WATCHES);
      host.setButtons(joypad.mask);
      hostRef.current = host;
      const started = await host.started;
      if (disposed) return;
      // A point the emulator turned down is stale (the save changed since) or damaged.
      if (resume && !started.resumed) void deleteResumePoint(romKey);
      if (started.resumed) {
        // Before the first frame: the worker says it's ready before it runs one.
        trackInWorld = inWorldTracker(true);
        setResumed(true);
        setTimeout(() => !disposed && setResumed(false), 30_000);
      }

      // Resume points: every minute, and when the page is hidden or closed. Only in the world:
      // resuming to the title screen or intro would gain nothing.
      const h = host;
      // Signed-in players' points go to the cloud too, until the server says they're signed out.
      let upload = true;
      const takeResumePoint = (leaving = false) => {
        if (!sceneRef.current.inWorld) return;
        void h.resumePoint().then(async (state) => {
          if (!state || disposed) return;
          const save = slot.latest;
          await storeResumePoint(romKey, state, save);
          if (upload && save) upload = await uploadResumePoint(romKey, state, save, leaving).catch(() => true);
        });
      };
      const resumeTimer = setInterval(takeResumePoint, RESUME_POINT_MS);
      // A save makes every earlier point stale (it no longer holds the stored save), so take a
      // new one straight after; the delay lets the save routine finish its last writes.
      let saveTimer: ReturnType<typeof setTimeout> | undefined;
      pointAfterSave = () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => takeResumePoint(), 2000);
      };
      const onHidden = () => document.visibilityState === "hidden" && takeResumePoint(true);
      const onPageHide = () => takeResumePoint(true);
      document.addEventListener("visibilitychange", onHidden);
      addEventListener("pagehide", onPageHide);
      stopResumePoints = () => {
        clearInterval(resumeTimer);
        clearTimeout(saveTimer);
        document.removeEventListener("visibilitychange", onHidden);
        removeEventListener("pagehide", onPageHide);
      };

      // Friends, for players signed in by email (D23); everyone else plays alone.
      void me().then(
        (account) => {
          if (disposed) return;
          if (!account) return setRoom({ status: "signed-out", friends: [] });
          setAdmin(account.admin);
          const client = new RoomClient();
          roomClient = client;
          // Before connecting, so the first welcome resends anything still in the outbox.
          if (host) {
            courier = new GiftCourier({ room: client, host, storage: giftStorage(slot) });
            setGifts(courier);
          }
          const show = ({ status, friends }: { status: RoomStatus; friends: Record<string, Friend> }) =>
            setRoom({ status, friends: Object.values(friends) });
          unsubscribeRoom = client.store.subscribe((next, prev) => {
            if (next.friends !== prev.friends) live!.setGhosts(toGhosts(next.friends));
            if (next.status !== prev.status || next.friends !== prev.friends) show(next);
            // The cable needs our player ID, which the first welcome brings.
            if (next.you && !roomLink && host) {
              const h = host;
              roomLink = new RoomLink({ room: client, me: next.you.id, open: (o) => h.openLink(o) });
              setLink(roomLink);
            }
          });
          client.connect();
          show(client.store.getState());
        },
        () => {}, // Offline or no server: play alone.
      );

      if (showStats) {
        // For scripted play-throughs (e2e/play.e2e.ts): the newest decoded state, every frame.
        const slow: SlowFrame[] = [];
        window.__pokehd = {
          get state() {
            return latest;
          },
          get inWorld() {
            return sceneRef.current.inWorld;
          },
          slow,
        };
        // Display frame times, and emulated frames per second, for perf checks.
        const times: number[] = [];
        let lastT = performance.now();
        let shown = lastT;
        let framesAtShown = 0;
        const tick = () => {
          raf = requestAnimationFrame(tick);
          const now = performance.now();
          times.push(now - lastT);
          if (now - lastT > 50 && slow.length < 500) {
            const build = live?.builds.at(-1);
            slow.push({
              at: Math.round(now),
              ms: +(now - lastT).toFixed(1),
              updateMs: +(engine?.stats.updateMs ?? 0).toFixed(1),
              renderMs: +(engine?.stats.renderMs ?? 0).toFixed(1),
              build: build && build.at > lastT ? `${build.map} ${build.ms.toFixed(1)} ms` : null,
              map: latest?.mapId ?? null,
              mode: latest?.mode ?? null,
              fade: latest?.fade ?? null,
              layout: screenRef.current?.dataset["layout"] ?? "",
            });
          }
          lastT = now;
          if (times.length > 240) times.shift();
          if (now - shown < 500) return;
          const avg = times.reduce((a, b) => a + b, 0) / times.length;
          setStats({
            fps: 1000 / avg,
            worstMs: Math.max(...times),
            emuFps: ((emuFrames - framesAtShown) * 1000) / (now - shown),
            cpuMs: engine?.stats.cpuMs ?? 0,
            scale: engine?.stats.scale ?? 1,
            dof: engine?.stats.dof ?? true,
            backend: engine?.backend ?? "no renderer",
            state: latest,
            inWorld: sceneRef.current.inWorld,
          });
          shown = now;
          framesAtShown = emuFrames;
        };
        tick();
      }

      let created: Engine;
      try {
        created = await createEngine(canvas, { world: live });
      } catch (e) {
        // Still playable on the Game Boy screen alone.
        console.error("[pokeHD] renderer failed", e);
        setNoHd(true);
        return setMessage("The HD view couldn't start in this browser, so this is the Game Boy screen alone.");
      }
      if (disposed) return created.dispose();
      engine = created;
      live.setLook(engine.look);
      setMessage(
        started.resumed
          ? "Back where you left off."
          : restored
            ? "Your save came back from the cloud."
            : slot.sram
              ? "Continuing from this browser's save."
              : "No save in this browser yet.",
      );
      setTimeout(() => !disposed && setMessage(""), 4000);
    })().catch((e: unknown) => setMessage(`Couldn't start: ${String(e)}`));

    return () => {
      disposed = true;
      stopResumePoints();
      cancelAnimationFrame(raf);
      joypad.dispose();
      unsubscribeRoom();
      roomLink?.dispose();
      courier?.dispose();
      roomClient?.close();
      host?.dispose();
      hostRef.current = null;
      engine?.dispose();
      live?.dispose();
      canvas.remove();
      delete window.__pokehd;
      sceneRef.current = { mode: "overworld", inWorld: false };
      setLayout("full");
      setNoHd(false);
      setRoom(null);
      setLink(null);
      setGifts(null);
      setGiftOpen(false);
      setSound(false);
      setResumed(false);
      setErasing(null);
    };
  }, [rom, romKey, boot]);

  const onTouch = useMemo(() => (mask: number) => input?.setTouchMask(mask), [input]);
  // Without an emulator (it's restarting) the panel just stays on "Reading your game…".
  const readGiftables = useMemo(() => () => hostRef.current?.read(GIFTABLE_RANGES) ?? new Promise<Uint8Array[]>(() => {}), []);

  // The old emulator could still write its save after the import, so stop it first, then
  // store the imported save again before restarting on it.
  const onImported = (sram: Uint8Array) => {
    hostRef.current?.dispose();
    hostRef.current = null;
    void storeSave(romKey, sram).then(() => setBoot((n) => n + 1));
  };

  // An earlier save, back from the history: it's the save everywhere now.
  const rollBack = (sram: Uint8Array) => {
    cloudBackup(romKey).onSram(sram);
    onImported(sram);
  };

  // Back to the title screen on the save file, dropping the resume point.
  const startFromSave = () => {
    hostRef.current?.dispose();
    hostRef.current = null;
    void deleteResumePoint(romKey).then(() => setBoot((n) => n + 1));
  };

  const answerErase = (erase: boolean) => {
    hostRef.current?.answerErase(erase);
    // The game takes a moment to read the answer; the question goes when it has.
    if (!erase) setErasing(null);
  };

  const forgetRom = () => {
    if (confirm("Forget the game on this device? Your saves stay, but you'll need to load the game file again to play.")) onForget();
  };

  const toggleAutosave = (on: boolean) => {
    setAutosave(on);
    saveAutosave(on);
    hostRef.current?.setAutosave(on);
  };

  const s = stats?.state;
  return (
    <div className={touch ? "game with-touch-pad" : "game"} ref={holder}>
      <canvas
        ref={screenRef}
        className={`gb-screen ${noHd ? "full" : layout}`}
        width={SCREEN_WIDTH}
        height={SCREEN_HEIGHT}
        aria-label="Game Boy screen"
        data-testid="gb-screen"
        data-layout={noHd ? "full" : layout}
      />
      <div className="game-hud">
        <button type="button" onClick={enableSound} disabled={sound}>{sound ? "Sound on" : "Sound"}</button>
        <button type="button" onClick={togglePip} aria-pressed={pip} title="Game Boy screen in the corner (P)">Screen</button>
        <button type="button" onClick={() => setSettings((v) => !v)} aria-expanded={settings}>Settings</button>
        {resumed && <button type="button" onClick={startFromSave}>Load the save file instead</button>}
        {cloudNewer && <button type="button" onClick={() => setSettings(true)}>Newer save in the cloud</button>}
        {room && <RoomBadge status={room.status} friends={room.friends.length} />}
        {gifts && room?.status === "open" && (
          <button type="button" onClick={() => setGiftOpen((v) => !v)} aria-expanded={giftOpen}>Gift</button>
        )}
        {message && <span role="status">{message}</span>}
      </div>
      {settings && (
        <div className="game-settings">
          <section>
            <h2>{header.title}</h2>
            {autosave ? <p>Saves itself every 5 minutes and after battles.</p> : <p>Autosave is off.</p>}
          </section>
          {input && <KeyBindingsPanel input={input} />}
          <GrownUps>
            <div className="row">
              <SaveControls romKey={romKey} header={header} onImported={onImported} />
            </div>
            <div className="row">
              <EarlierSaves romKey={romKey} onRestore={rollBack} />
            </div>
            <div className="row">
              <label>
                <input type="checkbox" checked={autosave} onChange={(e) => toggleAutosave(e.target.checked)} />
                {" "}Autosave every 5 minutes and after battles
              </label>
            </div>
            <div className="row">
              <button type="button" onClick={forgetRom}>Forget ROM</button>
            </div>
            {admin && <Friends />}
          </GrownUps>
        </div>
      )}
      {showStats && stats && (
        <pre
          className="game-stats"
          data-testid="stats"
          data-fps={stats.fps.toFixed(1)}
          data-map={s?.mapId}
          data-x={s?.player.x}
          data-y={s?.player.y}
          data-mode={s?.mode}
          data-in-world={stats.inWorld}
        >
          {`${stats.backend} · ${stats.fps.toFixed(0)} fps · worst ${stats.worstMs.toFixed(1)} ms · cpu ${stats.cpuMs.toFixed(1)} ms · res ${Math.round(stats.scale * 100)}%${stats.dof ? "" : " no DoF"} · emu ${stats.emuFps.toFixed(1)} fps\n`}
          {s ? `map ${s.mapId} (${s.player.x}, ${s.player.y}) ${s.player.facing} · ${s.mode} · fade ${s.fade.toFixed(2)}` : "no state"}
        </pre>
      )}
      {link && room && <LinkPicker link={link} players={room.friends} />}
      {gifts && room && giftOpen && (
        <GiftPanel
          rom={rom}
          courier={gifts}
          friends={room.friends}
          read={readGiftables}
          onClose={() => setGiftOpen(false)}
        />
      )}
      {gifts && <GiftNotices rom={rom} courier={gifts} />}
      {input && touch && <TouchPad onChange={onTouch} />}
      {savedAt > 0 && <SavedToast shownAt={savedAt} />}
      {erasing && <EraseConfirm old={erasing.old} onAnswer={answerErase} />}
    </div>
  );
}

function RoomBadge({ status, friends }: { status: RoomStatus; friends: number }) {
  if (status === "signed-out") return <a className="room-badge" href="/login">Play with friends</a>;
  const text: Record<RoomStatus, string> = {
    connecting: "Connecting…",
    open: friends === 1 ? "1 friend online" : `${friends} friends online`,
    reconnecting: "Reconnecting…",
    "signed-out": "",
    replaced: "Playing in another tab",
    closed: "Offline",
  };
  return <span className="room-badge" data-status={status}>{text[status]}</span>;
}
