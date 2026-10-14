// What the game page shows, read inside the game's frame (Frame.evaluate). `readScreen` is
// serialised into the page, so it must stay self-contained: no imports, no outer helpers. It
// reads the DOM the way a person sees it (text panels, buttons and where they are) and the decoded
// state the page exposes with ?stats, which the driver uses only to time actions, draw the visible
// map and notice glitches, never to tell the player hidden things.

/** A decoded actor, as `__pokehd.state` gives it (see @pokehd/emu's overworld.ts). */
export interface ActorLite {
  x: number;
  y: number;
  facing: "down" | "up" | "left" | "right";
  step: unknown;
  visible?: boolean;
  pictureId?: number;
  slot?: number;
}
export interface StateLite {
  mode: "overworld" | "dialog" | "battle";
  mapId: number;
  fade: number;
  player: ActorLite;
  npcs: ActorLite[];
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Panel {
  /** start, name, message, menu, dialog, battle-menu, battle-card, toast, lock. */
  kind: string;
  text: string;
  /** For menus: the line the cursor is on. */
  cursor?: string;
  /** For the message box: its ▼ is up, so a tap reads on (QA bug 56). */
  waiting?: boolean;
}
export interface ScreenButton extends Rect {
  label: string;
  /** Part of the on-screen joypad. */
  pad: boolean;
}
export interface ScreenRead {
  /** The page exposes `__pokehd` (the game component is up). */
  hooked: boolean;
  state: StateLite | null;
  inWorld: boolean;
  frames: number;
  /** The Game Boy screen's `data-layout` ("full" is the Game Boy view). */
  layout: string;
  /** The loading screen is up (and not fading out). */
  loading: boolean;
  /** A menu in front holds the game (it's paused on purpose). */
  held: boolean;
  visible: boolean;
  fps: number | null;
  /** Long display frames recorded after `slowSince` (page time, ms). */
  slow: { at: number; ms: number }[];
  panels: Panel[];
  buttons: ScreenButton[];
  joystick: Rect | null;
  /** A text box is still typing out (the HD box has no ▼ yet but the game is in a dialog). */
  printing: boolean;
  now: number;
}

export function readScreen(arg: { slowSince: number }): ScreenRead {
  type W = Window & {
    __pokehd?: { state: unknown; inWorld: boolean; frames: number; page: { held?: unknown }; slow: { at: number; ms: number }[] };
  };
  const hook = (window as W).__pokehd;
  const vw = innerWidth;
  const vh = innerHeight;
  const shown = (el: Element): DOMRect | null => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return null;
    for (let e: Element | null = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.05) return null;
    }
    return r;
  };
  const clean = (s: string) => s.replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  const loadingEl = document.querySelector('[data-testid="loading"]');
  const loading = !!loadingEl && !loadingEl.hasAttribute("data-leaving") && !!shown(loadingEl);

  const PANELS: [string, string][] = [
    ['[data-testid="start-screen"]', "start"],
    ['[data-testid="name-prompt"]', "name"],
    [".hd-box.dialog", "message"],
    [".hd-box.menu", "menu"],
    [".hd-box", "box"],
    ['[role="dialog"]', "dialog"],
    ['[role="alertdialog"]', "dialog"],
    // The HD battle menu: in front of the Game Boy screen, whose tiles behind it (the move list,
    // the TYPE box) are hidden and must not be read out as if on screen (QA bug 51).
    ['[data-testid="battle-menu"]', "battle-menu"],
    [".battle-card", "battle-card"],
    [".game-toast", "toast"],
    ['[role="status"]:not([data-testid="loading"])', "toast"],
  ];
  const panels: Panel[] = [];
  const taken: Element[] = [];
  for (const [sel, kind] of PANELS) {
    for (const el of document.querySelectorAll(sel)) {
      if (taken.some((t) => t === el || t.contains(el))) continue;
      if (el.closest(".game-stats, .touch-pad")) continue;
      if (!shown(el)) continue;
      const text = clean((el as HTMLElement).innerText ?? "");
      taken.push(el);
      if (!text) continue;
      const cursorRow = el.querySelector(".hd-pick.selected, .hd-cursor.selected");
      const row = cursorRow?.closest(".hd-row, .hd-choice");
      const cursor = row ? clean((row as HTMLElement).innerText) : undefined;
      // A message box's ▼: the game waits for a tap (without it, a tap does nothing yet).
      const waiting = kind === "message" ? { waiting: !!el.querySelector(".hd-more") } : {};
      panels.push({ kind: el.classList.contains("battle-card") ? `battle-card ${el.getAttribute("data-testid")?.replace("battle-hud-", "") ?? ""}`.trim() : kind, text, ...(cursor ? { cursor } : {}), ...waiting });
    }
  }

  const buttons: ScreenButton[] = [];
  const BUTTONS = 'button, a[href], [role="button"], input:not([type="hidden"]), select, textarea, .hd-box.tappable';
  for (const el of document.querySelectorAll(BUTTONS)) {
    if (el.closest(".game-stats")) continue;
    const r = shown(el);
    if (!r) continue;
    const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
    const cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(cx, cy);
    if (!hit || !(hit === el || el.contains(hit))) continue;
    if ((el as HTMLButtonElement).disabled) continue;
    const h = el as HTMLElement;
    let label = h.getAttribute("aria-label") ?? "";
    if (!label && el.classList.contains("hd-box")) label = "message box (tap to read on)";
    if (!label && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      label = `text field${el.value ? ` "${el.value}"` : ""}${el.placeholder ? ` (${el.placeholder})` : ""}`;
    }
    if (!label && el instanceof HTMLSelectElement) label = `choice "${el.selectedOptions[0]?.text ?? ""}"`;
    if (!label) label = clean(h.innerText ?? "").replace(/\n/g, " ");
    if (!label) label = h.getAttribute("title") ?? "";
    if (!label) continue;
    buttons.push({ label, pad: !!el.closest(".touch-pad"), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  }
  const stick = document.querySelector('[aria-label="Joystick"]');
  const sr = stick ? shown(stick) : null;
  const joystick = sr ? { x: Math.round(sr.left), y: Math.round(sr.top), w: Math.round(sr.width), h: Math.round(sr.height) } : null;
  const screen = document.querySelector('[data-testid="gb-screen"]');
  const stats = document.querySelector('[data-testid="stats"]');
  const fps = stats ? Number(stats.getAttribute("data-fps")) : NaN;
  const state = hook?.state ? (JSON.parse(JSON.stringify(hook.state)) as StateLite) : null;
  const dialogBox = document.querySelector(".hd-box.dialog");
  const printing = !!dialogBox && !dialogBox.querySelector(".hd-more") && !document.querySelector(".hd-box.menu.active");
  return {
    hooked: !!hook,
    state,
    inWorld: !!hook?.inWorld,
    frames: hook?.frames ?? 0,
    layout: screen?.getAttribute("data-layout") ?? "",
    loading,
    held: !!hook?.page?.held,
    visible: document.visibilityState === "visible",
    fps: Number.isFinite(fps) ? fps : null,
    slow: (hook?.slow ?? []).filter((s) => s.at > arg.slowSince).map((s) => ({ at: s.at, ms: s.ms })),
    panels,
    buttons,
    joystick,
    printing,
    now: performance.now(),
  };
}
