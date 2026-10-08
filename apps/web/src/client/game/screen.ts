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
 * Tracks whether the game is in the overworld, from each frame's watched bytes.
 * Three things make a loaded map header misleading on its own:
 * - before the game's init clears WRAM, it holds whatever the console powered up with;
 * - the title screen and new-game intro run with the header still cleared (that part's fine);
 * - with a save, the main menu loads it, map and all, to preview it.
 * So the answer turns true only after WRAM has been seen cleared and then EnterMap has set its
 * map-loaded flag (BIT_CUR_MAP_LOADED_2; the Continue screen sets only the first one), and it
 * holds until the map header clears again (a reset). After resuming from a resume point (only
 * ever taken in the world), `resumed` says the loaded map is already the world.
 */
export function inWorldTracker(resumed = false) {
  let cleared = resumed;
  let inWorld = resumed;
  return (watched: Pick<OverworldWatched, "mapHeader" | "mapScriptFlags">): boolean => {
    const mapLoaded = (watched.mapHeader[1] ?? 0) > 0 && (watched.mapHeader[2] ?? 0) > 0;
    if (!mapLoaded) cleared = true;
    inWorld = cleared && mapLoaded && (inWorld || ((watched.mapScriptFlags[0] ?? 0) & 0b0100_0000) !== 0);
    return inWorld;
  };
}

/** `pip` is the player's choice for the overworld: the small screen in the corner, or none. */
export function screenLayout(mode: OverworldMode, inWorld: boolean, pip: boolean): ScreenLayout {
  if (!inWorld || mode === "battle") return "full";
  if (mode === "dialog") return "dialog";
  return pip ? "corner" : "hidden";
}
