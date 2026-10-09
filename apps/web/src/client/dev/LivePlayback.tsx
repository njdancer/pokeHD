// Dev-only: the live world playing back a recorded (for now, scripted) state stream, Pallet Town
// → Route 1 → Viridian City → its Pokémon Center, at the Game Boy's frame rate (p1-state-render).
// Open /dev/live. URL options: ?size=1440 pins the drawing buffer to 2560×1440 for perf checks;
// ?lookdev mounts the look panel. Two friends' ghosts (p3-ghosts) replay the same walk, one behind
// and one ahead; ?ghost=<look> picks how they're drawn (a GHOST_LOOKS key) and ?ghosts=0 hides them.
// ?frame=N plays up to frame N and holds there, for screenshots. ?perf logs every frame slower
// than 25 ms over the first pass, with the CPU split and any chunk build, to window.__perf.
// ?map=CERULEAN_CITY stands still in that map instead (?at=x,y picks the spot, in steps), and
// ?phase=0.5 holds the time of day, for looking at a place's colours (p1-colour); ?sgb=0 turns
// those colours off for comparison.
import { useEffect, useRef, useState } from "react";
import { createEngine, type Engine } from "@pokehd/engine";
import {
  asGhost, createLiveWorld, GB_FRAME_SECONDS, GHOST_LOOKS, palletToViridian, standingState, type GhostLookId, type LiveWorld,
} from "@pokehd/engine/world";
import { MAP_NAMES, parseWorld } from "@pokehd/rom";
import { fetchDevRom } from "../dev-rom.ts";
import { loadStoredRom } from "../rom-store.ts";

const query = new URLSearchParams(location.search);
const perf = query.has("perf");
const holdAt = query.has("frame") ? Number(query.get("frame")) : null;
const ghostLook = GHOST_LOOKS[query.get("ghost") as GhostLookId] ?? undefined;
const standIn = query.has("map") ? MAP_NAMES.indexOf(query.get("map")!.toUpperCase()) : null;
const standAt = query.get("at")?.split(",").map(Number);
const phase = query.has("phase") ? Number(query.get("phase")) : null;
/** Fake friends: the recording offset in time, in Game Boy frames. */
const FRIENDS = query.get("ghosts") === "0" || standIn !== null ? [] : [
  { id: "behind", name: "Gary", offset: -48 },
  { id: "ahead", name: "Leaf", offset: 48 },
];

interface Stats {
  frame: number;
  frames: number;
  fps: number;
  worstMs: number;
  cpuMs: number;
  scale: number;
  drawn: number;
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
      const stream = standIn === null || standIn < 0
        ? palletToViridian(world)
        : Array.from({ length: 60 }, () => standingState(world, standIn, standAt && { x: standAt[0]!, y: standAt[1]! }));
      live = createLiveWorld(world, { ghostLook, sgbColours: query.get("sgb") !== "0" });
      engine = await createEngine(canvas, { world: live });
      if (disposed) return engine.dispose();
      live.setLook(engine.look);
      if (phase !== null) Object.assign(engine.look.params.time, { drift: false, phase });
      if (query.get("size") === "1440") engine.setFixedSize({ width: 2560, height: 1440 });

      // Push one state per Game Boy frame, looping; measure display frame times alongside.
      let start = performance.now() / 1000;
      let pushed = -1;
      let lastT = performance.now();
      let shown = 0;
      const times: number[] = [];
      const slow: { frame: number; gapMs: number; updateMs: number; renderMs: number; build: string | null }[] = [];
      let perfDone = false;
      const tick = () => {
        raf = requestAnimationFrame(tick);
        const now = performance.now();
        times.push(now - lastT);
        lastT = now;
        if (times.length > 240) times.shift();
        if (perf && !perfDone && times.length > 1 && times.at(-1)! > 25) {
          const s = engine!.stats;
          const build = live!.builds.at(-1);
          slow.push({
            frame: pushed, gapMs: +times.at(-1)!.toFixed(1), updateMs: +s.updateMs.toFixed(1), renderMs: +s.renderMs.toFixed(1),
            build: build && now - build.at < times.at(-1)! + 1 ? `${build.map} ${build.ms.toFixed(1)} ms` : null,
          });
        }
        let due = Math.floor((now / 1000 - start) / GB_FRAME_SECONDS);
        if (holdAt !== null) due = Math.min(due, holdAt);
        if (due >= stream.length) {
          if (perf && !perfDone) {
            perfDone = true;
            (window as { __perf?: unknown }).__perf = { backend: engine!.backend, slow, builds: [...live!.builds] };
          }
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
            scale: engine!.stats.scale,
            drawn: engine!.stats.drawn,
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
          ? `${stats.backend} · frame ${stats.frame}/${stats.frames} · ${stats.fps.toFixed(0)} fps · worst ${stats.worstMs.toFixed(1)} ms · cpu ${stats.cpuMs.toFixed(1)} ms · res ${Math.round(stats.scale * 100)}% · drawn ${stats.drawn}/s · maps ${stats.chunks} · ghosts ${stats.ghosts}`
          : "Building…")}
      </div>
    </div>
  );
}
