// What the stream page reads from the game it shows: the ROM (for pictures), and the team and
// badges from the game in the iframe (same origin, opened with ?stats so it has window.__pokehd).
import { useEffect, useState, type RefObject } from "react";
import type { GameSnapshot } from "@pokehd/emu";
import { dexEntry, pokedexNumber, readBadges, readSgbPalettes, DEX_SIZE } from "@pokehd/rom";
import { fetchDevRom } from "../../dev-rom.ts";
import { loadStoredRom } from "../../rom-store.ts";
import { monPicture } from "../../dex/pictures.ts";

const PARTY_POLL_MS = 2_000;

export function useRom(): Uint8Array | null {
  const [rom, setRom] = useState<Uint8Array | null>(null);
  useEffect(() => {
    let disposed = false;
    void (async () => {
      const r = (await fetchDevRom()) ?? (await loadStoredRom());
      if (!disposed && r) setRom(r);
    })();
    return () => {
      disposed = true;
    };
  }, []);
  return rom;
}

/** The game's snapshot, every couple of seconds; null while the game has none to give. */
export function useGameSnapshot(frame: RefObject<HTMLIFrameElement | null>): GameSnapshot | null {
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  useEffect(() => {
    let disposed = false;
    let busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        // Throws for a cross-origin game; the party then stays empty.
        const api = frame.current?.contentWindow?.__pokehd;
        const next = api?.snapshot ? await api.snapshot() : null;
        if (!disposed) setSnap(next);
      } catch {
        if (!disposed) setSnap(null);
      } finally {
        busy = false;
      }
    };
    void poll();
    const id = setInterval(() => void poll(), PARTY_POLL_MS);
    return () => {
      disposed = true;
      clearInterval(id);
    };
  }, [frame]);
  return snap;
}

const pictureAt = new WeakMap<Uint8Array, Map<number, string>>();

/** A Pokémon's front picture from the ROM (facing right, as in the Pokédex), by internal species. */
export function monPic(rom: Uint8Array, species: number): string | null {
  let map = pictureAt.get(rom);
  if (!map) pictureAt.set(rom, (map = new Map()));
  if (!map.has(species)) {
    const dex = pokedexNumber(rom, species);
    map.set(species, dex >= 1 && dex <= DEX_SIZE ? monPicture(rom, species, dexEntry(rom, dex, species).picture) : "");
  }
  return map.get(species) || null;
}

const badgeCache = new WeakMap<Uint8Array, string[]>();

/** The eight badges as data URLs (16×16), in the trainer card's Super Game Boy colours. */
export function badgePictures(rom: Uint8Array): string[] {
  let urls = badgeCache.get(rom);
  if (urls) return urls;
  const palettes = readSgbPalettes(rom);
  urls = readBadges(rom).map((badge) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext("2d")!;
    const image = ctx.createImageData(16, 16);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const c = badge.pixels[y * 16 + x]!;
        // Colour 0 is the card behind the badge: see-through here.
        if (c === 0) continue;
        const rgb = palettes[badge.palettes[(y >> 3) * 2 + (x >> 3)]!]![c]!;
        image.data.set([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255], (y * 16 + x) * 4);
      }
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL();
  });
  badgeCache.set(rom, urls);
  return urls;
}
