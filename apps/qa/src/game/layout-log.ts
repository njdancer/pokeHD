// Every switch between the HD view and the Game Boy screen, timed in the page itself, so a flash
// of a single frame is caught however slowly the recording runs. `installLayoutLog` runs in every
// frame of the browser (context.addInitScript) and must stay self-contained; it logs to
// `window.__qaLayouts` whenever the game screen's `data-layout` changes.

export interface LayoutEntry {
  /** Date.now() in the page: the same clock as the driver's on the same machine. */
  t: number;
  layout: string;
}

/** Layouts that put the Game Boy screen's own graphics in front of the player. */
const GAME_BOY_VIEWS: Record<string, string> = { full: "full screen", dialog: "along the bottom", corner: "in the corner" };

export function installLayoutLog(): void {
  const w = window as unknown as { __qaLayouts?: { t: number; layout: string }[] };
  if (w.__qaLayouts) return;
  const log: { t: number; layout: string }[] = [];
  w.__qaLayouts = log;
  let last: string | null = null;
  const check = () => {
    const layout = document.querySelector('[data-testid="gb-screen"]')?.getAttribute("data-layout") ?? null;
    if (layout === null || layout === last) return;
    last = layout;
    log.push({ t: Date.now(), layout });
    if (log.length > 2000) log.splice(0, 1000);
  };
  new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-layout"] });
}

/**
 * What the Game Boy screen did between `from` and `to`, for the player, or null if it didn't
 * come and go. A screen that stayed in front the whole time isn't news (the outcome reads it).
 */
export function describeLayouts(log: readonly LayoutEntry[], from: number, to: number): string | null {
  let current = [...log].reverse().find((e) => e.t <= from)?.layout ?? null;
  let since = from;
  const shown: { ms: number; where: string }[] = [];
  let changes = 0;
  for (const e of log) {
    if (e.t <= from || e.t > to) continue;
    if (e.layout === current) continue;
    changes++;
    // A stretch already showing when the action began isn't a flash of this action's.
    const where = current ? GAME_BOY_VIEWS[current] : undefined;
    if (where && since > from) shown.push({ ms: e.t - since, where });
    current = e.layout;
    since = e.t;
  }
  if (!changes) return null;
  const now = (current && GAME_BOY_VIEWS[current]) ?? null;
  if (!shown.length && !now) return null;
  const times = shown.map((s) => `${(s.ms / 1000).toFixed(s.ms < 1000 ? 2 : 1)} s ${s.where}`);
  const parts = [];
  if (times.length) parts.push(`showed ${times.length === 1 ? "once" : `${times.length} times`} (${times.join(", ")})`);
  if (now) parts.push(`${times.length ? "and is" : "is"} in front now (${now})`);
  return `Screen: the original Game Boy screen ${parts.join(" ")}.`;
}
