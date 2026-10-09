// The pictures of Oak's introduction, lifted off the Game Boy screen for IntroStage.tsx.
import { SCREEN_WIDTH } from "@pokehd/emu";

/** The rows above the message box: 12 tiles. */
export const STAGE_HEIGHT = 96;

/**
 * Copies the top of the Game Boy screen into `out` (160×96 RGBA), with the background (the
 * lightest shade, wherever it reaches the edge) made clear. White inside a picture's outline
 * (Oak's coat) stays.
 */
export function liftPictures(pixels: Uint8ClampedArray | Uint8Array, out: Pick<ImageData, "data">): void {
  const data = out.data;
  const width = SCREEN_WIDTH;
  const count = width * STAGE_HEIGHT;
  data.set(pixels.subarray(0, count * 4));
  // The lightest shade on screen is the background.
  let light = 0;
  for (let i = 0; i < count; i++) light = Math.max(light, data[i * 4]! + data[i * 4 + 1]! + data[i * 4 + 2]!);
  const isLight = (i: number) => data[i * 4]! + data[i * 4 + 1]! + data[i * 4 + 2]! >= light;
  const seen = new Uint8Array(count);
  const stack: number[] = [];
  for (let x = 0; x < width; x++) stack.push(x, (STAGE_HEIGHT - 1) * width + x);
  for (let y = 0; y < STAGE_HEIGHT; y++) stack.push(y * width, y * width + width - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (seen[i] || !isLight(i)) continue;
    seen[i] = 1;
    data[i * 4 + 3] = 0;
    const x = i % width;
    if (x > 0) stack.push(i - 1);
    if (x < width - 1) stack.push(i + 1);
    if (i >= width) stack.push(i - width);
    if (i + width < count) stack.push(i + width);
  }
}
