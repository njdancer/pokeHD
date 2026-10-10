// What every screen of the Pokédex menu reads: the ROM (for pictures and names), the model, the
// game's moment and the actions, plus pictures drawn from the ROM.
import { createContext, useContext } from "react";
import { SGB_PAL, type TrainerClass, type WorldData } from "@pokehd/rom";
import type { Catalogue } from "../dex/catalogue.ts";
import { monPicture, personPicture, trainerPicture } from "../dex/pictures.ts";
import type { MenuActions, MenuModel, Moment, Person } from "./model.ts";

export interface MenuEnv {
  rom: Uint8Array;
  world: WorldData;
  catalogue: Catalogue;
  /** Trainer classes, for leaders' and trainers' battle pictures. */
  trainers: TrainerClass[];
  model: MenuModel;
  moment: Moment;
  actions: MenuActions;
  /** A short line over the menu ("Saved"). */
  toast(text: string): void;
}

export const Env = createContext<MenuEnv | null>(null);

export function useEnv(): MenuEnv {
  const env = useContext(Env);
  if (!env) throw new Error("Pokédex menu outside its Env");
  return env;
}

/** A Pokémon's front picture from the ROM, facing right as the Pokédex shows it. */
export function monPic(env: MenuEnv, dex: number): string {
  const e = env.catalogue.entries[dex - 1]!;
  return monPicture(env.rom, e.species, e.picture);
}

/**
 * PokeAPI's official artwork, fetched live from their host (never mirrored or proxied; memory
 * pokeapi-live-art). Offline, the browser's cache keeps what it has shown; else the ROM picture.
 */
export const artworkUrl = (dex: number) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${dex}.png`;

export function personPic(env: MenuEnv, p: Person): string {
  if ("trainer" in p.picture) return trainerPicture(env.rom, env.trainers[p.picture.trainer - 1]!.picture);
  return spritePic(env, p.picture.sprite);
}

/** An overworld sprite standing facing the camera (palette: the overworld's red). */
export function spritePic(env: MenuEnv, sprite: number): string {
  const sheet = env.world.sprites[sprite];
  return sheet ? personPicture(env.rom, sheet, SGB_PAL.MEWMON) : "";
}

/** Type colours, softened to sit on paper. Gen 1's fifteen types, by the ROM's names. */
export const TYPE_COLOUR: Record<string, string> = {
  NORMAL: "#a8a077", FIRE: "#ec7a3c", WATER: "#4f8fe0", ELECTRIC: "#e2b42c", GRASS: "#5fb05a", ICE: "#76c8d0",
  FIGHTING: "#c0453a", POISON: "#a05aa8", GROUND: "#cfa45a", FLYING: "#8f8fdb", PSYCHIC: "#e0588a", BUG: "#98ad2a",
  ROCK: "#b49c4a", GHOST: "#6f5b9a", DRAGON: "#6f4fe0",
};

export const typeName = (t: string) => t[0] + t.slice(1).toLowerCase();
export const dexNo = (dex: number) => `No.${String(dex).padStart(3, "0")}`;

/** Reads words out loud (the "Read it to me" button). */
export function readAloud(text: string): void {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/POKé/g, "Poké").replace(/\bPKMN\b/g, "Pokémon"));
    u.rate = 0.92;
    speechSynthesis.speak(u);
  } catch {
    // No speech on this device: the button just does nothing.
  }
}

/** "NIDORAN♂" stays, "MR.MIME" → "Mr.Mime": names read better in title case, like the HD text. */
export const niceMon = (name: string) => name.charAt(0) + name.slice(1).toLowerCase().replace(/\.(\w)/g, (_m, c: string) => "." + c.toUpperCase());

/** Gym badges, drawn as simple shapes in each badge's colour. */
export const BADGES: { name: string; colour: string; shape: string }[] = [
  { name: "Boulder", colour: "#9aa3ad", shape: "M16 5l10 8-4 13H10L6 13z" },
  { name: "Cascade", colour: "#4f8fe0", shape: "M16 4c5 7 9 11 9 16a9 9 0 0 1-18 0c0-5 4-9 9-16z" },
  { name: "Thunder", colour: "#e8b923", shape: "M16 4l3 7h8l-6.5 5 2.5 8-7-5-7 5 2.5-8L5 11h8z" },
  { name: "Rainbow", colour: "#5fb85a", shape: "M16 5c4 4 4 8 0 11-4-3-4-7 0-11zm0 11c4-2 8 0 10 4-4 2-8 0-10-4zm0 0c-4-2-8 0-10 4 4 2 8 0 10-4z" },
  { name: "Soul", colour: "#e0588a", shape: "M16 27S5 20 5 12.5A5.5 5.5 0 0 1 16 10a5.5 5.5 0 0 1 11 2.5C27 20 16 27 16 27z" },
  { name: "Marsh", colour: "#d4a52a", shape: "M16 5a11 11 0 1 0 0 22 11 11 0 1 0 0-22zm0 6a5 5 0 1 1 0 10 5 5 0 1 1 0-10z" },
  { name: "Volcano", colour: "#e05a2f", shape: "M16 4c3 5 9 8 9 14a9 9 0 0 1-18 0c0-6 6-9 9-14z" },
  { name: "Earth", colour: "#3f8f4a", shape: "M16 4l11 12-11 12L5 16z" },
];

/** "POKé BALL" → "Poké Ball", "HM01" stays, "S.S.TICKET" → "S.S. Ticket": friendlier to read. */
export const niceItem = (name: string) =>
  /^(HM|TM)\d/.test(name) ? name : name.toLowerCase().replace(/é/g, "é").replace(/(^|[ .'-])([a-zé])/g, (_m, a: string, b: string) => a + b.toUpperCase()).replace(/^S\.S\./, "S.S. ").replace("Poké", "Poké").replace("'S ", "'s ").replace(/'S$/, "'s");
