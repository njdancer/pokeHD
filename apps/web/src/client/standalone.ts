// The home-screen app (p1-kidproof): a small child holds the phone, so nothing a stray finger
// does should leave the game. Pinch zoom, double-tap zoom, pull-to-refresh and the edge swipe
// that goes back a page are all switched off (the CSS half is in style.css).

/** True when running as an installed app (iOS home screen or a desktop/Android install). */
export const standalone = (): boolean =>
  matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

/** How close to the screen's side edge a touch starts an iOS back or forward swipe. */
const EDGE_PX = 24;

export function lockPage(): void {
  // Safari's own pinch zoom ignores user-scalable=no; its gesture events can still be cancelled.
  for (const type of ["gesturestart", "gesturechange"]) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  if (!standalone()) return;
  document.documentElement.dataset["standalone"] = "";
  document.addEventListener(
    "touchstart",
    (e) => {
      const x = e.touches[0]?.clientX ?? EDGE_PX;
      // Cancelling a touch also cancels its click, so controls at the edge are left alone.
      const control = e.target instanceof Element && e.target.closest("button, a, input, label, select, textarea");
      if (!control && (x < EDGE_PX || x > innerWidth - EDGE_PX)) e.preventDefault();
    },
    { passive: false },
  );
}
