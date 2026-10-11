// The Pokédex with a taller, phone-shaped screen (p2-dex, Nick 2026-10-11), at /dev/dex/shape,
// standalone until Nick picks a shape: the modelled dex opens in an iPhone 13 Pro sized frame
// with the current Pokédex menu laid over its screen, one frame per screen shape side by side
// (today's square-ish screen, 3:4, 9:16, 9:19.5; the models are made by
// assets-src/dex/tall_screen.py). On a phone, one at a time, full screen. The menu runs on the
// sample adventure and taps don't change it. The menu keeps its content and tabs; only its
// temporary panel chrome (frame, corner balls, ×) is left off, since the dex is the frame now.
// URL options: ?shape=9x16 (just that one), ?tab=map.
import { useEffect, useMemo, useRef, useState } from "react";
import type { DexDevice } from "@pokehd/engine/dex";
import { parseWorld, trainerClasses } from "@pokehd/rom";
import { fetchDevRom } from "../dev-rom.ts";
import { loadStoredRom } from "../rom-store.ts";
import { buildCatalogue } from "../dex/catalogue.ts";
import { DexMenu } from "../menu/DexMenu.tsx";
import type { MenuEnv } from "../menu/env.tsx";
import type { TabId } from "../menu/icons.tsx";
import type { MenuActions } from "../menu/model.ts";
import { sampleModel } from "../menu/sample.ts";
import "./dex-shape-dev.css";

const query = new URLSearchParams(location.search);

interface Shape {
  id: string;
  label: string;
  model: string;
  note: string;
}

const SHAPES: Shape[] = [
  { id: "today", label: "Today", model: "/models/pokedex.glb", note: "4.6 × 3.9 cm, wider than tall" },
  { id: "3x4", label: "3:4", model: "/models/pokedex-3x4.glb", note: "4.6 × 6.1 cm, body +2.2 cm" },
  { id: "9x16", label: "9:16", model: "/models/pokedex-9x16.glb", note: "4.6 × 8.2 cm, body +4.3 cm" },
  { id: "9x19", label: "9:19.5", model: "/models/pokedex-9x19.glb", note: "4.6 × 10 cm, an iPhone's own shape" },
];

/** Taps on the sample answer with a line and change nothing. */
const ACTIONS: MenuActions = {
  useItem: () => "Used it",
  makeLeader: () => "Leads now",
  moveMon() {},
  moveMove() {},
  moveItem() {},
  sendOut: () => "Go!",
  throwBall: () => "Shoot! It was so close too!",
  teach: () => "Learned it!",
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

export function DexShapeDev() {
  const [env, setEnv] = useState<Env | null>(null);
  const [status, setStatus] = useState("Loading the cartridge…");
  const only = SHAPES.find((s) => s.id === query.get("shape"));
  const [single, setSingle] = useState(() => matchMedia("(max-width: 700px)").matches);
  const [picked, setPicked] = useState(only?.id ?? "9x16");

  useEffect(() => {
    const mq = matchMedia("(max-width: 700px)");
    const on = () => setSingle(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    (async () => {
      const rom = (await fetchDevRom()) ?? (await loadStoredRom());
      if (!rom) return setStatus("No ROM: load one in the app first.");
      const world = parseWorld(rom);
      const trainers = trainerClasses(rom);
      setEnv({ rom, world, catalogue: buildCatalogue(rom, world), trainers, model: sampleModel(trainers), moment: "explore", actions: ACTIONS });
      setStatus("");
    })().catch((e: unknown) => setStatus(String(e)));
  }, []);

  const tab = (query.get("tab") as TabId | null) ?? undefined;
  if (!env) return <div className="ds-page"><p className="ds-status">{status}</p></div>;

  if (single || only) {
    const shape = SHAPES.find((s) => s.id === picked)!;
    return (
      <div className="ds-full">
        <DexPhone key={shape.id} shape={shape} env={env} tab={tab} />
        {!only && (
          <div className="ds-pick" role="radiogroup" aria-label="Screen shape">
            {SHAPES.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={s.id === picked} onClick={() => setPicked(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="ds-page">
      <header className="ds-head">
        <p className="ds-kicker">Prototype · Pokédex screen shape</p>
        <h1>A taller screen, like a phone</h1>
        <p>
          The same Pokédex with its screen made taller, each in an iPhone 13 Pro sized frame with today's menu inside. Only the screen, its bezel and the body between the lens and the
          buttons grow; the top band and the buttons keep their size. Tap a dex's backdrop to close it and tap again to replay the opening.
        </p>
      </header>
      <div className="ds-row">
        {SHAPES.map((s) => (
          <figure key={s.id} className="ds-fig">
            <div className="ds-scale">
              <div className="ds-phone">
                <DexPhone shape={s} env={env} tab={tab} />
              </div>
            </div>
            <figcaption>
              <b>{s.label}</b> {s.note}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

/** One phone's worth: the device on its own canvas, opened, with the menu over its screen. */
function DexPhone({ shape, env, tab }: { shape: Shape; env: Env; tab?: TabId }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const deviceRef = useRef<DexDevice | null>(null);
  const [info, setInfo] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let device: DexDevice | null = null;
    void import("@pokehd/engine/dex").then(async ({ createDexDevice, quadTransform }) => {
      if (disposed) return;
      let size = { w: 0, h: 0 };
      device = await createDexDevice(canvasRef.current!, {
        model: shape.model,
        onScreen(quad, open, settled) {
          const el = screenRef.current;
          if (!el) return;
          // Laid out once at the screen's size when it's square to the camera (as Pokedex.tsx).
          const w = Math.round(Math.hypot(quad[1]![0] - quad[0]![0], quad[1]![1] - quad[0]![1]));
          const h = Math.round(Math.hypot(quad[3]![0] - quad[0]![0], quad[3]![1] - quad[0]![1]));
          if ((!size.w || settled) && (w !== size.w || h !== size.h)) {
            size = { w, h };
            el.style.width = `${w}px`;
            el.style.height = `${h}px`;
            setInfo(`${w} × ${h} px`);
          }
          el.style.transform = quadTransform(size.w, size.h, quad);
          el.style.opacity = String(Math.min(1, Math.max(0, (open - 0.6) / 0.3)));
          el.style.visibility = open > 0.6 ? "visible" : "hidden";
        },
      }).catch((e: unknown) => {
        console.error("[pokeHD] Pokédex device failed", e);
        setFailed(true);
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
  }, [shape.model]);

  const toggle = () => {
    const d = deviceRef.current;
    if (!d) return;
    void (d.progress > 0.5 ? d.close() : d.open());
  };

  const start = useMemo(() => (tab ? { tab } : undefined), [tab]);
  return (
    <div className="ds-stage">
      <div className="ds-backdrop" onClick={toggle} />
      <canvas className="ds-canvas" ref={canvasRef} />
      {failed && <p className="ds-status">The dex wouldn't load here.</p>}
      <div className="ds-screen" ref={screenRef}>
        <DexMenu env={env} open onClose={toggle} start={start} />
      </div>
      {info && <span className="ds-size">Screen {info}</span>}
    </div>
  );
}
