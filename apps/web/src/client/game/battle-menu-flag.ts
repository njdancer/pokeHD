// HD battle menus (p2-tapfirst, D44) are on by default. `?battlemenus=0` turns them off on this
// device (the Game Boy's own menus, e.g. to compare) and `?battlemenus` turns them back on; the
// choice is remembered on the device, so it sticks in a home-screen app opened once with the link.
const KEY = "pokehd.battleMenus";

/** Whether this device uses the HD battle menus. */
export function battleMenusOn(search = location.search): boolean {
  const asked = new URLSearchParams(search).get("battlemenus");
  const value = asked === null ? null : asked === "0" ? "off" : "on";
  try {
    if (value) localStorage.setItem(KEY, value);
    const stored = value ?? localStorage.getItem(KEY);
    // "0": the trial's way of saying off.
    return stored !== "off" && stored !== "0";
  } catch {
    return value !== "off";
  }
}
