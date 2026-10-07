import { Button } from "@pokehd/emu";

const UP_DOWN = Button.Up | Button.Down;
const LEFT_RIGHT = Button.Left | Button.Right;

/**
 * Adds `bits` to a held mask the way a physical D-pad would allow: it can't hold opposite
 * directions, so a newly pressed direction releases its opposite (last press wins).
 */
export function pressInto(mask: number, bits: number): number {
  if (bits & UP_DOWN) mask &= ~UP_DOWN;
  if (bits & LEFT_RIGHT) mask &= ~LEFT_RIGHT;
  return mask | bits;
}

/** Clears any opposite pair (from two devices disagreeing), leaving neither, as a rocker at rest would. */
export function dropOpposites(mask: number): number {
  if ((mask & UP_DOWN) === UP_DOWN) mask &= ~UP_DOWN;
  if ((mask & LEFT_RIGHT) === LEFT_RIGHT) mask &= ~LEFT_RIGHT;
  return mask;
}

const CARDINAL = [Button.Right, Button.Down, Button.Left, Button.Up];
const DIAGONAL = [Button.Right | Button.Down, Button.Down | Button.Left, Button.Left | Button.Up, Button.Up | Button.Right];

/**
 * D-pad bits for a vector (x right, y down, as screen coordinates and gamepad axes both are).
 * Inside `deadzone` gives nothing. Cardinal sectors are 60° wide and diagonals 30°, so a thumb
 * slightly off-axis still walks straight: the game reads two held directions by priority, which
 * would feel like a wrong turn.
 */
export function directionMask(x: number, y: number, deadzone: number): number {
  if (Math.hypot(x, y) < deadzone) return 0;
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const quadrant = Math.floor(deg / 90) % 4;
  const within = deg - quadrant * 90;
  if (within < 30) return CARDINAL[quadrant]!;
  if (within <= 60) return DIAGONAL[quadrant]!;
  return CARDINAL[(quadrant + 1) % 4]!;
}
