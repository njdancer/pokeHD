// A temporary stand-in for the colour work (D43): a fan's hand-coloured versions of the 151 front
// pictures, shown instead of their SGB colours. Served like Nick's cartridge, only to players
// allowed it; nobody else gets a request that succeeds, and then everything stays as it was.
//
// The atlas is 16 pictures to a row, 56×56 each, slot = Pokédex number − 1. Each picture sits where
// the game draws it in its 7×7-tile frame (LoadUncompressedSpriteData: (8 − width) / 2 tiles in,
// bottom-aligned), facing the way the ROM stores it. Transparent wherever the fan's colour should
// give way to the game's own (background, or a pixel the fan left out).

const FRAME = 56;
const PER_ROW = 16;

let atlas: ImageData | null = null;
let loading: Promise<void> | null = null;

/** Fetches the atlas once. Quietly does nothing for players it isn't shared with. */
export function loadFanSet(): Promise<void> {
  loading ??= (async () => {
    if (new URLSearchParams(location.search).get("fan") === "0") return;
    const res = await fetch("/api/colour-set").catch(() => null);
    if (!res?.ok) return;
    const bitmap = await createImageBitmap(await res.blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    atlas = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  })().catch((err) => console.warn("[pokeHD] couldn't load the hand-coloured pictures", err));
  return loading;
}

const frames = new Map<number, Uint8ClampedArray | null>();

/** Pokédex number `dex`'s hand-coloured picture in its 56×56 battle frame (RGBA), or null. */
export function fanFrame(dex: number): Uint8ClampedArray | null {
  if (!atlas || dex < 1 || dex > 151) return null;
  let frame = frames.get(dex);
  if (frame !== undefined) return frame;
  const sx = ((dex - 1) % PER_ROW) * FRAME, sy = Math.floor((dex - 1) / PER_ROW) * FRAME;
  frame = new Uint8ClampedArray(FRAME * FRAME * 4);
  let any = false;
  for (let y = 0; y < FRAME; y++) {
    const from = ((sy + y) * atlas.width + sx) * 4;
    frame.set(atlas.data.subarray(from, from + FRAME * 4), y * FRAME * 4);
  }
  for (let i = 3; i < frame.length; i += 4) if (frame[i]) { any = true; break; }
  if (!any) frame = null;
  frames.set(dex, frame);
  return frame;
}

/**
 * The hand-coloured picture cut to the ROM picture's own size (`width`×`height` pixels, whole
 * tiles), as a data URL, optionally mirrored; or null. Pixels the fan left out fall back to `base`.
 */
export function fanPicture(dex: number, width: number, height: number, flip: boolean, base: (x: number, y: number) => [number, number, number] | null): string | null {
  const frame = fanFrame(dex);
  if (!frame) return null;
  const left = Math.floor((8 - width / 8) / 2) * 8, top = FRAME - height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = flip ? width - 1 - x : x;
      const i = ((top + y) * FRAME + left + sx) * 4, o = (y * width + x) * 4;
      if (frame[i + 3]) { image.data.set([frame[i]!, frame[i + 1]!, frame[i + 2]!, 255], o); continue; }
      const fallback = base(sx, y);
      if (fallback) image.data.set([...fallback, 255], o);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

/** Whether the hand-coloured pictures are loaded, e.g. to key caches on. */
export const fanSetLoaded = () => atlas !== null;
