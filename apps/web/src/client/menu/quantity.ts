// How many the Poké Mart's quantity picker offers, and what it costs: the game's own rules, so the
// HD picker only offers what the game would then do. The game still decides: the picker's number
// answers the game's DisplayChooseQuantityMenu and its "OK?" (LiveActions.buy, .sell), and the
// game's DisplayPokemartDialogue_ checks the money and the bag and moves them itself.
//
// - Buying: the game's menu runs 1 to 99 (wMaxItemQuantity = 99) whatever the money, and only
//   after "OK?" says "You don't have enough money." (.isThereEnoughMoney: wPlayerMoney against
//   the total in hMoney) or "You have no more room for items!" (AddItemToInventory_ failing). The
//   picker stops at the most that would go through, so the player never chooses a refusal.
// - Selling: up to the count in the chosen stack (DisplayListMenuID sets wMaxItemQuantity from
//   the list entry), at half the total (DisplayChooseQuantityMenu halves price × count, rounding
//   down), added with AddBCD, which stops at ₽999999.

/** A stack in the bag: its item and how many (key items count 1). */
export interface Stack {
  item: number;
  quantity: number;
}

/** The game's limits: wMaxItemQuantity when buying, the slots in the bag, the money display. */
export const MAX_QUANTITY = 99;
export const BAG_ITEM_CAPACITY = 20;
export const MAX_MONEY = 999_999;

/**
 * Whether AddItemToInventory_ would take `count` more of `item`: onto its stacks in order, each up
 * to 99, the rest into a new stack if fewer than 20 are in use (the check is made once, against the
 * bag as it was). Fails when the rest has nowhere to go.
 */
export function bagTakes(bag: readonly Stack[], item: number, count: number): boolean {
  const free = bag.length < BAG_ITEM_CAPACITY;
  let left = count;
  for (const s of bag) {
    if (s.item !== item) continue;
    // Below 100 it all fits in this stack.
    if (s.quantity + left < 100) return true;
    // Fill this one to 99 and carry on with the rest, if a new stack could take it.
    if (!free) return false;
    left = s.quantity + left - 99;
  }
  return free;
}

/** The most the Mart would sell: by the money for `price` each, the room in the bag, and 99. */
export function buyMax(money: number, price: number, bag: readonly Stack[], item: number): number {
  let n = price > 0 ? Math.min(MAX_QUANTITY, Math.floor(money / price)) : MAX_QUANTITY;
  while (n > 0 && !bagTakes(bag, item, n)) n--;
  return n;
}

/** The most the Mart would buy back: the stack's count (99 at most), or 0 if it won't take it. */
export function sellMax(stack: number, price: number): number {
  return price > 0 ? Math.min(MAX_QUANTITY, stack) : 0;
}

/** What `count` cost: price × count, as DisplayChooseQuantityMenu sums it. */
export function buyTotal(price: number, count: number): number {
  return price * count;
}

/** What the Mart pays for `count`: half of price × count, rounded down (DivideBCDPredef3 by 2). */
export function sellTotal(price: number, count: number): number {
  return Math.floor((price * count) / 2);
}

/** The money after: less the cost, or plus the pay up to ₽999999 (AddBCD fills with 9s). */
export function moneyAfter(money: number, total: number, selling: boolean): number {
  return selling ? Math.min(MAX_MONEY, money + total) : money - total;
}

/** Why the picker stops where it does, in words for the player. */
export function limitOf(mode: "buy" | "sell", max: number, money: number, price: number, have: number): string {
  if (mode === "sell") return max === 1 ? "You have 1" : `You have ${max}`;
  if (max === 0) return price > money ? "Not enough money" : "No room in your bag";
  if (max === MAX_QUANTITY) return "Up to 99 at a time";
  if (price * (max + 1) > money) return `You can afford ${max}`;
  return have > 0 ? `Room for ${max} more in your bag` : `Room for ${max} in your bag`;
}
