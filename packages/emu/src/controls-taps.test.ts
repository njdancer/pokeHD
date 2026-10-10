// A press the page lets go of before the next frame still reaches the game, held as long as a tap.
import { describe, expect, it } from "vitest";
import { Controls } from "./controls.ts";
import { Button, type GameBoy } from "./core.ts";

describe("controls: quick taps", () => {
  const boot = () => {
    const sent: number[] = [];
    const controls = new Controls({} as GameBoy, { setButtons: (m) => sent.push(m) });
    /** The buttons each frame runs with. */
    const frames: number[] = [];
    const frame = () => {
      controls.frame();
      frames.push(sent.at(-1) ?? 0);
    };
    return { controls, frame, frames };
  };

  it("holds a press made and let go between two frames for the next two", () => {
    const { controls, frame, frames } = boot();
    frame();
    controls.setButtons(Button.Down);
    controls.setButtons(0);
    frame();
    frame();
    frame();
    expect(frames).toEqual([0, Button.Down, Button.Down, 0]);
  });

  it("leaves held buttons and plain releases alone", () => {
    const { controls, frame, frames } = boot();
    controls.setButtons(Button.Up);
    frame();
    frame();
    frame();
    controls.setButtons(0);
    frame();
    // Up pressed again, then Left pressed and both let go before a frame: Up and Left, as a tap.
    controls.setButtons(Button.Up);
    frame();
    controls.setButtons(Button.Up | Button.Left);
    controls.setButtons(0);
    frame();
    frame();
    frame();
    expect(frames).toEqual([Button.Up, Button.Up, Button.Up, 0, Button.Up, Button.Up | Button.Left, Button.Up | Button.Left, 0]);
  });
});
