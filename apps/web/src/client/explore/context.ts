import { createContext, useContext, useSyncExternalStore } from "react";
import type { LabelDb } from "@pokehd/rom/explore";
import type { Route } from "./format.ts";
import type { EmuSession } from "./session.ts";

export interface Explorer {
  rom: Uint8Array;
  db: LabelDb;
  /** Null until the player boots the emulator. */
  session: EmuSession | null;
  route: Route;
  go(route: Route): void;
}

export const ExplorerContext = createContext<Explorer>(null!);
export const useExplorer = () => useContext(ExplorerContext);

const noop = () => () => {};
/** Re-renders the caller when the emulator changes (a few times a second while it runs). */
export function useEmuVersion(session: EmuSession | null): number {
  return useSyncExternalStore(session?.subscribe ?? noop, session?.getVersion ?? (() => 0));
}
