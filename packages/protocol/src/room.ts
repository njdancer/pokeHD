// Messages between a client and the room (p3-rooms). JSON text frames, validated with valibot on
// the way in.
import * as v from "valibot";
import { GiftIdSchema, GiftSchema, type Gift } from "./gift.ts";
import { LinkMessageSchema, type LinkMessage } from "./link.ts";

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
  /** A link cable message (D17) for the friend with player ID `to`. The room relays it as is. */
  v.strictObject({
    type: v.literal("link"),
    to: v.pipe(v.string(), v.maxLength(64)),
    message: LinkMessageSchema,
  }),
  /**
   * A gift for player `to`, already taken out of the sender's game and saved there (D20). The
   * room keeps it until the receiver acknowledges it; resending the same `id` is harmless.
   */
  v.strictObject({
    type: v.literal("gift"),
    to: v.pipe(v.string(), v.maxLength(64)),
    id: GiftIdSchema,
    gift: GiftSchema,
  }),
  /** A gift addressed to me is in a save: the room can forget it. */
  v.strictObject({ type: v.literal("gift-ack"), id: GiftIdSchema }),
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
  /** A link cable message from the friend with player ID `from`, in the order they sent it. */
  | { type: "link"; from: string; message: LinkMessage }
  /**
   * A gift for me, sent on arrival and again on every connect until I `gift-ack` it. `from`
   * is the sender as they were when they sent it.
   */
  | { type: "gift"; id: string; from: PlayerInfo; gift: Gift }
  /** The room has stored the gift I sent with this `id`; the sender can drop it from its outbox. */
  | { type: "gift-stored"; id: string }
  /**
   * `bad-message`: a frame that wasn't a valid message. `not-here`: a link message for someone
   * who isn't connected (it was dropped; `to` says who). `replaced`: the same player connected
   * elsewhere; sent just before the room closes this socket with `CloseCode.replaced`, because
   * a browser may not report that close until the TCP connection ends.
   */
  | { type: "error"; reason: "bad-message" }
  | { type: "error"; reason: "replaced" }
  | { type: "error"; reason: "not-here"; to: string };

/**
 * Frames longer than this are dropped unread. A presence update is ~200 bytes; the biggest link
 * message, a full `bytes` block, is under 2 KB.
 */
export const MAX_FRAME = 4096;

/** WebSocket close codes the room uses (4000–4999 are application codes). */
export const CloseCode = {
  /** The same player connected again elsewhere (another tab or device). */
  replaced: 4001,
  /** Nothing heard for ROOM_QUIET_MS: the device is closed, asleep or offline (D40). */
  quiet: 4002,
} as const;

/** How often a connected device pings the room (its heartbeat). */
export const ROOM_KEEPALIVE_MS = 5_000;
/** A connection silent this long is closed, and its ghost leaves the world (D40). */
export const ROOM_QUIET_MS = 15_000;

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

// Server → client, for the room client (p3-rooms-client). The room builds these itself, so it
// doesn't parse them; the client does, so a newer or broken server can't put junk in its store.

const PlayerInfoSchema = v.object({
  id: v.pipe(v.string(), v.maxLength(64)),
  name: v.pipe(v.string(), v.maxLength(64)),
});

export const ServerMessageSchema = v.variant("type", [
  v.object({
    type: v.literal("welcome"),
    you: PlayerInfoSchema,
    players: v.array(v.object({ ...PlayerInfoSchema.entries, presence: v.nullable(PresenceSchema) })),
  }),
  v.object({ type: v.literal("joined"), player: PlayerInfoSchema }),
  v.object({ type: v.literal("left"), id: v.string() }),
  v.object({ type: v.literal("presence"), id: v.string(), presence: v.nullable(PresenceSchema) }),
  v.object({ type: v.literal("link"), from: v.string(), message: LinkMessageSchema }),
  v.object({ type: v.literal("gift"), id: GiftIdSchema, from: PlayerInfoSchema, gift: GiftSchema }),
  v.object({ type: v.literal("gift-stored"), id: GiftIdSchema }),
  v.variant("reason", [
    v.object({ type: v.literal("error"), reason: v.literal("bad-message") }),
    v.object({ type: v.literal("error"), reason: v.literal("replaced") }),
    v.object({ type: v.literal("error"), reason: v.literal("not-here"), to: v.string() }),
  ]),
]);

/** Parses a frame from the room, or null if it isn't a valid message. */
export function parseServerMessage(frame: unknown): ServerMessage | null {
  if (typeof frame !== "string") return null;
  let json: unknown;
  try {
    json = JSON.parse(frame);
  } catch {
    return null;
  }
  const result = v.safeParse(ServerMessageSchema, json);
  return result.success ? result.output : null;
}
