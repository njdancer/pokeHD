// Where the Game Boy's own screen goes on the game page. The HD view shows the overworld; the
// 2D screen shows battles, and the text and menus the HD text layer can't draw (p2-text).
import type { OverworldMode, OverworldWatched } from "@pokehd/emu";

/**
 * `full`: centred and large, the HD view only behind it (title screen, intro, full-screen menus).
 * `battle`: over the HD battle like a dialog, with the scene and HUD cells cut out.
 * `dialog`: large along the bottom, so text boxes and menus can be read over the HD view.
 * `corner`: picture-in-picture. `hidden`: the HD view alone.
 */
export type ScreenLayout = "full" | "battle" | "dialog" | "corner" | "hidden";

/**
 * What a battle shows, for the layout: `scene`, the battle screen (drawn in HD, with text and
 * menus over it); `transition`, the way into a battle before the battle screen appears, and the
 * way out until the map is back (the HD view plays both); `menu`, a full-screen menu (party,
 * Pokédex); `evolution`, the evolution screen, after a battle or from an evolution stone (drawn in
 * HD like the battle screen, its text in HD boxes; QA bug 27).
 */
export type BattleScene = "scene" | "transition" | "menu" | "evolution";

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

/**
 * Tracks whether the window is up over nothing but the map, so the HD view can stay in front.
 * Maps whose script sets BIT_NO_AUTO_TEXT_BOX (Oak's lab, marts, the museum and others) open
 * every text without a box: DisplayTextIDInit copies the plain screen buffer to the window and
 * puts it up (hWY = 0), then LoadFontTilePatterns copies the font over about 17 frames, and only
 * then does PrintText draw the message box. For that quarter second the game shows the map
 * exactly as it was, so there's nothing for the Game Boy screen to add. The screen buffer is
 * compared with the one from the last frame the window was down; anything drawn into it (a
 * box, a menu, a full-screen picture) makes it differ.
 */
export function mapOnlyTracker() {
  let map: Uint8Array | null = null;
  return (tileMap: Uint8Array, mode: OverworldMode, inWorld: boolean): boolean => {
    if (!inWorld || mode === "battle") {
      map = null;
      return false;
    }
    if (mode === "overworld") {
      if (map?.length !== tileMap.length) map = new Uint8Array(tileMap.length);
      map.set(tileMap);
      return false;
    }
    return map !== null && map.length === tileMap.length && map.every((b, i) => b === tileMap[i]);
  };
}

/**
 * `pip` is the player's choice for the overworld: the small screen in the corner, or none.
 * `hdText` is true while the HD text layer shows the game's text and menus (p2-text), so the
 * screen needn't come up for them (or while the window shows only the map, see
 * `mapOnlyTracker`). `battle` is what a battle shows, when there's an HD view to
 * show it in (p2-battles). `onboarding` is true while the page's own start screen or Oak's HD
 * introduction is showing (tap-first UI).
 */
export function screenLayout(mode: OverworldMode, inWorld: boolean, pip: boolean, hdText = false, battle?: BattleScene, onboarding = false): ScreenLayout {
  // The page's own start screen and HD introduction stand in for the screen until the world loads.
  if (!inWorld && onboarding) return "hidden";
  // The evolution screen is staged in HD, battle or not: the screen keeps only text the HD layer can't draw.
  if (inWorld && battle === "evolution") return "battle";
  if (inWorld && mode === "battle" && battle) return battle === "scene" ? "battle" : battle === "transition" ? "hidden" : "full";
  // Either side of a battle the game puts the window up over its transition (a trainer's spiral,
  // the faded-out last frame) before wIsInBattle says so: nothing there the HD view doesn't play.
  if (inWorld && mode === "dialog" && battle === "transition") return pip ? "corner" : "hidden";
  if (!inWorld || mode === "battle") return "full";
  if (mode === "dialog" && !hdText) return "dialog";
  return pip ? "corner" : "hidden";
}
