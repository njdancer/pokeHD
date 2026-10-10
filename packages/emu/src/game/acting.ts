// Which Game Boys are running one of the Pokédex menu's actions that prints (GameActions): the
// action answers its own text waits, so ScriptText leaves its messages alone.
import type { GameBoy } from "../core.ts";

export const acting = new WeakSet<GameBoy>();
