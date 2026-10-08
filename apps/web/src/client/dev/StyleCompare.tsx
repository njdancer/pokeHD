// Dev-only: Pallet Town and Route 1 in the world style (Hybrid, D18), or several styles side by
// side for comparison, each in its own engine with the locked look. Open /dev/styles (deployed: /dev/styles#dev=<token>). Drag to orbit,
// scroll to zoom; every view follows. URL options: ?styles=diorama,voxel,hybrid (or all)&view=low&focus=ROUTE_1&phase=0.5
// &map=VIRIDIAN_FOREST shows that map (and its connections) instead
import { useEffect, useRef, useState } from "react";
import { createEngine, type Engine } from "@pokehd/engine";
import {
  buildRegion,
  createStyledWorld,
  DEFAULT_STYLE,
  DEFAULT_STYLE_PARAMS,
  INTERIOR_LOOKS,
  type InteriorLook,
  regionFocuses,
  STYLES,
  VIEW_PRESETS,
  type Focus,
  type Region,
  type StyledWorld,
  type StyleId,
  type StyleParams,
  type ViewPreset,
} from "@pokehd/engine/world";
import { MAP_NAMES, parseWorld } from "@pokehd/rom";
import { fetchDevRom } from "../dev-rom.ts";
import { loadStoredRom } from "../rom-store.ts";

const ALL = Object.keys(STYLES) as StyleId[];
const query = new URLSearchParams(location.search);
const STYLES_PARAM = query.get("styles");
const STYLE_IDS: StyleId[] =
  STYLES_PARAM === "all" ? ALL : (STYLES_PARAM?.split(",").filter((s): s is StyleId => s in STYLES) ?? [DEFAULT_STYLE]);
const VIEW_PARAM = query.get("view");
const INITIAL_VIEW: ViewPreset = VIEW_PARAM && VIEW_PARAM in VIEW_PRESETS ? (VIEW_PARAM as ViewPreset) : "hd2d";
const INITIAL_PHASE = Number(query.get("phase") ?? 0.5);
const MAP_NAME = query.get("map");
// &interiors=open,dollhouse,walls-down (or all): one Hybrid view per interior look instead.
const INTERIORS_PARAM = query.get("interiors");
const INTERIOR_IDS: InteriorLook[] | null = INTERIORS_PARAM
  ? INTERIORS_PARAM === "all"
    ? (Object.keys(INTERIOR_LOOKS) as InteriorLook[])
    : INTERIORS_PARAM.split(",").filter((s): s is InteriorLook => s in INTERIOR_LOOKS)
  : null;
/** What each view shows: a style, and indoors an interior look. */
const VIEWS: { id: StyleId; interior?: InteriorLook; name: string }[] = INTERIOR_IDS
  ? INTERIOR_IDS.map((interior) => ({ id: "hybrid", interior, name: INTERIOR_LOOKS[interior].name }))
  : STYLE_IDS.map((id) => ({ id, name: STYLES[id].name }));

const SLIDERS: { key: keyof StyleParams; label: string; min: number; max: number; step: number }[] = [
  { key: "wallScale", label: "wall height", min: 0.5, max: 2.5, step: 0.05 },
  { key: "roofPitch", label: "roof pitch", min: 0, max: 1.5, step: 0.05 },
  { key: "eave", label: "eaves", min: 0, max: 0.5, step: 0.02 },
  { key: "treeScale", label: "tree size", min: 0.8, max: 2.5, step: 0.05 },
  { key: "propLean", label: "prop lean °", min: 0, max: 60, step: 1 },
  { key: "propDepth", label: "prop depth", min: 0.05, max: 1, step: 0.05 },
  { key: "ledgeHeight", label: "ledge height", min: 0, max: 0.6, step: 0.02 },
  { key: "voxelRelief", label: "voxel relief", min: 0, max: 0.15, step: 0.005 },
  { key: "grassDensity", label: "grass / tile", min: 0, max: 40, step: 1 },
  { key: "grassHeight", label: "grass height", min: 0.1, max: 0.8, step: 0.02 },
];

interface View {
  id: StyleId;
  interior?: InteriorLook;
  engine: Engine;
  world: StyledWorld;
}

interface Session {
  region: Region;
  focuses: Focus[];
  views: View[];
  params: StyleParams;
  focus: Focus;
}

export function StyleCompare() {
  const holder = useRef<HTMLDivElement>(null);
  const session = useRef<Session | null>(null);
  const [ready, setReady] = useState<{ focuses: Focus[]; backend: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewPreset>(INITIAL_VIEW);
  const [params, setParams] = useState<StyleParams>(DEFAULT_STYLE_PARAMS);
  const [phase, setPhase] = useState(INITIAL_PHASE);
  const [panel, setPanel] = useState(!matchMedia("(max-width: 700px)").matches);

  useEffect(() => {
    // Fresh canvases per mount: StrictMode's mount, unmount, remount must not share GPU contexts.
    let disposed = false;
    const canvases = VIEWS.map(() => document.createElement("canvas"));
    const cells = canvases.map((c, i) => {
      const cell = document.createElement("div");
      cell.className = "styles-cell";
      cell.dataset.name = VIEWS[i]!.name;
      cell.append(c);
      holder.current!.querySelector(".styles-grid")!.append(cell);
      return cell;
    });
    const views: View[] = [];
    (async () => {
      const rom = (await fetchDevRom()) ?? (await loadStoredRom());
      if (!rom) return setError("No ROM: load one in the app first.");
      const map = MAP_NAME ? MAP_NAMES.indexOf(MAP_NAME) : -1;
      const region =
        map >= 0
          ? buildRegion(parseWorld(rom), map, { marginBlocks: 3 })
          : buildRegion(parseWorld(rom), MAP_NAMES.indexOf("PALLET_TOWN"), {
              include: [MAP_NAMES.indexOf("ROUTE_1")],
              marginBlocks: 3,
            });
      const focuses = regionFocuses(region);
      const focus = focuses.find((f) => f.name === query.get("focus")) ?? focuses[0]!;
      const params = structuredClone(DEFAULT_STYLE_PARAMS);
      for (const [i, { id, interior }] of VIEWS.entries()) {
        const world = createStyledWorld(region, id, params, focus, interior);
        const engine = await createEngine(canvases[i]!, { world, lookdev: false, dynamicResolution: false });
        views.push({ id, interior, engine, world });
        if (disposed) break;
      }
      if (disposed) return;
      session.current = { region, focuses, views, params, focus };
      applyCamera(views, VIEW_PRESETS[INITIAL_VIEW]);
      applyPhase(views, INITIAL_PHASE);
      setReady({ focuses, backend: views[0]?.engine.backend ?? "" });
    })().catch((e: unknown) => setError(String(e)));
    return () => {
      disposed = true;
      for (const v of session.current?.views ?? views) {
        v.engine.dispose();
        v.world.dispose();
      }
      session.current = null;
      cells.forEach((c) => c.remove());
    };
  }, []);

  // Drag to orbit, wheel to zoom: every engine shares the camera.
  useEffect(() => {
    const el = holder.current!.querySelector<HTMLElement>(".styles-grid")!;
    let drag: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      const views = session.current?.views;
      if (!drag || !views) return;
      const cam = views[0]!.engine.look.params.camera;
      applyCamera(views, {
        yaw: cam.yaw - (e.clientX - drag.x) * 0.3,
        pitch: Math.min(85, Math.max(5, cam.pitch + (e.clientY - drag.y) * 0.2)),
      });
      drag = { x: e.clientX, y: e.clientY };
    };
    const up = () => (drag = null);
    const wheel = (e: WheelEvent) => {
      const views = session.current?.views;
      if (!views) return;
      e.preventDefault();
      const cam = views[0]!.engine.look.params.camera;
      applyCamera(views, { distance: Math.min(120, Math.max(6, cam.distance * Math.exp(e.deltaY * 0.001))) });
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("wheel", wheel);
    };
  }, []);

  const rebuildTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const rebuild = () => {
    const s = session.current;
    if (!s) return;
    s.views = s.views.map((v) => {
      const world = createStyledWorld(s.region, v.id, s.params, s.focus, v.interior);
      v.engine.setWorld(world);
      v.world.dispose();
      return { ...v, world };
    });
  };
  const tune = (key: keyof StyleParams, value: number) => {
    const s = session.current;
    if (!s) return;
    s.params[key] = value;
    setParams({ ...s.params });
    clearTimeout(rebuildTimer.current);
    rebuildTimer.current = setTimeout(rebuild, 150);
  };
  const focusOn = (f: Focus) => {
    const s = session.current;
    if (!s) return;
    s.focus = f;
    for (const v of s.views) v.world.target.set(f.x, 0.5, f.z);
  };
  const pickView = (v: ViewPreset) => {
    setView(v);
    if (session.current) applyCamera(session.current.views, VIEW_PRESETS[v]);
  };
  const pickPhase = (p: number) => {
    setPhase(p);
    if (session.current) applyPhase(session.current.views, p);
  };
  // On the dev server renders go to shots/ in the repo (gitignored); deployed, they download.
  const save = async () => {
    for (const v of session.current?.views ?? []) {
      // The first capture on a fresh engine can come back as an empty frame (its offscreen
      // pipelines still compiling), so take one to warm up and keep the second.
      await v.engine.capture();
      const png = await v.engine.capture();
      const name = `style-${v.interior ?? v.id}-${view}`;
      if (import.meta.env.DEV) {
        await fetch(`/__dev/shot?name=${name}`, { method: "POST", body: png });
        continue;
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(png);
      a.download = `${name}.png`;
      a.click();
    }
  };

  return (
    <div className="styles-page" ref={holder}>
      <div className={`styles-grid n${VIEWS.length}`} />
      <div className="styles-panel">
        <button type="button" onClick={() => setPanel(!panel)}>{panel ? "Hide" : "Controls"}</button>
        {error && <p className="status bad">{error}</p>}
        {!ready && !error && <p>Building…</p>}
        {panel && ready && (
          <>
            <fieldset>
              {(Object.keys(VIEW_PRESETS) as ViewPreset[]).map((v) => (
                <button key={v} type="button" className={v === view ? "on" : ""} onClick={() => pickView(v)}>{v}</button>
              ))}
            </fieldset>
            <fieldset>
              {ready.focuses.map((f) => (
                <button key={f.name} type="button" onClick={() => focusOn(f)}>{f.name}</button>
              ))}
            </fieldset>
            <fieldset className="sliders">
              <label>
                <span>time of day</span>
                <input type="range" min={0} max={1} step={0.01} value={phase} onChange={(e) => pickPhase(Number(e.target.value))} />
                <output>{phase}</output>
              </label>
              {SLIDERS.map((s) => (
                <label key={s.key}>
                  <span>{s.label}</span>
                  <input type="range" min={s.min} max={s.max} step={s.step} value={params[s.key]} onChange={(e) => tune(s.key, Number(e.target.value))} />
                  <output>{params[s.key]}</output>
                </label>
              ))}
            </fieldset>
            <fieldset>
              <button type="button" onClick={save}>Save PNGs</button>
              <span className="muted">{ready.backend}</span>
            </fieldset>
          </>
        )}
      </div>
    </div>
  );
}

function applyCamera(views: View[], camera: Partial<Engine["look"]["params"]["camera"]>) {
  for (const v of views) Object.assign(v.engine.look.params.camera, camera, { orbit: false });
}

/** Holds every engine at the same time of day so only the geometry differs. */
function applyPhase(views: View[], phase: number) {
  for (const v of views) {
    const time = v.engine.look.params.time;
    time.drift = false;
    time.phase = phase;
  }
}
