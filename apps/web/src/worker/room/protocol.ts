// Messages between a client and the room (p3-rooms). JSON text frames, validated with valibot on
// the way in. Moves to packages/protocol once that package lands (p3-link-hooks).
import * as v from "valibot";

const int = (min: number, max: number) => v.pipe(v.number(), v.integer(), v.minValue(min), v.maxValue(max));

/**
 * Where a friend is and what they're doing, mirroring the player half of p1-state-read's
 * `OverworldState` so their ghost walks exactly as they do. Coordinates are step cells on map
 * `mapId`; `step` is the step in progress.
 */
export const PresenceSchema = v.strictObject({
  mapId: int(0, 255),
  // Signed: the game briefly puts the player outside the map at a connection.
  x: int(-128, 255),
  y: int(-128, 255),
  facing: v.picklist(["down", "up", "left", "right"]),
  step: v.nullable(
    v.strictObject({
      dx: int(-1, 1),
      dy: int(-1, 1),
      progress: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
    }),
  ),
  animFrame: int(0, 3),
  transport: v.picklist(["walk", "bike", "surf"]),
  mode: v.picklist(["overworld", "dialog", "battle"]),
});
export type Presence = v.InferOutput<typeof PresenceSchema>;

export const ClientMessageSchema = v.variant("type", [
  /** My presence changed; null hides my ghost (e.g. on the title screen). */
  v.strictObject({ type: v.literal("presence"), presence: v.nullable(PresenceSchema) }),
]);
export type ClientMessage = v.InferOutput<typeof ClientMessageSchema>;

export interface PlayerInfo {
  id: string;
  name: string;
}

export type ServerMessage =
  /** First message on connect: who you are, and everyone else already here. */
  | { type: "welcome"; you: PlayerInfo; players: (PlayerInfo & { presence: Presence | null })[] }
  | { type: "joined"; player: PlayerInfo }
  | { type: "left"; id: string }
  | { type: "presence"; id: string; presence: Presence | null }
  | { type: "error"; reason: "bad-message" };

/** Frames longer than this are dropped unread. A presence update is ~200 bytes. */
export const MAX_FRAME = 1024;

/** WebSocket close codes the room uses (4000–4999 are application codes). */
export const CloseCode = {
  /** The same player connected again elsewhere (another tab or device). */
  replaced: 4001,
} as const;

/** Parses a frame from a client, or null if it isn't a valid message. */
export function parseClientMessage(frame: string | ArrayBuffer): ClientMessage | null {
  if (typeof frame !== "string" || frame.length > MAX_FRAME) return null;
  let json: unknown;
  try {
    json = JSON.parse(frame);
  } catch {
    return null;
  }
  const result = v.safeParse(ClientMessageSchema, json);
  return result.success ? result.output : null;
}
