// What every screen of the Pokédex menu can reach: the ROM and world, the game as it is now (a
// snapshot read through the emulator), the play journal, friends, and the way to ask the game to
// do something (an action, run with the game's own routine at its next idle point).
import { createContext, useContext, type ReactNode } from "react";
import type { ActionResult, GameAction, GameSnapshot } from "@pokehd/emu";
import type { WorldData } from "@pokehd/rom";
import type { Catalogue } from "../dex/catalogue.ts";
import type { Friend } from "../room/client.ts";
import type { PlayJournal } from "./journal.ts";

/** A page on top of a tab's list. */
export type Page =
  | { kind: "mon"; dex: number }
  | { kind: "team"; slot: number }
  | { kind: "item"; item: number }
  | { kind: "person"; key: string }
  | { kind: "friend"; id: string }
  | { kind: "place"; name: string }
  | { kind: "settings" }
  | { kind: "saves" };

export type Tab = "pokemon" | "people" | "inventory" | "map" | "me";

export interface MenuContext {
  rom: Uint8Array;
  world: WorldData;
  catalogue: Catalogue;
  /** The game as it is now; null until the first read. */
  game: GameSnapshot | null;
  journal: PlayJournal | null;
  /** The journal's version when last read: changes as the game runs behind the menu. */
  journalVersion: number;
  friends: readonly Friend[];
  /**
   * Has the game do it with its own routine. Waits (cancellably, on screen) while the game is busy
   * with a message; shows what the game said. Null if taken back.
   */
  act(action: GameAction): Promise<ActionResult | null>;
  open(page: Page): void;
  go(tab: Tab, page?: Page): void;
  back(): void;
  /** In a battle the menu is for looking only: the battle's own sheets do the rest. */
  lookOnly: boolean;
  /** When the game last saved (ms since 1970), 0 if not this session. */
  savedAt: number;
  /** The page's own grown-up settings, behind a sum on the Me tab. */
  grownUps?: ReactNode;
}

export const Menu = createContext<MenuContext>(null!);
export const useMenu = () => useContext(Menu);
