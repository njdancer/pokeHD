// What the stream's host page and its overlay share: the URL options, the fonts and the
// fit-to-window scale. Kept apart from the overlay so editing the overlay never reloads the host
// (and with it the game the player is driving).
import { useEffect, useState } from "react";

const query = new URLSearchParams(location.search);
export const BUS = query.get("bus") ?? "http://localhost:4545";
export const GAME = query.get("game") ?? "/?stats&qa";
export const HANDLE = query.get("handle") ?? "@nj_dancer";
const FONTS = "https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Nunito:wght@600;700;800;900&display=swap";

export function useFonts(): void {
  useEffect(() => {
    if (document.querySelector(`link[href="${FONTS}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONTS;
    document.head.append(link);
  }, []);
}

/** The 1920×1080 stage's scale for the window. */
export function useFit(): number {
  const fit = () => Math.min(innerWidth / 1920, innerHeight / 1080);
  const [scale, setScale] = useState(fit);
  useEffect(() => {
    const onResize = () => setScale(fit());
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, []);
  return scale;
}
