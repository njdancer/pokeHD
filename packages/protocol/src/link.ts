// Link cable messages (D17): what one player's emulator sends the other's when the game enters
// one of its hooked link routines. The room relays them in order and never looks inside; both
// sides pair the n-th message of a kind with their own n-th call of that routine.
import * as v from "valibot";

const byte = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(0xff));

/**
 * The longest `Serial_ExchangeBytes` block, plus one: the party block is
 * 6 + 11 + 1 + 6 + 1 + (44 + 11 * 2) * 6 + 3 = 424 bytes.
 */
export const MAX_LINK_BLOCK = 512;

export const LinkMessageSchema = v.variant("kind", [
  /**
   * The player is at the Cable Club receptionist and wants to connect. Starts a new session:
   * the receiver drops anything still queued from the sender's previous one.
   */
  v.object({ kind: v.literal("connect") }),
  /** The player gave up waiting at the receptionist; withdraws an unanswered `connect`. */
  v.object({ kind: v.literal("cancel") }),
  /** `Serial_ExchangeBytes`: random numbers, party data, patch lists. */
  v.object({ kind: v.literal("bytes"), data: v.pipe(v.array(byte), v.maxLength(MAX_LINK_BLOCK)) }),
  /** `Serial_SyncAndExchangeNybble`: receptionist, trade choice, cancel. */
  v.object({ kind: v.literal("nybble"), value: byte }),
  /** `LinkBattleExchangeData`: the action for one battle turn. */
  v.object({ kind: v.literal("battle"), value: byte }),
  /** `Serial_ExchangeLinkMenuSelection`: the room menu's cursor and buttons, every poll. */
  v.object({ kind: v.literal("menu"), data: v.pipe(v.array(byte), v.length(2)) }),
]);

export type LinkMessage = v.InferOutput<typeof LinkMessageSchema>;
export type LinkMessageKind = LinkMessage["kind"];

/** Validates a message from the network; throws a `ValiError` if it isn't one. */
export function parseLinkMessage(input: unknown): LinkMessage {
  return v.parse(LinkMessageSchema, input);
}
