// Decompresses the game's compressed pictures (Pokémon front and back sprites, trainer pics), so
// the explorer can show them. A straight port of home/uncompress.asm (UncompressSpriteData) for
// viewing only: the game itself always uses its own routine in the emulator.

export interface Pic {
  /** In tiles. */
  width: number;
  height: number;
  /** Colour numbers 0–3, one per pixel, row-major (width*8 × height*8). */
  pixels: Uint8Array;
  /** Bytes of compressed input consumed. */
  size: number;
}

const DECODE: readonly (readonly number[])[] = [
  [0x0, 0x1, 0x3, 0x2, 0x7, 0x6, 0x4, 0x5, 0xf, 0xe, 0xc, 0xd, 0x8, 0x9, 0xb, 0xa],
  [0xf, 0xe, 0xc, 0xd, 0x8, 0x9, 0xb, 0xa, 0x0, 0x1, 0x3, 0x2, 0x7, 0x6, 0x4, 0x5],
];

/** Decompresses the picture starting at `offset` in `rom` (a file offset). */
export function decompressPic(rom: Uint8Array, offset: number): Pic {
  let pos = offset;
  let bitCount = 0;
  let cur = 0;
  const bit = () => {
    if (bitCount === 0) {
      cur = rom[pos++] ?? 0;
      bitCount = 8;
    }
    bitCount--;
    return (cur >> bitCount) & 1;
  };
  const dims = rom[pos++] ?? 0;
  const width = dims >> 4;
  const height = dims & 0xf;
  if (!width || !height || width > 15 || height > 15) throw new Error(`Not a picture: size byte $${dims.toString(16)}`);
  const rows = height * 8;
  const size = width * rows;
  const buffers = [new Uint8Array(size), new Uint8Array(size)];

  // Two 1bpp chunks, each written as 2-bit pairs down 2-pixel-wide strips of each 8-pixel column.
  const first = bit();
  let mode = 0;
  for (let chunk = 0; chunk < 2; chunk++) {
    const out = buffers[chunk === 0 ? first : first ^ 1]!;
    if (chunk === 1) mode = bit() ? 1 + bit() : 0;
    let column = 0;
    let shift = 6;
    let y = 0;
    let done = false;
    const put = (pair: number) => {
      const i = column * rows + y;
      out[i] = out[i]! | (pair << shift);
      if (++y < rows) return;
      y = 0;
      if (shift > 0) {
        shift -= 2;
        return;
      }
      shift = 6;
      if (++column === width) done = true;
    };
    let rle = bit() === 0;
    while (!done) {
      if (rle) {
        let ones = 0;
        while (bit()) ones++;
        let n = 0;
        for (let i = 0; i <= ones; i++) n = (n << 1) | bit();
        n += (2 << ones) - 1;
        for (let i = 0; i < n && !done; i++) put(0);
        rle = false;
      } else {
        for (;;) {
          const pair = (bit() << 1) | bit();
          if (pair === 0) break;
          put(pair);
          if (done) break;
        }
        rle = true;
      }
    }
  }

  // Each chunk is delta-coded along rows: a 1 bit toggles the pixel, a 0 keeps the previous one.
  const deltaDecode = (buf: Uint8Array) => {
    for (let y = 0; y < rows; y++) {
      let last = 0;
      for (let c = 0; c < width; c++) {
        const i = c * rows + y;
        const hi = DECODE[last & 1]![buf[i]! >> 4]!;
        const lo = DECODE[hi & 1]![buf[i]! & 0xf]!;
        last = lo;
        buf[i] = (hi << 4) | lo;
      }
    }
  };
  const [a, b] = [buffers[first]!, buffers[first ^ 1]!];
  if (mode === 0) {
    deltaDecode(buffers[0]!);
    deltaDecode(buffers[1]!);
  } else {
    // Modes 1 and 2: the second chunk is XORed with the first (mode 2 delta-decodes it first).
    if (mode === 2) deltaDecode(b);
    deltaDecode(a);
    for (let i = 0; i < size; i++) b[i]! ^= a[i]!;
  }

  // Buffer 1 is the low bit plane, buffer 2 the high one; both are column-major.
  const w = width * 8;
  const pixels = new Uint8Array(w * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < w; x++) {
      const i = (x >> 3) * rows + y;
      const s = 7 - (x & 7);
      pixels[y * w + x] = ((buffers[0]![i]! >> s) & 1) | (((buffers[1]![i]! >> s) & 1) << 1);
    }
  }
  return { width, height, pixels, size: pos - offset };
}
