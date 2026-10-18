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
 * slightly off-axis still walks straight; a diagonal walks as a staircase (StairStep in @pokehd/emu).
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

/** A held stick direction lets go only once the thumb comes back inside this fraction of the dead zone. */
const STICK_RELEASE = 0.7;
/** Degrees off the nearest axis where the stick starts holding a diagonal, and where a held one lets go. */
const DIAGONAL_ON = 30;
const DIAGONAL_OFF = 22;

/**
 * D-pad bits for a thumbstick at (x, y), with x right and y down and 1 the stick's reach: the axis
 * the thumb leans furthest along, or both near a diagonal (15° either side of it), which the game
 * walks as a staircase (StairStep in @pokehd/emu). Two kinds of hysteresis stop it flickering where
 * a thumb wobbles: a held direction lets go a little inside the dead zone rather than right at it,
 * and a held diagonal lets go only some way past where it began (22° off the axis, not 30°).
 */
export function stickDirection(x: number, y: number, held: number, deadzone: number): number {
  const reach = Math.hypot(x, y);
  if (reach < (held ? deadzone * STICK_RELEASE : deadzone)) return 0;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const across = x < 0 ? Button.Left : Button.Right;
  const along = y < 0 ? Button.Up : Button.Down;
  const off = (Math.atan2(Math.min(ax, ay), Math.max(ax, ay)) * 180) / Math.PI;
  const diagonal = held & LEFT_RIGHT && held & UP_DOWN;
  if (off >= (diagonal ? DIAGONAL_OFF : DIAGONAL_ON)) return across | along;
  return ax >= ay ? across : along;
}
