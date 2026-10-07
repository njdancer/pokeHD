import { Button } from "@pokehd/emu";
import { directionMask } from "./direction.ts";

/**
 * Standard-mapping button indices (https://w3c.github.io/gamepad/#remapping). A and B go by
 * position, as on the Game Boy: A is the right face button, B the bottom one. That matches the
 * labels on Nintendo pads; on an Xbox pad the button labelled A is the Game Boy's B.
 */
export const GAMEPAD_BUTTONS: Readonly<Record<number, number>> = {
  0: Button.B,
  1: Button.A,
  8: Button.Select,
  9: Button.Start,
  12: Button.Up,
  13: Button.Down,
  14: Button.Left,
  15: Button.Right,
};

const STICK_DEADZONE = 0.5;

/** The slice of the Gamepad API this reads, so tests can pass plain objects. */
export interface PadLike {
  readonly connected: boolean;
  readonly buttons: readonly { readonly pressed: boolean }[];
  readonly axes: readonly number[];
}

/** Joypad mask for one pad: its D-pad, face buttons, Start/Select and left stick. */
export function gamepadMask(pad: PadLike): number {
  if (!pad.connected) return 0;
  let mask = 0;
  for (const [index, bit] of Object.entries(GAMEPAD_BUTTONS)) {
    if (pad.buttons[Number(index)]?.pressed) mask |= bit;
  }
  return mask | directionMask(pad.axes[0] ?? 0, pad.axes[1] ?? 0, STICK_DEADZONE);
}

/** Every connected pad pressed together. */
export function gamepadsMask(pads: readonly (PadLike | null)[]): number {
  let mask = 0;
  for (const pad of pads) if (pad) mask |= gamepadMask(pad);
  return mask;
}
