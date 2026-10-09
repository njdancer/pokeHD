// The HD Pokédex over the game: the player lifts it up and the world behind softens. Three looks
// while Nick picks (p2-dex): "device" (a 3D handheld with the page on its screen), "pixel" (the
// same handheld as pixel art, the game's own letters) and "storybook" (no device, a D31 panel).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { WorldData } from "@pokehd/rom";
import type { DexDevice } from "@pokehd/engine/dex";
import { DexBook } from "./DexBook.tsx";
import type { Catalogue, DexProgress } from "./catalogue.ts";
import { drawPixelBody, drawPixelCover, PIXEL_DEVICE } from "./pixel-device.ts";
import "./pokedex.css";

export type PokedexStyle = "device" | "pixel" | "storybook";

export interface PokedexProps {
  rom: Uint8Array;
  world: WorldData;
  catalogue: Catalogue;
  progress: DexProgress;
  style: PokedexStyle;
  openOn?: number;
  tab?: "pokemon" | "people" | "places";
  /** Changes (the B button) ask it to close. */
  closeSignal?: number;
  /** Called once it has closed (after its closing animation). */
  onClosed(): void;
}

/** Calls `close` when `signal` changes, or on Escape. */
function useCloseRequests(signal: number | undefined, close: () => void) {
  const first = useRef(signal);
  const latest = useRef(close);
  useLayoutEffect(() => {
    latest.current = close;
  });
  useEffect(() => {
    if (signal !== first.current) latest.current();
  }, [signal]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && latest.current();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
}

export function Pokedex(props: PokedexProps) {
  if (props.style === "device") return <DeviceDex {...props} />;
  if (props.style === "pixel") return <PixelDex {...props} />;
  return <StorybookDex {...props} />;
}

function DeviceDex({ rom, world, catalogue, progress, openOn, tab, closeSignal, onClosed }: PokedexProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const shadeRef = useRef<HTMLDivElement>(null);
  const deviceRef = useRef<DexDevice>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let device: DexDevice | null = null;
    void import("@pokehd/engine/dex").then(async ({ createDexDevice, quadTransform }) => {
      if (disposed) return;
      let size = { w: 0, h: 0 };
      device = await createDexDevice(canvasRef.current!, {
        model: "/models/pokedex.glb",
        // The hand that holds it is a prototype, off unless asked for (?hand).
        hand: new URLSearchParams(location.search).has("hand"),
        onScreen(quad, open, settled) {
          const el = screenRef.current;
          if (!el) return;
          // Sized to the screen once it's square to the camera and as close as it comes (settled),
          // so the page lays out once and its text is drawn at its real size.
          const w = Math.round(Math.hypot(quad[1]![0] - quad[0]![0], quad[1]![1] - quad[0]![1]));
          const h = Math.round(Math.hypot(quad[3]![0] - quad[0]![0], quad[3]![1] - quad[0]![1]));
          if (!size.w || settled) {
            if (w !== size.w || h !== size.h) {
              size = { w, h };
              el.style.width = `${w}px`;
              el.style.height = `${h}px`;
            }
          }
          el.style.transform = quadTransform(size.w, size.h, quad);
          // The cover hides the screen until it has swung clear of it.
          el.style.opacity = String(Math.min(1, Math.max(0, (open - 0.6) / 0.3)));
          el.style.visibility = open > 0.6 ? "visible" : "hidden";
          if (shadeRef.current) shadeRef.current.style.opacity = String(Math.min(1, device ? device.progress * 1.6 : 0));
        },
      }).catch((e: unknown) => {
        console.error("[pokeHD] Pokédex device failed", e);
        setFailed(true);
        return null;
      });
      if (!device) return;
      if (disposed) return device.dispose();
      deviceRef.current = device;
      (window as { __dexDevice?: DexDevice }).__dexDevice = device;
      // Dev screenshots (?still) skip the animation.
      await device.open(new URLSearchParams(location.search).has("still"));
    });
    return () => {
      disposed = true;
      device?.dispose();
      deviceRef.current = null;
    };
  }, []);

  const closing = useRef(false);
  const close = async () => {
    if (closing.current) return;
    closing.current = true;
    await deviceRef.current?.close();
    onClosed();
  };
  useCloseRequests(closeSignal, () => void close());

  if (failed) return <StorybookDex rom={rom} world={world} catalogue={catalogue} progress={progress} style="storybook" openOn={openOn} tab={tab} onClosed={onClosed} />;
  return (
    <div className="pokedex pokedex-device">
      <div className="pokedex-shade" ref={shadeRef} onClick={close} />
      <canvas className="pokedex-canvas" ref={canvasRef} />
      <div className="pokedex-screen" ref={screenRef}>
        <DexBook rom={rom} world={world} catalogue={catalogue} progress={progress} look="hd" openOn={openOn} tab={tab} onClose={close} />
      </div>
    </div>
  );
}

/** The largest whole-number scale at which the pixel device fits the window. */
function pixelScale(): number {
  const { width, height } = PIXEL_DEVICE;
  return Math.max(1, Math.floor(Math.min((innerHeight * 0.96) / height, (innerWidth * 0.98) / width)));
}

function PixelDex({ rom, world, catalogue, progress, openOn, tab, closeSignal, onClosed }: PokedexProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(pixelScale);
  const [stage, setStage] = useState<"rising" | "opening" | "open" | "closing">("rising");

  useLayoutEffect(() => {
    bodyRef.current!.prepend(drawPixelBody());
    coverRef.current!.append(drawPixelCover());
    const onResize = () => setScale(pixelScale());
    addEventListener("resize", onResize);
    const t1 = setTimeout(() => setStage("opening"), 420);
    const t2 = setTimeout(() => setStage("open"), 820);
    return () => {
      removeEventListener("resize", onResize);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  const close = () => {
    if (stage === "closing") return;
    setStage("closing");
    setTimeout(onClosed, 600);
  };
  useCloseRequests(closeSignal, close);
  const { width, height, screen } = PIXEL_DEVICE;
  // The page's own pixel size: the device's pixels are `scale` CSS pixels, the page's letters
  // a whole number of those.
  const px = Math.max(1, Math.floor(scale / 2));
  return (
    <div className={`pokedex pokedex-pixel ${stage}`}>
      <div className="pokedex-shade" onClick={close} />
      <div className="pokedex-pixel-device" style={{ width: width * scale, height: height * scale }} ref={bodyRef}>
        <div
          className="pokedex-pixel-screen"
          style={{ left: screen.x * scale, top: screen.y * scale, width: screen.w * scale, height: screen.h * scale, ["--dex-px" as string]: px }}
        >
          <DexBook rom={rom} world={world} catalogue={catalogue} progress={progress} look="pixel" openOn={openOn} tab={tab} onClose={close} />
        </div>
        <div className="pokedex-pixel-cover" ref={coverRef} />
      </div>
    </div>
  );
}

function StorybookDex({ rom, world, catalogue, progress, openOn, tab, closeSignal, onClosed }: PokedexProps) {
  const [closing, setClosing] = useState(false);
  const close = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClosed, 260);
  };
  useCloseRequests(closeSignal, close);
  return (
    <div className={`pokedex pokedex-storybook ${closing ? "closing" : ""}`}>
      <div className="pokedex-shade" onClick={close} />
      <div className="pokedex-panel">
        <DexBook rom={rom} world={world} catalogue={catalogue} progress={progress} look="storybook" openOn={openOn} tab={tab} onClose={close} />
      </div>
    </div>
  );
}
