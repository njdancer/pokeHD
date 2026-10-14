// Where the menu is: a stack of screens per tab (each tab keeps its place), or one stack in a
// game request's sheet. Screens push and pop; a purpose ("use this POTION on…") rides along.
import { createContext, useContext } from "react";
import type { TabId } from "./icons.tsx";
import type { ItemKind } from "./model.ts";

/** Why a list is being shown: to pick something for an action already started. */
export type Purpose =
  /** Pick a Pokémon to use this item on. */
  | { use: number }
  /** Pick a Pokémon to teach this TM or HM. */
  | { teach: number }
  /** Pick a Pokémon or an item to send to this friend. */
  | { giftTo: string }
  /** Pick an item to use on this Pokémon. */
  | { onMon: number };

export type Screen =
  | { k: "dex" }
  | { k: "entry"; dex: number }
  | { k: "people" }
  | { k: "person"; key: string }
  | { k: "friend"; id: string }
  | { k: "inv" }
  | { k: "mon"; i: number; for?: Purpose }
  | { k: "item"; id: number; for?: Purpose }
  | { k: "team"; for: Purpose }
  | { k: "bag"; for: Purpose }
  /** How many to buy from the Mart's shelf, or to sell it from the bag (the shop's sheet). */
  | { k: "buy"; item: { id: number; name: string; price: number; kind: ItemKind } }
  | { k: "sell"; id: number }
  | { k: "map"; focus?: string }
  | { k: "me" }
  | { k: "settings" }
  | { k: "grownups" }
  | { k: "saves" };

export interface Nav {
  /** Depth of the current stack: the back button shows past 1. */
  depth: number;
  go(s: Screen): void;
  back(): void;
  /** Replaces the top screen (after an action finishes a pick). */
  replace(s: Screen): void;
  /** Back to the root of the stack, optionally then on to a screen. */
  reset(s?: Screen): void;
  /** Another tab, optionally at a screen inside it. In a sheet, does nothing. */
  tab(t: TabId, s?: Screen): void;
  /** Closes the dex (or ends the sheet's request). */
  close(): void;
  /** In a game request's sheet rather than the dex. */
  sheet: boolean;
}

export const NavContext = createContext<Nav | null>(null);

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error("Pokédex screen outside a stack");
  return nav;
}

export const rootOf = (t: TabId): Screen => ({ k: t });

/** The tab a screen belongs to when opened from elsewhere ("Show on the map"). */
export const TABS: { id: TabId; label: string }[] = [
  { id: "dex", label: "Pokémon" },
  { id: "people", label: "People" },
  { id: "inv", label: "Inventory" },
  { id: "map", label: "Map" },
  { id: "me", label: "Me" },
];

/** Each tab's stack cut back to below its first screen with a purpose (a one-off pick). */
export function withoutPicks<P extends { stacks: Record<TabId, Screen[]> }>(place: P): P {
  let changed = false;
  const stacks = { ...place.stacks };
  for (const t of Object.keys(stacks) as TabId[]) {
    const at = stacks[t].findIndex((s) => "for" in s && s.for !== undefined);
    if (at < 0) continue;
    // The root always stays.
    stacks[t] = stacks[t].slice(0, Math.max(at, 1));
    changed = true;
  }
  return changed ? { ...place, stacks } : place;
}
