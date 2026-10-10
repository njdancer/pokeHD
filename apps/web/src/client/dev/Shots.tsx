// Dev page for the screenshot regression tests (e2e/shots.e2e.ts): one map in the HD view,
// standing still with time frozen, rendered at a fixed size so every run draws the same frame.
// Open /dev/shots. URL options: ?map=VIRIDIAN_CITY (default Pallet Town), ?at=x,y (the player's
// cell; default in front of the map's first door), ?phase=0.5 (time of day, 0 morning to 1
// evening), ?dusk=1 (0 none to 1 full dusk, after the evening), ?quality=mobile (default full),
// ?size=WxH (default 960x540).
// Once every nearby map is built, window.__shots.capture() renders a frame and returns it as a
// PNG data URL.
import { useEffect, useRef, useState } from "react";
import { createEngine, DEFAULT_CYCLE, type Engine, type Quality } from "@pokehd/engine";
import { createLiveWorld, standingState, type LiveWorld } from "@pokehd/engine/world";
import { MAP_NAMES, parseWorld } from "@pokehd/rom";
import { fetchDevRom } from "../dev-rom.ts";
import { loadStoredRom } from "../rom-store.ts";

const query = new URLSearchParams(location.search);

export interface ShotsHook {
  backend: Engine["backend"];
  capture(): Promise<string>;
}

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (--n <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

export function Shots() {
  const holder = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Loading…");

  useEffect(() => {
    let disposed = false;
    let engine: Engine | null = null;
    let live: LiveWorld | null = null;
    const canvas = document.createElement("canvas");
    canvas.className = "scene";
    holder.current!.prepend(canvas);
    (async () => {
      const rom = (await fetchDevRom()) ?? (await loadStoredRom());
      if (!rom) return setStatus("No ROM: load one in the app first.");
      const world = parseWorld(rom);
      const map = MAP_NAMES.indexOf((query.get("map") ?? "PALLET_TOWN").toUpperCase());
      if (map < 0) return setStatus(`No map called ${query.get("map")}`);
      const at = query.get("at")?.split(",").map(Number);
      const quality = (query.get("quality") ?? "full") as Quality;
      const [width, height] = (query.get("size") ?? "960x540").split("x").map(Number);

      live = createLiveWorld(world);
      engine = await createEngine(canvas, { world: live, quality, dynamicResolution: false });
      if (disposed) return engine.dispose();
      live.setLook(engine.look);
      // Freeze time before the first frame, so grass and water hold the same pose every run.
      Object.assign(engine.look.params.time, {
        phase: Number(query.get("phase") ?? 0.5), dusk: Number(query.get("dusk") ?? 0), drift: false, animate: false,
      });
      engine.look.setCycle(DEFAULT_CYCLE);
      engine.setFixedSize({ width: width!, height: height! });

      // Stand still and let every nearby map build, then let the grade's place tint settle.
      const state = standingState(world, map, at && at.length === 2 ? { x: at[0]!, y: at[1]! } : undefined);
      setStatus("Building the map…");
      let built = false;
      for (let i = 0; i < 900 && !disposed; i++) {
        live.push(state, performance.now() / 1000);
        await frames(1);
        built = i > 30 && [...live.chunks.values()].every((s) => s === "built");
        if (built) break;
      }
      if (disposed) return;
      if (!built) return setStatus("The map never finished building.");
      // The tint eases with frame time (capped at 0.1 s a frame): give it 4 s, however fast the GPU.
      const settled = performance.now() + 4000;
      for (let i = 0; (i < 40 || performance.now() < settled) && !disposed; i++) {
        live.push(state, performance.now() / 1000);
        await frames(1);
      }
      if (disposed) return;
      const e = engine;
      const hook: ShotsHook = { backend: e.backend, capture: async () => toDataUrl(await e.capture()) };
      (window as { __shots?: ShotsHook }).__shots = hook;
      setStatus(`Ready · ${e.backend} · ${width}×${height}`);
    })().catch((e: unknown) => setStatus(String(e)));
    return () => {
      disposed = true;
      delete (window as { __shots?: ShotsHook }).__shots;
      engine?.dispose();
      live?.dispose();
      canvas.remove();
    };
  }, []);

  return (
    <div className="live-page" ref={holder}>
      <div className="bench-panel"><p data-testid="shots-status">{status}</p></div>
    </div>
  );
}
