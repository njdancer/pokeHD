// How the HD panels look (tap-first UI). Three takes on the game's own frame, a double line with
// a bead in each corner, for Nick to pick from; `?look=` picks one for a page view.
//
// - `ball`: Storybook's cream paper and gold edge (D31), with a little ball in each corner.
// - `frame`: the Game Boy's frame drawn in HD: a dark double line on white, ball corners.
// - `candy`: Storybook paper with chunky raised buttons and a ball for the cursor.
export const UI_LOOKS = ["ball", "frame", "candy"] as const;
export type UiLook = (typeof UI_LOOKS)[number];

export const DEFAULT_UI_LOOK: UiLook = "ball";

/** The look for this page view: `?look=` if it names one, else the default. */
export function uiLook(): UiLook {
  const asked = new URLSearchParams(location.search).get("look");
  return UI_LOOKS.find((l) => l === asked) ?? DEFAULT_UI_LOOK;
}
