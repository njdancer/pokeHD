// Dev-only: the live world playing back a recorded (for now, scripted) state stream, Pallet Town
// → Route 1 → Viridian City → its Pokémon Center, at the Game Boy's frame rate (p1-state-render).
// Open /dev/live. URL options: ?size=1440 pins the drawing buffer to 2560×1440 for perf checks;
// ?lookdev mounts the look panel.
import { useEffect, useRef, useState } from "react";
import { createEngine, type Engine } from "@pokehd/engine";
import { createLiveWorld, GB_FRAME_SECONDS, palletToViridian, type LiveWorld } from "@pokehd/engine/world";
import { parseWorld } from "@pokehd/rom";
import { fetchDevRom } from "../dev-rom.ts";
import { loadStoredRom } from "../rom-store.ts";

const query = new URLSearchParams(location.search);

interface Stats {
  frame: number;
  frames: number;
  fps: number;
  worstMs: number;
  cpuMs: number;
  chunks: string;
  backend: string;
}

export function LivePlayback() {
  const holder = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A fresh canvas per mount: StrictMode's mount, unmount, remount must not share a GPU context.
    let disposed = false;
    let engine: Engine | null = null;
    let live: LiveWorld | null = null;
    let raf = 0;
    const canvas = document.createElement("canvas");
    canvas.className = "scene";
    holder.current!.prepend(canvas);
    (async () => {
      const rom = (await fetchDevRom()) ?? (await loadStoredRom());
      if (!rom) return setError("No ROM: load one in the app first.");
      const world = parseWorld(rom);
      const stream = palletToViridian(world);
      live = createLiveWorld(world);
      engine = await createEngine(canvas, { world: live });
      if (disposed) return engine.dispose();
      live.setLook(engine.look);
      if (query.get("size") === "1440") engine.setFixedSize({ width: 2560, height: 1440 });

      // Push one state per Game Boy frame, looping; measure display frame times alongside.
      let start = performance.now() / 1000;
      let pushed = -1;
      let lastT = performance.now();
      let shown = 0;
      const times: number[] = [];
      const tick = () => {
        raf = requestAnimationFrame(tick);
        const now = performance.now();
        times.push(now - lastT);
        lastT = now;
        if (times.length > 240) times.shift();
        const due = Math.floor((now / 1000 - start) / GB_FRAME_SECONDS);
        if (due >= stream.length) {
          start = now / 1000;
          pushed = -1;
          return;
        }
        while (pushed < due) {
          pushed++;
          live!.push(stream[pushed]!, start + pushed * GB_FRAME_SECONDS);
        }
        if (now - shown > 250) {
          shown = now;
          const avg = times.reduce((a, b) => a + b, 0) / times.length;
          setStats({
            frame: pushed,
            frames: stream.length,
            fps: 1000 / avg,
            worstMs: Math.max(...times),
            cpuMs: engine!.stats.cpuMs,
            chunks: [...live!.chunks].map(([id, s]) => `${id}${s === "built" ? "" : "…"}`).join(" "),
            backend: engine!.backend,
          });
        }
      };
      tick();
    })().catch((e: unknown) => setError(String(e)));
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      engine?.dispose();
      live?.dispose();
      canvas.remove();
    };
  }, []);

  return (
    <div className="live-page" ref={holder}>
      <div className="hud">
        {error ?? (stats
          ? `${stats.backend} · frame ${stats.frame}/${stats.frames} · ${stats.fps.toFixed(0)} fps · worst ${stats.worstMs.toFixed(1)} ms · cpu ${stats.cpuMs.toFixed(1)} ms · maps ${stats.chunks}`
          : "Building…")}
      </div>
    </div>
  );
}
