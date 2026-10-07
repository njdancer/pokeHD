import { Button } from "@pokehd/emu";

export type ButtonName = keyof typeof Button;

/** Every joypad button, in the order the bindings panel lists them. */
export const BUTTON_NAMES: readonly ButtonName[] = ["Up", "Down", "Left", "Right", "A", "B", "Start", "Select"];

/** Keyboard keys per button, as `KeyboardEvent.code` values (layout-independent, so WASD stays WASD on AZERTY). */
export type KeyBindings = Readonly<Record<ButtonName, readonly string[]>>;

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  Up: ["ArrowUp"],
  Down: ["ArrowDown"],
  Left: ["ArrowLeft"],
  Right: ["ArrowRight"],
  A: ["KeyZ"],
  B: ["KeyX"],
  Start: ["Enter"],
  Select: ["Backspace", "ShiftRight"],
};

const STORAGE_KEY = "pokehd.input.keys.v1";
const CODE = /^[A-Za-z0-9]{1,32}$/;

/** Binds `code` to `button` alone: the button's other keys are dropped, and no other button keeps `code`. */
export function bindKey(bindings: KeyBindings, button: ButtonName, code: string): KeyBindings {
  const next = {} as Record<ButtonName, readonly string[]>;
  for (const name of BUTTON_NAMES) {
    next[name] = name === button ? [code] : bindings[name].filter((c) => c !== code);
  }
  return next;
}

/** Maps each bound key to its `Button` bit. */
export function keyMasks(bindings: KeyBindings): Map<string, number> {
  const masks = new Map<string, number>();
  for (const name of BUTTON_NAMES) {
    for (const code of bindings[name]) masks.set(code, (masks.get(code) ?? 0) | Button[name]);
  }
  return masks;
}

/**
 * Reads saved bindings, falling back to the defaults for anything missing or malformed (and for
 * everything when storage is unavailable, as in private windows that block it).
 */
export function loadKeyBindings(storage: Pick<Storage, "getItem"> | undefined): KeyBindings {
  let raw: unknown;
  try {
    const text = storage?.getItem(STORAGE_KEY);
    raw = text ? JSON.parse(text) : undefined;
  } catch {
    return DEFAULT_KEY_BINDINGS;
  }
  if (typeof raw !== "object" || raw === null) return DEFAULT_KEY_BINDINGS;
  const saved = raw as Record<string, unknown>;
  const seen = new Set<string>();
  const out = {} as Record<ButtonName, readonly string[]>;
  for (const name of BUTTON_NAMES) {
    const value = saved[name];
    const codes = Array.isArray(value) ? value : DEFAULT_KEY_BINDINGS[name];
    // A key bound twice keeps its first button, so a hand-edited entry can't press two at once.
    out[name] = codes.filter((c): c is string => typeof c === "string" && CODE.test(c) && !seen.has(c));
    for (const c of out[name]) seen.add(c);
  }
  return out;
}

export function saveKeyBindings(storage: Pick<Storage, "setItem"> | undefined, bindings: KeyBindings): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // Storage full or blocked: the bindings still apply for this session.
  }
}

/** A short label for a `KeyboardEvent.code`: "KeyZ" → "Z", "ArrowUp" → "↑". */
export function keyLabel(code: string): string {
  const arrows: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
  if (arrows[code]) return arrows[code];
  const m = /^(?:Key|Digit)(.)$/.exec(code) ?? /^Numpad(.+)$/.exec(code);
  if (m?.[1]) return code.startsWith("Numpad") ? `Num ${m[1]}` : m[1];
  return code.replace(/(Left|Right)$/, " ($1)").replace(/^Shift /, "Shift ");
}
