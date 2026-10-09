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

const HORIZONTAL = Button.Left | Button.Right;

/** A held stick direction lets go only once the thumb comes back inside this fraction of the dead zone. */
const STICK_RELEASE = 0.7;
/** To turn, the other axis has to beat the held one by this ratio (about 54° off the held axis). */
const STICK_TURN = 1.4;

/**
 * One direction for a thumbstick at (x, y), with x right and y down and 1 the stick's reach. The
 * game walks on a grid in four directions, so the stick only ever holds one: the axis the thumb
 * leans furthest along. Two kinds of hysteresis stop it flickering where a thumb wobbles: a held
 * direction lets go a little inside the dead zone rather than right at it, and switching to the
 * other axis needs a clear lean (`STICK_TURN`), not just crossing the diagonal.
 */
export function stickDirection(x: number, y: number, held: number, deadzone: number): number {
  const reach = Math.hypot(x, y);
  if (reach < (held ? deadzone * STICK_RELEASE : deadzone)) return 0;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const horizontal = held & HORIZONTAL ? ay <= ax * STICK_TURN : held ? ax > ay * STICK_TURN : ax >= ay;
  if (horizontal) return x < 0 ? Button.Left : Button.Right;
  return y < 0 ? Button.Up : Button.Down;
}
