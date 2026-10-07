// Dev-only: the live world playing back a recorded (for now, scripted) state stream, Pallet Town
// → Route 1 → Viridian City → its Pokémon Center, at the Game Boy's frame rate (p1-state-render).
// Open /dev/live. URL options: ?size=1440 pins the drawing buffer to 2560×1440 for perf checks;
// ?lookdev mounts the look panel. Two friends' ghosts (p3-ghosts) replay the same walk, one behind
// and one ahead; ?ghost=<look> picks how they're drawn (a GHOST_LOOKS key) and ?ghosts=0 hides them.
// ?frame=N plays up to frame N and holds there, for screenshots.
import { useEffect, useRef, useState } from "react";
import { createEngine, type Engine } from "@pokehd/engine";
import {
  asGhost, createLiveWorld, GB_FRAME_SECONDS, GHOST_LOOKS, palletToViridian, type GhostLookId, type LiveWorld,
} from "@pokehd/engine/world";
import { parseWorld } from "@pokehd/rom";
import { fetchDevRom } from "../dev-rom.ts";
import { loadStoredRom } from "../rom-store.ts";

const query = new URLSearchParams(location.search);
const holdAt = query.has("frame") ? Number(query.get("frame")) : null;
const ghostLook = GHOST_LOOKS[query.get("ghost") as GhostLookId] ?? undefined;
/** Fake friends: the recording offset in time, in Game Boy frames. */
const FRIENDS = query.get("ghosts") === "0" ? [] : [
  { id: "behind", name: "Gary", offset: -48 },
  { id: "ahead", name: "Leaf", offset: 48 },
];

interface Stats {
  frame: number;
  frames: number;
  fps: number;
  worstMs: number;
  cpuMs: number;
  chunks: string;
  ghosts: number;
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
      live = createLiveWorld(world, { ghostLook });
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
        let due = Math.floor((now / 1000 - start) / GB_FRAME_SECONDS);
        if (holdAt !== null) due = Math.min(due, holdAt);
        if (due >= stream.length) {
          start = now / 1000;
          pushed = -1;
          return;
        }
        while (pushed < due) {
          pushed++;
          const at = start + pushed * GB_FRAME_SECONDS;
          live!.push(stream[pushed]!, at);
          const ghosts = FRIENDS.flatMap((f) => {
            const state = stream[pushed + f.offset];
            return state ? [asGhost(f.id, f.name, state)] : [];
          });
          live!.setGhosts(ghosts, at);
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
            ghosts: [...live!.ghosts].filter(([, shown]) => shown).length,
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
          ? `${stats.backend} · frame ${stats.frame}/${stats.frames} · ${stats.fps.toFixed(0)} fps · worst ${stats.worstMs.toFixed(1)} ms · cpu ${stats.cpuMs.toFixed(1)} ms · maps ${stats.chunks} · ghosts ${stats.ghosts}`
          : "Building…")}
      </div>
    </div>
  );
}
