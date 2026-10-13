// The game driver's contract with the player loop (../player.ts). The driver runs the real game in
// Chromium through the stream page and plays it only the way a person would: touches on the
// screen. What it tells the player is what a person could see, written out as text.

export type Direction = "up" | "down" | "left" | "right";

/** What happened after an action, for the player: written from what's on screen, never from hidden state. */
export interface Outcome {
  /**
   * After a warp: where the player is now. In a battle: who they're facing, then the battle's text.
   * In a dialog or menu: the visible text and choices. After a plain move: a text map of the
   * screen around the player with a legend.
   */
  text: string;
}

/** A harness heuristic noticed something odd on screen (a flip to the Game Boy screen, the scene reloading). */
export interface Glitch {
  at: number;
  kind: string;
  text: string;
}

/** What the stream's header and the developer see; not given to the player. */
export interface GameStatus {
  map: string;
  playTime: string;
  fps: number | null;
}

export interface GameDriver {
  /** The game's on-screen size in CSS pixels: taps use this coordinate space, and screenshots match it. */
  readonly size: { width: number; height: number };
  /** Launches the browser on the stream page and waits for the game to be ready for a first touch. */
  start(): Promise<Outcome>;
  /** Reloads the game (picking up new code); it resumes from its autosave. */
  restart(): Promise<Outcome>;
  /** Marks the start of a player turn in the recording. */
  markTurn(turn: number): void;
  tap(x: number, y: number): Promise<Outcome>;
  /** Holds the on-screen joystick toward `direction` for about `tiles` steps. */
  joystick(direction: Direction, tiles: number): Promise<Outcome>;
  wait(ms: number): Promise<Outcome>;
  /** The game as it looks now, PNG. */
  screenshot(): Promise<Buffer>;
  /** A grid of recorded frames from `before` seconds before turn `turn` began to `after` seconds after, PNG. */
  contactSheet(turn: number, before: number, after: number, fps: number): Promise<Buffer>;
  /** Glitches noticed since the last call. */
  takeGlitches(): Glitch[];
  status(): Promise<GameStatus>;
  /** Writes evidence for a bug report into `dir` (screenshot, last seconds as a contact sheet, save, page state, console); returns the file names. */
  collectEvidence(dir: string, turn: number): Promise<string[]>;
  close(): Promise<void>;
}
