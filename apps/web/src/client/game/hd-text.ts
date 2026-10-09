// Whether the HD text layer can stand in for the Game Boy screen (p2-text), and the player's
// choice of how it looks. The game still draws every box and moves every cursor; this only
// decides who shows it. The look is Storybook (D31).
import type { OverworldMode, ScreenText } from "@pokehd/emu";

const HD_TEXT_KEY = "pokehd.text.look.v1";

/** Whether the player wants the HD text layer (on unless turned off in Settings). */
export function loadHdTextOn(): boolean {
  try {
    return localStorage.getItem(HD_TEXT_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveHdTextOn(on: boolean): void {
  try {
    localStorage.setItem(HD_TEXT_KEY, on ? "storybook" : "off");
  } catch {
    // Storage blocked (some private windows): the choice lasts until reload.
  }
}

const WHOLE_KEY = "pokehd.text.whole.v1";

/** Whether the player wants whole messages from the script (off unless turned on in Settings). */
export function loadWholeMessages(): boolean {
  try {
    return localStorage.getItem(WHOLE_KEY) === "on";
  } catch {
    return false;
  }
}

export function saveWholeMessages(on: boolean): void {
  try {
    localStorage.setItem(WHOLE_KEY, on ? "on" : "off");
  } catch {
    // Storage blocked: the choice lasts until reload.
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

/**
 * During Oak's HD introduction (before the world): the message box and any boxes, with nothing
 * outside them (the name list stays hidden under the page's own name question).
 */
export function introTextFits(text: ScreenText | null): boolean {
  return text !== null && text.shown && text.boxes.length > 0 && text.loose.length === 0 && !text.pictures;
}

/** A cheap fingerprint, so React only re-renders when the text on screen changes. */
export function textKey(text: ScreenText): string {
  if (!text.shown) return "";
  const boxes = text.boxes.map((b) => `${b.x},${b.y},${b.width},${b.height}:${b.lines.map((l) => `${l.row},${l.col},${l.text}`).join("|")}`);
  const menus = text.menus.map((m) => `${m.box.x},${m.box.y},${m.cursor},${m.active}`);
  return `${boxes.join(";")}#${menus.join(";")}#${text.dialog?.state ?? ""}#${text.loose.length}#${text.pictures}`;
}
