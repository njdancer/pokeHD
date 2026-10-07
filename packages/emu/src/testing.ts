// Helpers for ROM tests that drive the game from Node. Not exported from the package.
import { Button, type GameBoy } from "./core.ts";

/** Mashes A (with the odd Down and Start) through the intro until the overworld loop runs. */
export function playIntro(gb: GameBoy): number {
  let reached = false;
  const remove = gb.addHook("OverworldLoop", () => (reached = true));
  let frame = 0;
  while (!reached && frame < 20_000) {
    const press = frame % 64 < 8 ? Button.Down : frame % 512 < 8 ? Button.Start : Button.A;
    gb.setButtons(frame % 8 < 2 ? press : 0);
    gb.runFrame();
    frame++;
  }
  remove();
  gb.setButtons(0);
  for (let i = 0; i < 60; i++) gb.runFrame();
  return frame;
}
