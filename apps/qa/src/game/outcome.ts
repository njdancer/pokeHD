// Turning what the screen shows into the player's Outcome text.
import { MAP_NAMES } from "@pokehd/rom";
import type { Panel, ScreenButton, ScreenRead } from "./screen-read.ts";

const WORDS: Record<string, string> = {
  REDS: "Red's",
  BLUES: "Blue's",
  OAKS: "Oak's",
  POKECENTER: "Pokémon Center",
  MART: "Mart",
  SS: "S.S.",
  BILLS: "Bill's",
  MR: "Mr.",
  PSYCHICS: "Psychic's",
  DAYCARE: "Day Care",
};

/** "REDS_HOUSE_2F" → "Red's House 2F"; unknown IDs → "map 0x.." */
export function mapName(id: number): string {
  const raw = MAP_NAMES[id];
  if (!raw) return `map 0x${id.toString(16)}`;
  return raw
    .split("_")
    .map((w) => WORDS[w] ?? (/^\d|^B?\d+F$/.test(w) ? w : w[0] + w.slice(1).toLowerCase()))
    .join(" ");
}

const centre = (b: ScreenButton) => `(${Math.round(b.x + b.w / 2)},${Math.round(b.y + b.h / 2)})`;

/** The visible text panels, one per line. */
export function describePanels(panels: readonly Panel[]): string {
  return panels
    .map((p) => {
      const text = p.text.replace(/\n/g, " / ");
      const cursor = p.cursor ? ` (cursor on ${p.cursor.replace(/\n/g, " ")})` : "";
      return `${p.kind}: "${text}"${cursor}`;
    })
    .join("\n");
}

/** The buttons a person could tap, with where to tap them; the joypad on a line of its own. */
export function describeButtons(read: Pick<ScreenRead, "buttons" | "joystick">): string {
  const main = read.buttons.filter((b) => !b.pad);
  const pad = read.buttons.filter((b) => b.pad);
  const lines: string[] = [];
  if (main.length) lines.push(`Buttons: ${main.map((b) => `[${b.label}] at ${centre(b)}`).join(", ")}`);
  if (pad.length || read.joystick) {
    const stick = read.joystick ? `joystick in the area (${read.joystick.x},${read.joystick.y})–(${read.joystick.x + read.joystick.w},${read.joystick.y + read.joystick.h})` : "";
    lines.push(`Pad: ${[stick, ...pad.map((b) => `[${b.label}] at ${centre(b)}`)].filter(Boolean).join(", ")}`);
  }
  return lines.join("\n");
}

/** Text boxes from the Game Boy screen (decoded tiles), for when the page draws none of its own. */
export function describeGameBoyText(boxes: readonly { lines: readonly { text: string }[] }[]): string {
  const lines = boxes
    .map((b) =>
      b.lines
        .map((l) => l.text.replace(/▼/g, "").trim())
        .filter(Boolean)
        .join(" / "),
    )
    .filter(Boolean);
  return lines.length ? `Game Boy screen text:\n${lines.map((l) => `"${l}"`).join("\n")}` : "";
}
