// What the QA harness tells the stream page and the developer: one event per line in the run's
// events.jsonl, and the same events over the bus's SSE stream (GET /events). GET /snapshot
// returns the latest status, the last 40 feed items, the chat and the bug list.

/** Playing, or the game paused while the player talks to the developer. */
export type StreamMode = "play" | "talk";

export interface StatusEvent {
  t: "status";
  mode: StreamMode;
  turn: number;
  /** "Route 1": the map the player is on, from the game. */
  map: string;
  /** Play time as the game counts it, "h:mm". */
  playTime: string;
  fps: number | null;
  /** The player's generation: a new one each time its conversation starts afresh (a new chapter or a harness start). */
  gen?: number;
  /** The run's turn when this generation began. */
  genStart?: number;
}

/** The player's one-line note before an action (the stream's "thinking" rows). */
export interface ThoughtEvent {
  t: "thought";
  id: number;
  at: number;
  turn: number;
  text: string;
}

export type ActionKind = "tap" | "joystick" | "wait" | "screenshot" | "contact_sheet" | "notebook" | "report_bug" | "message";

/** Something the player did: "tap PARTY", "joystick ↑ 4 tiles", "contact sheet −1s…+2s". */
export interface ActionEvent {
  t: "action";
  id: number;
  at: number;
  turn: number;
  kind: ActionKind;
  label: string;
}

/** "prompt": the developer changed the player's instructions, so the player starts a new chapter to load them. */
export type ChatTag = "bug" | "fixed" | "harness" | "question" | "note" | "prompt";

export interface ChatEvent {
  t: "chat";
  id: number;
  at: number;
  from: "player" | "developer";
  tag?: ChatTag;
  /** The bug the message is about, when there is one. */
  bug?: number;
  text: string;
}

export type Severity = "high" | "med" | "low";
export type BugStatus = "open" | "fixing" | "fixed" | "wontfix";

export interface Bug {
  id: number;
  at: number;
  turn: number;
  title: string;
  severity: Severity;
  status: BugStatus;
  steps: string;
  expected: string;
  actual: string;
  /** Files in the run's bugs/<id>/ folder: screenshot, contact sheet, save, page state. */
  attachments: string[];
}

export interface BugsEvent {
  t: "bugs";
  /** Highest priority first: severity, then open before fixing before fixed. */
  list: Bug[];
}

/** A harness heuristic that thinks the screen did something odd. */
export interface GlitchEvent {
  t: "glitch";
  id: number;
  at: number;
  turn: number;
  kind: string;
  text: string;
}

export type QaEvent = StatusEvent | ThoughtEvent | ActionEvent | ChatEvent | BugsEvent | GlitchEvent;

export interface Snapshot {
  status: StatusEvent | null;
  feed: (ThoughtEvent | ActionEvent)[];
  chat: ChatEvent[];
  bugs: Bug[];
  glitches: GlitchEvent[];
}

const SEVERITY: Record<Severity, number> = { high: 0, med: 1, low: 2 };
const STATUS: Record<BugStatus, number> = { open: 0, fixing: 1, fixed: 2, wontfix: 3 };

/** Priority order for the bug tracker: unfixed first, then severity, then newest. */
export function byPriority(a: Bug, b: Bug): number {
  const done = (s: BugStatus) => (s === "fixed" || s === "wontfix" ? 1 : 0);
  return done(a.status) - done(b.status) || SEVERITY[a.severity] - SEVERITY[b.severity] || STATUS[a.status] - STATUS[b.status] || b.id - a.id;
}
