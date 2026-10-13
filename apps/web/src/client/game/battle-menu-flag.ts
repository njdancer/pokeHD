// HD battle menus (p2-tapfirst) are a trial until Nick picks them: off unless turned on for this
// device. `?battlemenus` (or `=moves`) turns them on with the moves up front, `=classic` with the
// game's four choices first, and `=0` off again; the choice is remembered on the device, so it
// sticks in a home-screen app opened once with the link.
export const BATTLE_MENU_LAYOUTS = ["moves", "classic"] as const;
export type BattleMenuLayout = (typeof BATTLE_MENU_LAYOUTS)[number];

const KEY = "pokehd.battleMenus";

/** The layout for this device, or null while HD battle menus are off. */
export function battleMenuLayout(search = location.search): BattleMenuLayout | null {
  const asked = new URLSearchParams(search).get("battlemenus");
  let stored: string | null = null;
  try {
    if (asked !== null) localStorage.setItem(KEY, asked === "" ? "moves" : asked);
    stored = localStorage.getItem(KEY);
  } catch {
    stored = asked === "" ? "moves" : asked;
  }
  return BATTLE_MENU_LAYOUTS.find((l) => l === stored) ?? null;
}
