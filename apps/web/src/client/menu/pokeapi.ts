// Richer Pokédex pages from PokeAPI, fetched live from their host and never copied anywhere of
// ours (Nick, 2026-10-10): the official artwork (moves and evolutions come from the ROM). Only
// ever asked for Pokémon the player has caught. Offline, the browser's own cache answers for
// pages already seen; with nothing cached the page keeps the ROM's picture.
import { useEffect, useState } from "react";

export interface LiveEntry {
  art: string | null;
}

const memo = new Map<number, Promise<LiveEntry | null>>();

interface PokemonJson {
  sprites?: { other?: { "official-artwork"?: { front_default?: string | null } } };
}

function fetchEntry(dex: number): Promise<LiveEntry | null> {
  let p = memo.get(dex);
  if (!p) {
    p = fetch(`https://pokeapi.co/api/v2/pokemon/${dex}`)
      .then((res) => (res.ok ? (res.json() as Promise<PokemonJson>) : null))
      .then((json) => (json ? { art: json.sprites?.other?.["official-artwork"]?.front_default ?? null } : null))
      .catch(() => null);
    memo.set(dex, p);
  }
  return p;
}

/** PokeAPI's page for a caught Pokémon; null until it arrives, or if it can't. */
export function useLiveEntry(dex: number, caught: boolean): LiveEntry | null {
  const [entry, setEntry] = useState<LiveEntry | null>(null);
  useEffect(() => {
    setEntry(null);
    if (!caught) return;
    let live = true;
    void fetchEntry(dex).then((e) => live && setEntry(e));
    return () => {
      live = false;
    };
  }, [dex, caught]);
  return entry;
}
