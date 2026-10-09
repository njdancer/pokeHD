// The Pokédex's look, chosen in Settings while Nick picks one (p2-dex). "off" leaves the game's own.
import type { PokedexStyle } from "./Pokedex.tsx";

export type DexSetting = PokedexStyle | "off";
const KEY = "pokehd.dex.look.v1";
const LOOKS: readonly DexSetting[] = ["device", "pixel", "storybook", "off"];

export function loadDexLook(): DexSetting {
  try {
    const v = localStorage.getItem(KEY) as DexSetting | null;
    return v && LOOKS.includes(v) ? v : "device";
  } catch {
    return "device";
  }
}

export function saveDexLook(look: DexSetting): void {
  try {
    localStorage.setItem(KEY, look);
  } catch {
    // Storage blocked (some private windows): the choice lasts until reload.
  }
}
