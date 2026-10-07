// Where the Game Boy's own screen goes on the game page. The HD view shows the overworld; the
// 2D screen is the only place text, menus and battles appear until they get HD versions (p2-text).
import type { OverworldMode, OverworldWatched } from "@pokehd/emu";

/**
 * `full`: centred and large, the HD view only behind it (title screen, intro, battles).
 * `dialog`: large along the bottom, so text boxes and menus can be read over the HD view.
 * `corner`: picture-in-picture. `hidden`: the HD view alone.
 */
export type ScreenLayout = "full" | "dialog" | "corner" | "hidden";

/**
 * Whether a map has loaded since the game started. The game clears WRAM on every (re)start,
 * so wCurMapHeight and wCurMapWidth stay 0 through the title screen and the new-game intro.
 */
export const mapLoaded = (watched: Pick<OverworldWatched, "mapHeader">) =>
  (watched.mapHeader[1] ?? 0) > 0 && (watched.mapHeader[2] ?? 0) > 0;

/** `pip` is the player's choice for the overworld: the small screen in the corner, or none. */
export function screenLayout(mode: OverworldMode, inWorld: boolean, pip: boolean): ScreenLayout {
  if (!inWorld || mode === "battle") return "full";
  if (mode === "dialog") return "dialog";
  return pip ? "corner" : "hidden";
}
