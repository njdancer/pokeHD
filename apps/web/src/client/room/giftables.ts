// What the gift panel offers: the party, bag and money as the game holds them right now, read
// in one go from WRAM and named from the ROM.
import { fromBcd, type Watch } from "@pokehd/emu";
import type { Gift } from "@pokehd/protocol";
import { decodeText, isKeyItem, itemName, monName, SYMBOLS } from "@pokehd/rom";

const MON = 44;
const NAME = 11;
const LEVEL = 33;

export const GIFTABLE_RANGES: readonly Watch[] = [
  [SYMBOLS.wPartyCount.address, 1],
  [SYMBOLS.wPartySpecies.address, 6],
  [SYMBOLS.wPartyMons.address, MON * 6],
  [SYMBOLS.wPartyMonNicks.address, NAME * 6],
  [SYMBOLS.wNumBagItems.address, 41],
  [SYMBOLS.wPlayerMoney.address, 3],
];

export interface GiftableMon {
  slot: number;
  species: number;
  speciesName: string;
  nick: string;
  level: number;
}
export interface GiftableItem {
  slot: number;
  item: number;
  name: string;
  quantity: number;
  /** Key items can't be gifted (D20). */
  key: boolean;
}
export interface Giftables {
  party: GiftableMon[];
  bag: GiftableItem[];
  money: number;
}

export function decodeGiftables(rom: Uint8Array, bytes: readonly Uint8Array[]): Giftables {
  const [count, species, mons, nicks, bagBytes, money] = bytes as [Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array];
  const party: GiftableMon[] = [];
  for (let slot = 0; slot < Math.min(count[0]!, 6); slot++) {
    const s = species[slot]!;
    party.push({
      slot,
      species: s,
      speciesName: monName(rom, s),
      nick: decodeText(nicks.subarray(slot * NAME, slot * NAME + NAME)),
      level: mons[slot * MON + LEVEL]!,
    });
  }
  const bag: GiftableItem[] = [];
  for (let slot = 0; slot < Math.min(bagBytes[0]!, 20); slot++) {
    const item = bagBytes[1 + slot * 2]!;
    bag.push({ slot, item, name: itemName(rom, item), quantity: bagBytes[2 + slot * 2]!, key: isKeyItem(rom, item) });
  }
  return { party, bag, money: fromBcd(money) };
}

/** "¥500", "POTION ×3", "SPARKY (PIKACHU, Lv 12)". */
export function describeGift(rom: Uint8Array, gift: Gift): string {
  switch (gift.kind) {
    case "money":
      return `¥${gift.amount.toLocaleString("en-US")}`;
    case "item":
      return `${itemName(rom, gift.item)} ×${gift.quantity}`;
    case "mon": {
      const species = monName(rom, gift.mon.data[0]!);
      const nick = decodeText(gift.mon.nick);
      const level = gift.mon.data[LEVEL]!;
      return nick && nick !== species ? `${nick} (${species}, Lv ${level})` : `${species} (Lv ${level})`;
    }
  }
}

/** Why a gift didn't go, in words. */
export const GIFT_REASONS: Record<string, string> = {
  "last Pokémon": "You can't give away your last Pokémon.",
  "key item": "Key items can't be gifted.",
  "not enough money": "You don't have that much money.",
  "not enough": "You don't have that many.",
  "item moved": "Your bag changed. Try again.",
  "party changed": "Your party changed. Try again.",
};
