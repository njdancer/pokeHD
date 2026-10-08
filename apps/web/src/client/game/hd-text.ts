// Whether the HD text layer can stand in for the Game Boy screen (p2-text), and the player's
// choice of how it looks. The game still draws every box and moves every cursor; this only
// decides who shows it.
import type { OverworldMode, ScreenText } from "@pokehd/emu";

/**
 * `storybook`: rounded letters on warm paper. `lantern`: serif on dark glass with gold lines.
 * `pixel`: the game's own letters, crisp, on a light panel. `off`: the Game Boy screen.
 */
export type TextLook = "storybook" | "lantern" | "pixel" | "off";

export const TEXT_LOOKS: readonly { look: TextLook; label: string }[] = [
  { look: "storybook", label: "Storybook" },
  { look: "lantern", label: "Lantern" },
  { look: "pixel", label: "Game Boy letters" },
  { look: "off", label: "Game Boy screen" },
];

const LOOK_KEY = "pokehd.text.look.v1";
export const DEFAULT_LOOK: TextLook = "storybook";

export function loadTextLook(): TextLook {
  try {
    const stored = localStorage.getItem(LOOK_KEY);
    return TEXT_LOOKS.some((l) => l.look === stored) ? (stored as TextLook) : DEFAULT_LOOK;
  } catch {
    return DEFAULT_LOOK;
  }
}

export function saveTextLook(look: TextLook): void {
  try {
    localStorage.setItem(LOOK_KEY, look);
  } catch {
    // Storage blocked (some private windows): the choice lasts until reload.
  }
}

/**
 * True when everything the game shows over the world is in boxes of text the HD layer can
 * draw: in the world, outside battle, with no pictures in the boxes and no text outside them
 * (the party screen, the Pokédex and the town map stay on the Game Boy screen).
 */
export function hdTextFits(text: ScreenText | null, mode: OverworldMode, inWorld: boolean): boolean {
  return (
    text !== null &&
    inWorld &&
    mode !== "battle" &&
    text.shown &&
    text.boxes.length > 0 &&
    text.loose.length === 0 &&
    !text.pictures
  );
}

/** A cheap fingerprint, so React only re-renders when the text on screen changes. */
export function textKey(text: ScreenText): string {
  if (!text.shown) return "";
  const boxes = text.boxes.map((b) => `${b.x},${b.y},${b.width},${b.height}:${b.lines.map((l) => `${l.row},${l.col},${l.text}`).join("|")}`);
  const menus = text.menus.map((m) => `${m.box.x},${m.box.y},${m.cursor},${m.active}`);
  return `${boxes.join(";")}#${menus.join(";")}#${text.dialog?.state ?? ""}#${text.loose.length}#${text.pictures}`;
}
