// The game page: the player's ROM running in the emulator, its overworld state decoded every
// frame and rendered as the live HD world, with the Game Boy's own screen beside it for text,
// menus and battles (p1-play). URL option: ?stats shows frame rate and decoded state.
import { useEffect, useMemo, useRef, useState } from "react";
import { EmulatorHost, OVERWORLD_WATCHES, OverworldDecoder, SCREEN_HEIGHT, SCREEN_WIDTH, type OverworldState, type OverworldWatched } from "@pokehd/emu";
import { createEngine, type Engine } from "@pokehd/engine";
import { createLiveWorld, type LiveWorld } from "@pokehd/engine/world";
import { parseWorld, type RomHeader } from "@pokehd/rom";
import { JoypadInput, KeyBindingsPanel, TouchPad, useTouchDevice } from "../input/index.ts";
import { SaveControls } from "../saves/SaveControls.tsx";
import { cloudBackup } from "../saves/cloud-save.ts";
import { openSaveSlot, storeSave } from "../saves/save-store.ts";
import { me } from "../room/account.ts";
import { RoomClient, type Friend, type RoomStatus } from "../room/client.ts";
import { RoomLink } from "../room/link.ts";
import { LinkPicker } from "../room/LinkPicker.tsx";
import { toGhosts, toPresence } from "./presence.ts";
import { inWorldTracker, screenLayout, type ScreenLayout } from "./screen.ts";
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
  const [message, setMessage] = useState<string>("Starting…");
  const [stats, setStats] = useState<Stats>();
  const [noHd, setNoHd] = useState(false);
  /** The shared world: how we're connected and how many friends are in it. */
  const [room, setRoom] = useState<{ status: RoomStatus; friends: Friend[] } | null>(null);
  /** The link cable over the room, once the room has said who we are. */
  const [link, setLink] = useState<RoomLink | null>(null);
  /** Another device backed up a newer save than this browser's; restoring it is in Settings. */
  const [cloudNewer, setCloudNewer] = useState(false);
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
    let raf = 0;
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
      const slot = await openSaveSlot(romKey);
      if (disposed) return;
      void cloudBackup(romKey).status().then((s) => !disposed && setCloudNewer(s.kind === "newer"), () => {});

      // The emulator starts at once; the HD view joins when the renderer is ready.
      const ctx = screenRef.current!.getContext("2d")!;
      const image = ctx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
      const decoder = new OverworldDecoder();
      const trackInWorld = inWorldTracker();
      let latest: OverworldState | null = null;
      let emuFrames = 0;
      host = new EmulatorHost({
        rom,
        sram: slot.sram,
        onSram: slot.persist,
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
      });
      host.watch(OVERWORLD_WATCHES);
      host.setButtons(joypad.mask);
      hostRef.current = host;

      // Friends, for players signed in with an invite (D19); everyone else plays alone.
      void me().then(
        (player) => {
          if (disposed) return;
          if (!player) return setRoom({ status: "signed-out", friends: [] });
          const client = new RoomClient();
          roomClient = client;
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
      setMessage(slot.sram ? "Continuing from this browser's save." : "No save in this browser yet.");
      setTimeout(() => !disposed && setMessage(""), 4000);
    })().catch((e: unknown) => setMessage(`Couldn't start: ${String(e)}`));

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      joypad.dispose();
      unsubscribeRoom();
      roomLink?.dispose();
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
      setSound(false);
    };
  }, [rom, romKey, boot]);

  const onTouch = useMemo(() => (mask: number) => input?.setTouchMask(mask), [input]);

  // The old emulator could still write its save after the import, so stop it first, then
  // store the imported save again before restarting on it.
  const onImported = (sram: Uint8Array) => {
    hostRef.current?.dispose();
    hostRef.current = null;
    void storeSave(romKey, sram).then(() => setBoot((n) => n + 1));
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
        {cloudNewer && <button type="button" onClick={() => setSettings(true)}>Newer save in the cloud</button>}
        {room && <RoomBadge status={room.status} friends={room.friends.length} />}
        {message && <span role="status">{message}</span>}
      </div>
      {settings && (
        <div className="game-settings">
          <section>
            <h2>{header.title}</h2>
            <div className="row">
              <SaveControls romKey={romKey} header={header} onImported={onImported} />
            </div>
            <div className="row">
              <button type="button" onClick={onForget}>Forget ROM</button>
            </div>
          </section>
          {input && <KeyBindingsPanel input={input} />}
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
          {`${stats.backend} · ${stats.fps.toFixed(0)} fps · worst ${stats.worstMs.toFixed(1)} ms · cpu ${stats.cpuMs.toFixed(1)} ms · emu ${stats.emuFps.toFixed(1)} fps\n`}
          {s ? `map ${s.mapId} (${s.player.x}, ${s.player.y}) ${s.player.facing} · ${s.mode} · fade ${s.fade.toFixed(2)}` : "no state"}
        </pre>
      )}
      {link && room && <LinkPicker link={link} players={room.friends} />}
      {input && touch && <TouchPad onChange={onTouch} />}
    </div>
  );
}

function RoomBadge({ status, friends }: { status: RoomStatus; friends: number }) {
  if (status === "signed-out") return <a className="room-badge" href="/join">Play with friends</a>;
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
