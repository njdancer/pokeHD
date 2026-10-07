// The game's character set, from vendor/pokered/constants/charmap.asm. A character code is also
// the tile ID it's drawn with, but codes $60–$7f mean different glyphs depending on which tile
// set the game has loaded there (text boxes vs the battle HUD), so screen decoding identifies
// glyphs by their pixels (see font.ts) and these tables name them.

/**
 * gfx/font/font.png, loaded at tiles $80–$ff (`FontGraphics`). Index 0 is $80. Multi-letter
 * entries are single tiles (the "'d" ligature, the small "PK" and "MN" of POKéMON).
 */
export const FONT_CHARS: readonly string[] = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ():;[]",
  ..."abcdefghijklmnopqrstuvwxyz",
  "é", "'d", "'l", "'s", "'t", "'v",
  // $c0–$df: blank in the English font.
  ...Array<string>(32).fill(" "),
  "'", "PK", "MN", "-", "'r", "'m", "?", "!", ".",
  "ァ", "ゥ", "ェ", "▷", "▶", "▼", "♂", "¥", "×", ".", "/", ",", "♀",
  ..."0123456789",
];

/**
 * gfx/font/font_extra.png, loaded at tiles $60–$7f for text boxes (`TextBoxGraphics`). Index 0
 * is $60. `null` marks tiles that aren't text (the unused bold letters).
 */
export const TEXT_BOX_CHARS: readonly (string | null)[] = [
  null, null, null, null, null, null, null, null, null, // $60–$68 bold A–I, unused
  "V", "S", // $69 <BOLD_V>, $6a <BOLD_S>: the "VS" of the battle intro
  null, null, // $6b, $6c bold L, M, unused
  ":", // $6d <COLON>, with smaller dots than ":"
  "ぃ", "ぅ", "‘", "’", "“", "”", "·", "…", "ぁ", "ぇ", "ぉ",
  "┌", "─", "┐", "│", "└", "┘", " ",
];

/**
 * gfx/font/font_battle_extra.png, loaded at tiles $62–$7f in battles and on status screens
 * (`HpBarAndStatusGraphics`). Index 0 is $62. Only the characters are named; the rest are HP bar
 * and HUD pieces. "<LV>" is the ":L" level marker, "<to>" a narrow "to", "<ID>" a small "ID".
 */
export const BATTLE_CHARS: readonly (string | null)[] = (() => {
  const chars = Array<string | null>(0x80 - 0x62).fill(null);
  chars[0x6e - 0x62] = ":L";
  chars[0x70 - 0x62] = "to";
  chars[0x72 - 0x62] = "『";
  chars[0x73 - 0x62] = "ID";
  chars[0x74 - 0x62] = "№";
  return chars;
})();

/** Box-drawing characters as decoded from screen tiles. */
export const BOX = { topLeft: "┌", horizontal: "─", topRight: "┐", vertical: "│", bottomLeft: "└", bottomRight: "┘" } as const;

/** Menu cursors and the "more text" prompt arrow. */
export const CURSOR = { active: "▶", inactive: "▷", more: "▼" } as const;
