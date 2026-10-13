// The stream recorded as it plays: CDP screencast frames (JPEG) in a ring buffer of the last 90
// seconds, with the turns' start times, and contact sheets composed from them in a browser canvas
// (no native image libraries).
import type { CDPSession, Page } from "@playwright/test";

export interface RecordedFrame {
  /** Wall-clock time, ms. */
  t: number;
  /** JPEG, base64. */
  data: string;
  /** The frame's size in CSS pixels of the page, and its scale (frame px per CSS px). */
  scale: number;
}

export const KEEP_MS = 90_000;
export const MAX_SHEET_FRAMES = 24;

/**
 * The frames for a contact sheet: one per `1/fps` s from `from` to `to` (ms), each the newest frame
 * at or before that moment (a screencast only sends a frame when the screen changes), the same
 * frame never twice. More than `cap` moments are spread evenly over the span instead.
 */
export function pickFrames<T extends { t: number }>(frames: readonly T[], from: number, to: number, fps: number, cap = MAX_SHEET_FRAMES): { frame: T; at: number }[] {
  if (to < from || fps <= 0 || !frames.length) return [];
  let count = Math.floor(((to - from) / 1000) * fps) + 1;
  let step = 1000 / fps;
  if (count > cap) {
    count = cap;
    step = cap > 1 ? (to - from) / (cap - 1) : 0;
  }
  const out: { frame: T; at: number }[] = [];
  let i = 0;
  for (let k = 0; k < count; k++) {
    const at = from + k * step;
    while (i + 1 < frames.length && frames[i + 1]!.t <= at) i++;
    const frame = frames[i]!;
    if (frame.t > at) continue; // nothing recorded yet at this moment
    if (out.at(-1)?.frame === frame) continue;
    out.push({ frame, at });
  }
  return out;
}

export class Recorder {
  readonly frames: RecordedFrame[] = [];
  readonly turns = new Map<number, number>();
  #session: CDPSession | null = null;

  async start(page: Page, maxWidth = 960): Promise<void> {
    const session = await page.context().newCDPSession(page);
    this.#session = session;
    const viewport = page.viewportSize() ?? { width: 1920, height: 1080 };
    // Stamped on arrival, in the same clock as `markTurn`.
    session.on("Page.screencastFrame", (e: { data: string; sessionId: number }) => {
      const t = Date.now();
      this.frames.push({ t, data: e.data, scale: Math.min(1, maxWidth / viewport.width) });
      while (this.frames.length && this.frames[0]!.t < t - KEEP_MS) this.frames.shift();
      void session.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => {});
    });
    await session.send("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth, maxHeight: Math.round((viewport.height * maxWidth) / viewport.width), everyNthFrame: 1 });
  }

  async stop(): Promise<void> {
    await this.#session?.send("Page.stopScreencast").catch(() => {});
    await this.#session?.detach().catch(() => {});
    this.#session = null;
  }

  markTurn(turn: number, at = Date.now()): void {
    this.turns.set(turn, at);
    // Old turns are no use once their frames are gone.
    for (const [n, t] of this.turns) if (t < at - KEEP_MS * 2) this.turns.delete(n);
  }
}

export interface SheetInput {
  frames: { data: string; label: string }[];
  /** The game's rectangle in the frames' pixels. */
  crop: { x: number; y: number; w: number; h: number };
  /** Cell width in px (height follows the crop's aspect). */
  cellWidth: number;
  title: string;
}

/** Lays frames out in a labelled grid on a canvas in `page` (a blank page); returns PNG bytes. */
export async function composeSheet(page: Page, input: SheetInput): Promise<Buffer> {
  const dataUrl = await page.evaluate(async (inp: SheetInput) => {
    const n = inp.frames.length;
    const cols = Math.min(n, n <= 4 ? n : n <= 9 ? 3 : n <= 16 ? 4 : 6);
    const rows = Math.max(1, Math.ceil(n / Math.max(1, cols)));
    const cw = inp.cellWidth;
    const ch = Math.round((cw * inp.crop.h) / inp.crop.w);
    const pad = 6;
    const labelH = 18;
    const titleH = 24;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, cols) * (cw + pad) + pad;
    canvas.height = titleH + rows * (ch + labelH + pad) + pad;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#eee";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText(inp.title, pad, 17);
    ctx.font = "12px monospace";
    for (let i = 0; i < n; i++) {
      const f = inp.frames[i]!;
      const img = new Image();
      img.src = `data:image/jpeg;base64,${f.data}`;
      await img.decode();
      const x = pad + (i % cols) * (cw + pad);
      const y = titleH + Math.floor(i / cols) * (ch + labelH + pad);
      ctx.drawImage(img, inp.crop.x, inp.crop.y, inp.crop.w, inp.crop.h, x, y, cw, ch);
      ctx.fillStyle = "#eee";
      ctx.fillText(f.label, x + 2, y + ch + 13);
    }
    return canvas.toDataURL("image/png");
  }, input);
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}
