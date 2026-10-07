import { useEffect, useMemo, useRef, useState } from "react";
import { Button, EmulatorHost, SCREEN_HEIGHT, SCREEN_WIDTH } from "@pokehd/emu";
import { SYMBOLS } from "@pokehd/rom";
import { fetchDevRom } from "../../dev-rom.ts";
import { loadStoredRom } from "../../rom-store.ts";
import "./emu-debug.css";

import { BUTTON_NAMES, JoypadInput, KeyBindingsPanel, TouchPad, useTouchDevice } from "../../input/index.ts";

const heldNames = (mask: number) => BUTTON_NAMES.filter((name) => mask & Button[name]).join(" ") || "none";

/** Dev page (/dev/emu): the raw emulator in a 2D canvas, with live WRAM readouts. */
export function EmuDebug() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const infoRef = useRef<HTMLPreElement>(null);
  const hostRef = useRef<EmulatorHost>(null);
  const savedRef = useRef<Uint8Array>(null);
  const [status, setStatus] = useState("Loading ROM…");
  const [sound, setSound] = useState(false);
  const [input, setInput] = useState<JoypadInput>();
  const [held, setHeld] = useState(0);
  const touch = useTouchDevice();

  const enableSound = async () => {
    await hostRef.current?.enableAudio();
    setSound(hostRef.current?.audioEnabled ?? false);
  };

  useEffect(() => {
    const joypad = new JoypadInput({
      onChange: (mask, source) => {
        hostRef.current?.setButtons(mask);
        setHeld(mask);
        // Keyboard and touch changes come from user gestures, which may start audio; gamepad polls don't.
        if (mask && source !== "gamepad") void enableSound();
      },
    });
    setInput(joypad);
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
      host.setButtons(joypad.mask);
      hostRef.current = host;
      setStatus("Running. Keys are listed below; a gamepad or the on-screen pad works too.");
    })();

    return () => {
      cancelled = true;
      joypad.dispose();
      host?.dispose();
      hostRef.current = null;
    };
  }, []);

  const onTouch = useMemo(() => (mask: number) => input?.setTouchMask(mask), [input]);

  const save = async () => {
    savedRef.current = (await hostRef.current?.saveState()) ?? null;
  };
  const load = () => savedRef.current && hostRef.current?.loadState(savedRef.current);

  return (
    <main className={touch ? "emu-debug with-touch-pad" : "emu-debug"}>
      <h1>Emulator debug view</h1>
      <canvas ref={canvasRef} width={SCREEN_WIDTH} height={SCREEN_HEIGHT} />
      <pre ref={infoRef} className="info" />
      <p className="held">
        Held: <output data-testid="held" data-mask={held}>{heldNames(held)}</output>
      </p>
      <p className="status">{status}</p>
      <div className="actions">
        <button type="button" onClick={enableSound} disabled={sound}>{sound ? "Sound on" : "Enable sound"}</button>
        <button type="button" onClick={save}>Save state</button>
        <button type="button" onClick={load}>Load state</button>
        <a href="/">Back</a>
      </div>
      {input && <KeyBindingsPanel input={input} />}
      {input && touch && <TouchPad onChange={onTouch} />}
    </main>
  );
}

const hex = (n: number | undefined) => (n ?? 0).toString(16).padStart(2, "0");
