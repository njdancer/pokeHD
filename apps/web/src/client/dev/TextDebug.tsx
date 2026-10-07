// Dev page (/dev/text): the game in a 2D canvas next to the text decoder's model of the same
// screen (p2-text-read). Boxes, menus and the message box are drawn as plain HTML at their tile
// positions, with the raw model below. No styling decisions here: p2-text owns the look.
import { useEffect, useRef, useState } from "react";
import {
  EmulatorHost,
  SCREEN_COLS,
  SCREEN_HEIGHT,
  SCREEN_ROWS,
  SCREEN_WIDTH,
  ScreenTextDecoder,
  TEXT_WATCHES,
  type ScreenText,
  type TextWatched,
} from "@pokehd/emu";
import { readGlyphs } from "@pokehd/rom";
import { fetchDevRom } from "../dev-rom.ts";
import { JoypadInput, KeyBindingsPanel } from "../input/index.ts";
import { loadStoredRom } from "../rom-store.ts";
import "./text-debug.css";

/** Model updates per second shown on the page; decoding itself runs every frame. */
const SHOW_EVERY_FRAMES = 4;

export function TextDebug() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [text, setText] = useState<ScreenText | null>(null);
  const [status, setStatus] = useState("Loading ROM…");
  const [input, setInput] = useState<JoypadInput>();

  useEffect(() => {
    let host: EmulatorHost | undefined;
    let cancelled = false;
    const joypad = new JoypadInput({
      onChange: (mask, source) => {
        host?.setButtons(mask);
        if (mask && source !== "gamepad") void host?.enableAudio();
      },
    });
    (async () => {
      const rom = (await fetchDevRom()) ?? (await loadStoredRom());
      if (cancelled) return;
      setInput(joypad);
      if (!rom) return setStatus("No ROM yet. Load one on the main page first.");
      const decoder = new ScreenTextDecoder(readGlyphs(rom));
      const ctx = canvasRef.current!.getContext("2d")!;
      const image = ctx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
      host = new EmulatorHost({
        rom,
        onFrame: ({ pixels, count, watched }) => {
          image.data.set(new Uint8Array(pixels));
          ctx.putImageData(image, 0, 0);
          const decoded = decoder.decode(watched as TextWatched);
          if (count % SHOW_EVERY_FRAMES === 0) setText(decoded);
        },
        onError: (message) => setStatus(`Emulator error: ${message}`),
      });
      host.watch(TEXT_WATCHES);
      host.setButtons(joypad.mask);
      setStatus("Running from power-on, without a save. Keys are listed below.");
    })();
    return () => {
      cancelled = true;
      joypad.dispose();
      host?.dispose();
    };
  }, []);

  return (
    <main className="text-debug">
      <h1>Text decoder</h1>
      <div className="screens">
        <canvas ref={canvasRef} width={SCREEN_WIDTH} height={SCREEN_HEIGHT} />
        <TextModel text={text} />
      </div>
      <p className="status">{status}</p>
      <Summary text={text} />
      <details>
        <summary>Raw model</summary>
        <pre>{JSON.stringify(text, null, 1)}</pre>
      </details>
      {input && <KeyBindingsPanel input={input} />}
      <a href="/">Back</a>
    </main>
  );
}

const at = (x: number, y: number, width = 1, height = 1) => ({
  left: `${(x / SCREEN_COLS) * 100}%`,
  top: `${(y / SCREEN_ROWS) * 100}%`,
  width: `${(width / SCREEN_COLS) * 100}%`,
  height: `${(height / SCREEN_ROWS) * 100}%`,
});

/** The decoded screen, drawn on the same 20×18 grid as the Game Boy's. */
function TextModel({ text }: { text: ScreenText | null }) {
  const cursors = new Map(
    (text?.menus ?? []).flatMap((m) => {
      const item = m.cursor === null ? undefined : m.items[m.cursor];
      return item ? [[`${m.box.x},${item.row}`, m.active] as const] : [];
    }),
  );
  return (
    <div className={text?.shown ? "model" : "model hidden"}>
      {text?.boxes.map((box) => (
        <div key={`${box.x},${box.y}`} className="box" style={at(box.x, box.y, box.width, box.height)} />
      ))}
      {text?.boxes.flatMap((box) =>
        box.lines.map((line) => {
          const cursor = cursors.get(`${box.x},${line.row}`);
          const cls = cursor === undefined ? "line" : cursor ? "line selected" : "line chosen";
          return (
            <div key={`${box.x},${box.y},${line.row}`} className={cls} style={at(line.col, line.row, box.x + box.width - 1 - line.col)}>
              {line.text}
            </div>
          );
        }),
      )}
      {text?.loose.map((line) => (
        <div key={`loose ${line.col},${line.row}`} className="line loose" style={at(line.col, line.row, SCREEN_COLS - line.col)}>
          {line.text}
        </div>
      ))}
    </div>
  );
}

function Summary({ text }: { text: ScreenText | null }) {
  if (!text) return null;
  if (!text.shown) return <p className="summary">No text on screen.</p>;
  return (
    <ul className="summary">
      {text.dialog && (
        <li>
          Message ({text.dialog.state}): “{text.dialog.lines.filter(Boolean).join(" ")}”
        </li>
      )}
      {text.menus.map((m) => (
        <li key={`${m.box.x},${m.box.y}`}>
          {m.active ? "Menu" : "Menu underneath"} ({m.kind}
          {m.listId !== undefined ? `, list ${m.listId}, scrolled ${m.scroll}` : ""}):{" "}
          {m.items.map((item, i) => (
            <span key={item.row} className={i === m.cursor ? "current" : undefined}>
              {item.text}
              {item.detail ? ` (${item.detail})` : ""}
              {i < m.items.length - 1 ? " · " : ""}
            </span>
          ))}
        </li>
      ))}
      {text.quantity && <li>Quantity: {text.quantity.value}</li>}
      {text.loose.length > 0 && <li>Other text: {text.loose.map((l) => l.text).join(" · ")}</li>}
    </ul>
  );
}
