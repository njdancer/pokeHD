// Dev page: the render cost of each stage of the look, measured on whatever device opens it
// (/dev/bench). It stands in one map with time frozen, then renders the shipped look with one
// stage switched off at a time. A stage's cost is the shipped frame time minus the frame time
// without it. Frames are rendered back to back and timed until the GPU has finished them, so
// vsync doesn't hide anything.
// URL options: ?size=phone pins the drawing buffer to an iPhone's (780×1688, portrait at the
// 2× pixel-ratio cap) and ?size=WxH to any size; by default it's this screen's. ?map=VIRIDIAN_CITY
// stands elsewhere. ?only=shipped,no-ao runs just those rows. Results land in window.__bench.
import { useEffect, useRef, useState } from "react";
import { BUILT_IN_PRESETS, createEngine, type BenchResult, type Engine } from "@pokehd/engine";
import { createLiveWorld, standingState, type LiveWorld } from "@pokehd/engine/world";
import { MAP_NAMES, parseWorld } from "@pokehd/rom";
import { fetchDevRom } from "../dev-rom.ts";
import { loadStoredRom } from "../rom-store.ts";

const query = new URLSearchParams(location.search);
const PHONE = { width: 780, height: 1688 };

/** One row: a patch over the shipped look, and an optional render-size scale. */
interface Variant {
  id: string;
  label: string;
  patch?: object;
  scale?: number;
}

const ALL_POST_OFF = {
  ao: { enabled: false },
  dof: { enabled: false },
  tiltShift: { enabled: false },
  bloom: { enabled: false },
  vignette: { enabled: false },
  render: { antialias: "none" },
};

const MOBILE = { ao: { resolution: 0.25 }, render: { antialias: "fxaa" } };

const VARIANTS: Variant[] = [
  { id: "shipped", label: "Shipped look" },
  { id: "no-smaa", label: "− SMAA (no AA)", patch: { render: { antialias: "none" } } },
  { id: "fxaa", label: "SMAA → FXAA", patch: { render: { antialias: "fxaa" } } },
  { id: "no-bloom", label: "− bloom", patch: { bloom: { enabled: false } } },
  { id: "no-tilt", label: "− tilt-shift blur", patch: { tiltShift: { enabled: false } } },
  { id: "no-dof", label: "− depth of field", patch: { dof: { enabled: false } } },
  { id: "no-ao", label: "− ambient occlusion", patch: { ao: { enabled: false } } },
  { id: "ao-quarter", label: "AO at ¼ res", patch: { ao: { resolution: 0.25 } } },
  { id: "no-vignette", label: "− vignette", patch: { vignette: { enabled: false } } },
  { id: "no-fog", label: "− fog", patch: { fog: { enabled: false } } },
  { id: "no-shadows", label: "− sun shadows", patch: { shadows: { enabled: false } } },
  { id: "shadow-1024", label: "Shadow map 2048 → 1024", patch: { shadows: { mapSize: 1024 } } },
  { id: "shadow-hard", label: "Shadow softness → 1", patch: { shadows: { softness: 1 } } },
  { id: "no-sprite-shadows", label: "− sprite shadows", patch: { shadows: { spriteShadows: false } } },
  { id: "scale-75", label: "Render at 75% size", scale: 0.75 },
  { id: "scale-50", label: "Render at 50% size", scale: 0.5 },
  // The mobile tier (QUALITY_PATCHES.mobile), then with dynamic resolution's lower rungs.
  { id: "mobile", label: "Mobile tier", patch: MOBILE },
  { id: "mobile-75", label: "Mobile tier at 75%", patch: MOBILE, scale: 0.75 },
  { id: "mobile-50", label: "Mobile tier at 50%", patch: MOBILE, scale: 0.5 },
  { id: "mobile-50-no-dof", label: "Mobile tier at 50% − depth of field", patch: { ...MOBILE, dof: { enabled: false } }, scale: 0.5 },
  { id: "scene-only", label: "Scene + shadows, no post", patch: ALL_POST_OFF },
  { id: "bare", label: "Scene only (no post, no shadows)", patch: { ...ALL_POST_OFF, shadows: { enabled: false } } },
];

const only = query.get("only")?.split(",");
const variants = only ? VARIANTS.filter((v) => only.includes(v.id)) : VARIANTS;

interface Row extends BenchResult {
  id: string;
  label: string;
  width: number;
  height: number;
}

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (--n <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

function merge(base: object, patch: object): object {
  const out: Record<string, unknown> = structuredClone(base) as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) out[k] = { ...(out[k] as object), ...(v as object) };
  return out;
}

export function Bench() {
  const holder = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
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
      live = createLiveWorld(world);
      engine = await createEngine(canvas, { world: live, quality: "full", dynamicResolution: false });
      if (disposed) return engine.dispose();
      live.setLook(engine.look);

      const size = query.get("size");
      const base = size === "phone"
        ? PHONE
        : size?.includes("x")
          ? { width: Number(size.split("x")[0]), height: Number(size.split("x")[1]) }
          : { width: Math.round(canvas.clientWidth * Math.min(devicePixelRatio, 2)), height: Math.round(canvas.clientHeight * Math.min(devicePixelRatio, 2)) };

      // Stand still and let every nearby map build.
      const state = standingState(world, map);
      setStatus("Building the map…");
      for (let i = 0; i < 600 && !disposed; i++) {
        live.push(state, performance.now() / 1000);
        await frames(1);
        if (i > 30 && [...live.chunks.values()].every((s) => s === "built")) break;
      }

      // Midday of the shipped cycle, frozen.
      const shipped = merge(BUILT_IN_PRESETS["Diorama"]!, { time: { phase: 0.5, drift: false, animate: false } });
      const out: Row[] = [];
      for (const v of variants) {
        if (disposed) return;
        setStatus(`Measuring: ${v.label}`);
        engine.look.set(merge(shipped, v.patch ?? {}));
        const scale = v.scale ?? 1;
        const width = Math.round(base.width * scale);
        const height = Math.round(base.height * scale);
        engine.setFixedSize({ width, height });
        await frames(30); // compile pipelines, settle
        await engine.benchmark(5);
        const runs: BenchResult[] = [];
        for (let i = 0; i < 5; i++) {
          runs.push(await engine.benchmark(20));
          await frames(2);
        }
        const frameMs = median(runs.map((r) => r.frameMs));
        const row: Row = { ...runs.at(-1)!, frameMs, cpuMs: median(runs.map((r) => r.cpuMs)), id: v.id, label: v.label, width, height };
        out.push(row);
        setRows([...out]);
      }
      const backend = engine.backend;
      (window as { __bench?: unknown }).__bench = { backend, ua: navigator.userAgent, rows: out };
      setStatus(`Done · ${backend} · ${base.width}×${base.height}`);
    })().catch((e: unknown) => setStatus(String(e)));
    return () => {
      disposed = true;
      engine?.dispose();
      live?.dispose();
      canvas.remove();
    };
  }, []);

  const shipped = rows.find((r) => r.id === "shipped");
  const copy = () => {
    const text = JSON.stringify((window as { __bench?: unknown }).__bench ?? rows);
    void navigator.clipboard?.writeText(text);
  };

  return (
    <div className="live-page bench" ref={holder}>
      <div className="bench-panel">
        <p>{status} {status.startsWith("Done") && <button onClick={copy}>Copy</button>}</p>
        <table>
          <thead><tr><th>Variant</th><th>ms</th><th>Δ</th><th>fps</th><th>cpu</th><th>passes</th><th>draws</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.label}</td>
                <td>{r.frameMs.toFixed(2)}</td>
                <td>{shipped && r !== shipped ? (r.frameMs - shipped.frameMs).toFixed(2) : ""}</td>
                <td>{(1000 / r.frameMs).toFixed(0)}</td>
                <td>{r.cpuMs.toFixed(2)}</td>
                <td>{r.passes}</td>
                <td>{r.drawCalls}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
