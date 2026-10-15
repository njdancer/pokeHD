// The Pokédex's parametric screen (p2-dex, Nick 2026-10-11), at /dev/dex/shape, standalone until
// Nick picks: the modelled dex to turn round and inspect, with its screen's shape and corner
// radius live (model.ts `reshape`). By default the screen fits the phone it's on (so the open
// dex's screen fills it) and its corners match the phone's display. Beside it (on a phone, behind
// "Try it"), the dex opens with the Pokédex menu drawn on its screen. On a computer the phone is an iPhone 13 Pro sized frame. The menu runs
// on the sample adventure and taps don't change it. URL options: ?tab=map.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { loadDexModel, type DexDevice, type DexModel, type Insets, type ScreenShape } from "@pokehd/engine/dex";
import { parseWorld, trainerClasses } from "@pokehd/rom";
import { fetchDevRom } from "../dev-rom.ts";
import { loadStoredRom } from "../rom-store.ts";
import { buildCatalogue } from "../dex/catalogue.ts";
import { displayRadius, fillAspect, filledWidth, safeInsets } from "../dex/display.ts";
import { DexMenu } from "../menu/DexMenu.tsx";
import type { MenuEnv } from "../menu/env.tsx";
import type { TabId } from "../menu/icons.tsx";
import type { MenuActions } from "../menu/model.ts";
import { sampleModel } from "../menu/sample.ts";
import "./dex-shape-dev.css";

const query = new URLSearchParams(location.search);
const MODEL = "/models/pokedex.glb";
/** The modelled screen: 4.6 cm wide, 3.9 tall as the anime has it. */
const SCREEN_W_CM = 4.6;
const TODAY = 4.6 / 3.9;

/** Taps on the sample answer with a line and change nothing. */
const ACTIONS: MenuActions = {
  useItem: () => "Used it",
  makeLeader: () => "Leads now",
  fieldMove: () => "",
  moveMon() {},
  moveMove() {},
  moveItem() {},
  sendOut: () => "Go!",
  throwBall: () => "Shoot! It was so close too!",
  teach: () => "Learned it!",
  cut: () => "Hacked away with CUT!",
  deposit: () => "In the PC now",
  withdraw: () => "Joined your team",
  buy: () => "Bought it",
  sell: () => "Sold it",
  gift: () => "On its way",
  ask: () => "Asked. Meet upstairs in any Pokémon Center!",
  save: () => "Saved!",
  setOption() {},
  setApp() {},
  goBack: () => "Went back",
  cancel() {},
};

type Env = Omit<MenuEnv, "toast">;

/** The phone the dex is shaped for: its size (portrait), safe area and corner radius. */
interface Phone {
  w: number;
  h: number;
  insets: Insets;
  radius: number;
  /** Whether the radius is the display's own or a guess. */
  known: boolean;
  name: string;
}

/** An iPhone 13 Pro, for trying it on a computer. */
const FRAME: Phone = { w: 390, h: 844, insets: { top: 47, right: 0, bottom: 34, left: 0 }, radius: 47.33, known: true, name: "iPhone 13 Pro" };

function thisPhone(): Phone {
  const { radius, known } = displayRadius();
  const i = safeInsets();
  // Portrait, whichever way it's held now: the dex turns with the phone.
  const landscape = innerWidth > innerHeight;
  const insets = landscape ? { top: i.left, right: i.top, bottom: i.right, left: i.bottom } : i;
  return { w: Math.min(innerWidth, innerHeight), h: Math.max(innerWidth, innerHeight), insets, radius, known, name: "this phone" };
}

const free = (p: Phone) => ({ w: p.w - p.insets.left - p.insets.right, h: p.h - p.insets.top - p.insets.bottom });

/** "9:19.5"-style, for a screen `aspect` wide over tall. */
const ratio = (aspect: number) => `9:${(9 / aspect).toFixed(1).replace(/\.0$/, "")}`;

export function DexShapeDev() {
  const [env, setEnv] = useState<Env | null>(null);
  const [small, setSmall] = useState(() => matchMedia("(max-width: 760px)").matches);
  const [phone, setPhone] = useState<Phone>(() => (small ? thisPhone() : FRAME));
  const space = free(phone);
  const fit = fillAspect(space.w, space.h);
  const [aspect, setAspect] = useState<number | "fit">("fit");
  const [radiusPx, setRadiusPx] = useState<number | "match">("match");
  const [cover, setCover] = useState(1);
  const [trying, setTrying] = useState(false);

  useEffect(() => {
    const mq = matchMedia("(max-width: 760px)");
    const on = () => {
      setSmall(mq.matches);
      setPhone(mq.matches ? thisPhone() : FRAME);
    };
    mq.addEventListener("change", on);
    addEventListener("resize", on);
    return () => {
      mq.removeEventListener("change", on);
      removeEventListener("resize", on);
    };
  }, []);

  useEffect(() => {
    (async () => {
      const rom = (await fetchDevRom()) ?? (await loadStoredRom());
      if (!rom) return;
      const world = parseWorld(rom);
      const trainers = trainerClasses(rom);
      setEnv({ rom, world, catalogue: buildCatalogue(rom, world), trainers, model: sampleModel(trainers), moment: "explore", actions: ACTIONS });
    })().catch((e: unknown) => console.error(e));
  }, []);

  const a = aspect === "fit" ? fit : aspect;
  const r = radiusPx === "match" ? phone.radius : radiusPx;
  // The radius in the model: a fraction of the screen's width, as wide as it shows when filled.
  const widthPx = filledWidth(space.w, space.h, a);
  const shape = useMemo<ScreenShape>(() => ({ aspect: a, radius: r / widthPx }), [a, r, widthPx]);
  const tab = (query.get("tab") as TabId | null) ?? undefined;

  const controls = (
    <div className="ds-controls">
      <section>
        <h2>
          Screen <small>{SCREEN_W_CM} × {(SCREEN_W_CM / a).toFixed(1)} cm · {ratio(a)}</small>
        </h2>
        <input type="range" min={0.4} max={TODAY} step={0.005} value={a} aria-label="Screen shape, wide to tall" style={{ direction: "rtl" }} onChange={(e) => setAspect(+e.target.value)} />
        <div className="ds-chips">
          <button type="button" aria-pressed={aspect === "fit"} onClick={() => setAspect("fit")}>
            Fit {phone.name} ({ratio(fit)})
          </button>
          <button type="button" aria-pressed={aspect !== "fit" && Math.abs(a - 9 / 16) < 0.002} onClick={() => setAspect(9 / 16)}>9:16</button>
          <button type="button" aria-pressed={aspect !== "fit" && Math.abs(a - TODAY) < 0.002} onClick={() => setAspect(TODAY)}>Today's</button>
        </div>
      </section>
      <section>
        <h2>
          Corner radius <small>{Math.round(r)} px on the phone</small>
        </h2>
        <input type="range" min={0} max={80} step={0.5} value={r} aria-label="Screen corner radius" onChange={(e) => setRadiusPx(+e.target.value)} />
        <div className="ds-chips">
          <button type="button" aria-pressed={radiusPx === "match"} onClick={() => setRadiusPx("match")}>
            Match {phone.name} ({Math.round(phone.radius)} px{phone.known ? "" : ", unknown display"})
          </button>
          <button type="button" aria-pressed={radiusPx === 0} onClick={() => setRadiusPx(0)}>Square</button>
        </div>
      </section>
      <section>
        <h2>Cover</h2>
        <input type="range" min={0} max={1} step={0.01} value={cover} aria-label="Cover, shut to open" onChange={(e) => setCover(+e.target.value)} />
      </section>
    </div>
  );

  if (small) {
    return (
      <div className="ds-small">
        <Inspector shape={shape} cover={cover} />
        <div className="ds-sheet">
          {controls}
          <button type="button" className="ds-try" onClick={() => setTrying(true)} disabled={!env}>
            {env ? "Try it with the menu" : "Loading the cartridge…"}
          </button>
        </div>
        {trying && env && (
          <div className="ds-full">
            <button type="button" className="ds-back" onClick={() => setTrying(false)}>
              Back to the model
            </button>
            <DexPhone env={env} shape={shape} insets={phone.insets} tab={tab} onClosed={() => setTrying(false)} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="ds-page">
      <div className="ds-left">
        <header className="ds-head">
          <p className="ds-kicker">Prototype · Pokédex screen</p>
          <h1>A screen shaped like the phone</h1>
          <p>
            The screen is parametric: it grows taller to the phone's shape, so the open dex's screen fills it, and its corners round to match the phone's. Only the screen, its white
            frame and the body between the lens and the buttons grow. Drag to turn the dex, pinch or scroll to zoom. On the right it opens on an {FRAME.name} with today's menu inside;
            tap beside the dex to close it and again to replay.
          </p>
        </header>
        <div className="ds-view">
          <Inspector shape={shape} cover={cover} />
        </div>
        {controls}
      </div>
      <div className="ds-scale">
        <div className="ds-phone">{env ? <DexPhone env={env} shape={shape} insets={phone.insets} tab={tab} /> : <p className="ds-status">Loading the cartridge…</p>}</div>
      </div>
    </div>
  );
}

/** The model on its own, to turn round: orbit, zoom, and the shape and cover as set. */
function Inspector({ shape, cover }: { shape: ScreenShape; cover: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modelRef = useRef<DexModel | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    let disposed = false;
    let raf = 0;
    let model: DexModel | null = null;
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 1, 400);
    camera.position.set(-14, 6, 52);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.minDistance = 12;
    controls.maxDistance = 120;
    let framed = false;
    const resize = new ResizeObserver(() => {
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // Back far enough at first for the whole open dex, narrow views included.
      if (!framed) camera.position.setLength(Math.max(55, 42 / camera.aspect));
      framed = true;
    });
    (async () => {
      await renderer.init();
      if (disposed) return;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.setClearColor(0x000000, 0);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      scene.environment = pmrem.fromScene(room, 0.04).texture;
      scene.environmentIntensity = 0.35;
      room.dispose();
      scene.add(new THREE.HemisphereLight(0xfff4e2, 0x5a4636, 0.7));
      const key = new THREE.DirectionalLight(0xfff0d8, 2.4);
      key.position.set(-6, 9, 12);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xbfd8ff, 1.2);
      rim.position.set(8, 4, -6);
      scene.add(rim);
      model = await loadDexModel(MODEL);
      if (disposed) return model.dispose();
      modelRef.current = model;
      scene.add(model.root);
      setReady(true);
      resize.observe(canvas);
      const tick = () => {
        controls.update();
        void renderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
      };
      tick();
    })().catch((e: unknown) => console.error("[pokeHD] dex inspector", e));
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      resize.disconnect();
      controls.dispose();
      model?.dispose();
      renderer.dispose();
    };
  }, []);

  // Reshape and pose, centred on the device as it is open.
  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;
    model.reshape(shape);
    model.setOpen(cover);
    model.root.position.copy(model.opened.getCenter(new THREE.Vector3())).negate();
  }, [ready, shape, cover]);

  return <canvas className="ds-inspect" ref={canvasRef} />;
}

/** The device opened on a phone-sized stage, with the menu over its screen. */
function DexPhone({ env, shape, insets, tab, onClosed }: { env: Env; shape: ScreenShape; insets: Insets; tab?: TabId; onClosed?(): void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const [screenEl, setScreenEl] = useState<HTMLDivElement | null>(null);
  const screenAt = useCallback((el: HTMLDivElement | null) => {
    screenRef.current = el;
    setScreenEl(el);
  }, []);
  const deviceRef = useRef<DexDevice | null>(null);
  const [info, setInfo] = useState("");
  const latest = useRef({ shape, insets });
  useLayoutEffect(() => {
    latest.current = { shape, insets };
  });

  useEffect(() => {
    let disposed = false;
    let device: DexDevice | null = null;
    void import("@pokehd/engine/dex").then(async ({ createDexDevice, quadTransform }) => {
      if (disposed) return;
      let size = { w: 0, h: 0 };
      device = await createDexDevice(canvasRef.current!, {
        model: MODEL,
        screen: latest.current.shape,
        insets: latest.current.insets,
        onScreen(quad, open, settled) {
          const el = screenRef.current;
          if (!el) return;
          // Laid out at the screen's size when it's square to the camera (as Pokedex.tsx).
          const w = Math.round(Math.hypot(quad[1]![0] - quad[0]![0], quad[1]![1] - quad[0]![1]));
          const h = Math.round(Math.hypot(quad[3]![0] - quad[0]![0], quad[3]![1] - quad[0]![1]));
          if ((!size.w || settled) && (w !== size.w || h !== size.h)) {
            size = { w, h };
            el.style.width = `${w}px`;
            el.style.height = `${h}px`;
            setInfo(`${w} × ${h} px`);
          }
          // The page's corners round with the screen's.
          const r = `${(latest.current.shape.radius * size.w).toFixed(1)}px`;
          el.style.borderRadius = r;
          el.style.setProperty("--m-screen-r", r);
          el.style.transform = quadTransform(size.w, size.h, quad);
          el.style.opacity = String(Math.min(1, Math.max(0, (open - 0.6) / 0.3)));
          el.style.visibility = open > 0.6 ? "visible" : "hidden";
        },
      }).catch((e: unknown) => {
        console.error("[pokeHD] Pokédex device failed", e);
        return null;
      });
      if (!device) return;
      if (disposed) return device.dispose();
      deviceRef.current = device;
      await device.open(query.has("still"));
    });
    return () => {
      disposed = true;
      device?.dispose();
      deviceRef.current = null;
    };
  }, []);

  useEffect(() => {
    deviceRef.current?.reshape(shape);
  }, [shape]);
  useEffect(() => {
    deviceRef.current?.setInsets(insets);
  }, [insets]);

  const toggle = () => {
    const d = deviceRef.current;
    if (!d) return;
    if (d.progress > 0.5) void d.close().then(() => onClosed?.());
    else void d.open();
  };

  const start = useMemo(() => (tab ? { tab } : undefined), [tab]);
  return (
    <div className="ds-stage">
      <div className="ds-backdrop" onClick={toggle} />
      <canvas className="ds-canvas" ref={canvasRef} />
      <div className="ds-screen" ref={screenAt} />
      {screenEl && <DexMenu env={env} open onClose={toggle} start={start} screen={screenEl} />}
      {info && <span className="ds-size">Screen {info}</span>}
    </div>
  );
}
