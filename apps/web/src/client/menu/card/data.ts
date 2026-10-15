// What a Pokémon's card prints, from what the menu knows: the ROM's Pokédex entry and learnset,
// PokeAPI's artwork (live) and the cartridge's picture.
import { artworkUrl, monPic, niceMon, type MenuEnv } from "../env.tsx";
import { heightText, weightText } from "../../dex/catalogue.ts";
import type { CardData, Finish } from "./face.ts";

export function cardOf(env: Pick<MenuEnv, "rom" | "catalogue" | "model">, dex: number, art = true): CardData {
  const e = env.catalogue.entries[dex - 1]!;
  const learns = env.model.learns(dex);
  const all = learns?.moves ?? [];
  // One move it starts with and the last it learns: a gentle one and its big one.
  const moves = all.length > 1 ? [all[0]!, all[all.length - 1]!] : all;
  return {
    dex,
    name: niceMon(e.name),
    kind: e.category.charAt(0) + e.category.slice(1).toLowerCase(),
    types: e.types,
    stats: e.stats,
    height: heightText(e),
    weight: weightText(e),
    words: e.pages.map((p) => p.join(" ")).join(" ").replace(/POKéMON/g, "Pokémon"),
    moves,
    art: art ? artworkUrl(dex) : undefined,
    pixel: monPic(env as MenuEnv, dex),
  };
}

const param = typeof location !== "undefined" ? new URLSearchParams(location.search).get("card") : null;
/** `?card` in the address shows the entry page as a card (a trial, off by default); `?card=gold` or `reverse` picks the finish. */
export const cardTrial: Finish | null = param === null ? null : param === "gold" || param === "reverse" ? param : "holo";
