// Gifts between friends (D20): money, an item or a Pokémon, taken from the sender's game and
// saved there first, then held by the room until the receiver's game has saved it.
import * as v from "valibot";

const int = (min: number, max: number) => v.pipe(v.number(), v.integer(), v.minValue(min), v.maxValue(max));
const bytes = (length: number) => v.pipe(v.array(int(0, 0xff)), v.length(length));

/** The Trade Center's view of a Pokémon: the 44-byte party struct, its OT name and nickname. */
export const GiftedMonSchema = v.strictObject({
  data: bytes(44),
  ot: bytes(11),
  nick: bytes(11),
});
export type GiftedMon = v.InferOutput<typeof GiftedMonSchema>;

export const GiftSchema = v.variant("kind", [
  v.strictObject({ kind: v.literal("money"), amount: int(1, 999_999) }),
  v.strictObject({ kind: v.literal("item"), item: int(1, 0xff), quantity: int(1, 99) }),
  v.strictObject({ kind: v.literal("mon"), mon: GiftedMonSchema }),
]);
export type Gift = v.InferOutput<typeof GiftSchema>;

/** A gift's ID: the sender's client makes one (a UUID) so retries can't deliver it twice. */
export const GiftIdSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(64));
