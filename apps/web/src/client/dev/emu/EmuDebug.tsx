import { useEffect, useRef, useState } from "react";
import { Button, EmulatorHost, SCREEN_HEIGHT, SCREEN_WIDTH } from "@pokehd/emu";
import { SYMBOLS } from "@pokehd/rom";
import { fetchDevRom } from "../../dev-rom.ts";
import { loadStoredRom } from "../../rom-store.ts";
import "./emu-debug.css";

const KEYS: Record<string, number> = {
  ArrowUp: Button.Up,
  ArrowDown: Button.Down,
  ArrowLeft: Button.Left,
  ArrowRight: Button.Right,
  KeyZ: Button.A,
  KeyX: Button.B,
  Enter: Button.Start,
  ShiftRight: Button.Select,
  Backspace: Button.Select,
};

/** Dev page (/dev/emu): the raw emulator in a 2D canvas, with live WRAM readouts. */
export function EmuDebug() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const infoRef = useRef<HTMLPreElement>(null);
  const hostRef = useRef<EmulatorHost>(null);
  const savedRef = useRef<Uint8Array>(null);
  const [status, setStatus] = useState("Loading ROM…");
  const [sound, setSound] = useState(false);

  const enableSound = async () => {
    await hostRef.current?.enableAudio();
    setSound(hostRef.current?.audioEnabled ?? false);
  };

  useEffect(() => {
    let host: EmulatorHost | undefined;
    let cancelled = false;
    (async () => {
      const rom = (await fetchDevRom()) ?? (await loadStoredRom());
      if (cancelled) return;
      if (!rom) return setStatus("No ROM yet. Load one on the main page first.");
      const ctx = canvasRef.current!.getContext("2d")!;
      const image = ctx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
      let fpsFrames = 0;
      let fpsSince = performance.now();
      let fps = 0;
      host = new EmulatorHost({
        rom,
        onFrame: ({ pixels, count, watched }) => {
          image.data.set(new Uint8Array(pixels));
          ctx.putImageData(image, 0, 0);
          fpsFrames++;
          const now = performance.now();
          if (now - fpsSince >= 500) {
            fps = (fpsFrames * 1000) / (now - fpsSince);
            fpsFrames = 0;
            fpsSince = now;
          }
          if (count % 6 === 0 && infoRef.current) {
            const [map, y, x] = [watched.map?.[0], watched.pos?.[0], watched.pos?.[1]];
            infoRef.current.textContent = `frame ${count}  ${fps.toFixed(1)} fps\nwCurMap 0x${hex(map)}  wXCoord ${x}  wYCoord ${y}`;
          }
        },
        onError: (message) => setStatus(`Emulator error: ${message}`),
      });
      // wYCoord and wXCoord are adjacent (d361, d362).
      host.watch({ map: [SYMBOLS.wCurMap.address, 1], pos: [SYMBOLS.wYCoord.address, 2] });
      hostRef.current = host;
      setStatus("Running. Arrows move, Z is A, X is B, Enter is Start, Backspace is Select.");
    })();

    let held = 0;
    const onKey = (e: KeyboardEvent) => {
      const bit = KEYS[e.code];
      if (bit === undefined) return;
      e.preventDefault();
      held = e.type === "keydown" ? held | bit : held & ~bit;
      hostRef.current?.setButtons(held);
      if (e.type === "keydown") void enableSound();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      host?.dispose();
      hostRef.current = null;
    };
  }, []);

  const save = async () => {
    savedRef.current = (await hostRef.current?.saveState()) ?? null;
  };
  const load = () => savedRef.current && hostRef.current?.loadState(savedRef.current);

  return (
    <main className="emu-debug">
      <h1>Emulator debug view</h1>
      <canvas ref={canvasRef} width={SCREEN_WIDTH} height={SCREEN_HEIGHT} />
      <pre ref={infoRef} className="info" />
      <p className="status">{status}</p>
      <div className="actions">
        <button type="button" onClick={enableSound} disabled={sound}>{sound ? "Sound on" : "Enable sound"}</button>
        <button type="button" onClick={save}>Save state</button>
        <button type="button" onClick={load}>Load state</button>
        <a href="/">Back</a>
      </div>
    </main>
  );
}

const hex = (n: number | undefined) => (n ?? 0).toString(16).padStart(2, "0");
