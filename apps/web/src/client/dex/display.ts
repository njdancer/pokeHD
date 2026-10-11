// The phone's own screen, for shaping the Pokédex's screen to match it (p2-dex, Nick 2026-10-11):
// the area the open dex's screen should fill, and the display's corner radius, so the dex's
// screen corners echo the phone's.

/** Space at each edge of the view the page shouldn't draw under (CSS px). */
export interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The safe-area insets, read off a probe styled with env(). Zero outside a notched phone. */
export function safeInsets(): SafeInsets {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
  document.body.append(probe);
  const s = getComputedStyle(probe);
  const out = { top: parseFloat(s.paddingTop) || 0, right: parseFloat(s.paddingRight) || 0, bottom: parseFloat(s.paddingBottom) || 0, left: parseFloat(s.paddingLeft) || 0 };
  probe.remove();
  return out;
}

/**
 * iPhone display corner radii (points = CSS px) by portrait screen size. Browsers don't expose
 * the radius, so this is a lookup; sizes shared by models with different radii take the commoner.
 */
const IPHONE_RADII: [w: number, h: number, r: number][] = [
  [375, 812, 39], // X, XS, 11 Pro (12/13 mini: 44)
  [414, 896, 41.5], // XR, 11 (XS Max, 11 Pro Max: 39)
  [390, 844, 47.33], // 12, 12 Pro, 13, 13 Pro, 14
  [428, 926, 53.33], // 12/13 Pro Max, 14 Plus
  [393, 852, 55], // 14 Pro, 15, 15 Pro, 16
  [430, 932, 55], // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  [402, 874, 62], // 16 Pro, 17, 17 Pro
  [440, 956, 62], // 16 Pro Max, 17 Pro Max
];

/** The display's corner radius in CSS px, and whether it's known or a guess (0 on a computer). */
export function displayRadius(): { radius: number; known: boolean } {
  const w = Math.min(screen.width, screen.height);
  const h = Math.max(screen.width, screen.height);
  const hit = IPHONE_RADII.find(([iw, ih]) => iw === w && ih === h);
  if (hit) return { radius: hit[2], known: true };
  // Some other phone with rounded corners: a middling guess.
  if (matchMedia("(pointer: coarse)").matches && w < 600) return { radius: 32, known: false };
  return { radius: 0, known: false };
}

/** How much the open dex's screen fills the space it's given (device.ts pushes in to 1.03 × 1.05). */
const FILL_W = 1.03;
const FILL_H = 1.05;

/** The screen shape that fills a `w`×`h` space (portrait, so taller than wide) when pushed in. */
export function fillAspect(w: number, h: number): number {
  return Math.min(w, h) / FILL_W / (Math.max(w, h) / FILL_H);
}

/** The pushed-in screen's width in CSS px, in a `w`×`h` portrait space, for a screen of `aspect`. */
export function filledWidth(w: number, h: number, aspect: number): number {
  return Math.min(Math.min(w, h) / FILL_W, (Math.max(w, h) / FILL_H) * aspect);
}
