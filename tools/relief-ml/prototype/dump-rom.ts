// Dumps what the prototype reads from the ROM (tiles, blocks, tile labels, maps, Pokédex pictures)
// to a JSON file OUTSIDE the repo. The output is Nintendo data: never commit or upload it.
// Usage (from packages/rom): node ../../tools/relief-ml/prototype/dump-rom.ts ../../rom/pokeblue.gb /some/private/dir/rom.json
import { readFileSync, writeFileSync } from "node:fs";
import { parseWorld, blockLabels, dexEntries, dexPicture } from "../../../packages/rom/src/index.ts";
const rom = new Uint8Array(readFileSync(process.argv[2]!));
const out = process.argv[3]!;
const w = parseWorld(rom);
const tilesets = w.tilesets.map((t) => ({ id: t.id, name: t.name, blockCount: t.blockCount, blocks: Array.from(t.blocks), tiles: Array.from(t.tiles), blockLabels: blockLabels(t).map((b) => b.map((l) => l ?? null)) }));
const maps = w.maps.filter(Boolean).map((m) => ({ id: m!.id, name: m!.name, tileset: m!.tileset, w: m!.widthBlocks, h: m!.heightBlocks, blocks: Array.from(m!.blocks) }));
const pics = dexEntries(rom).map((e, i) => { const p = dexPicture(rom, e.picture); return { dex: i + 1, name: e.name, w: p.width * 8, h: p.height * 8, px: Array.from(p.pixels ?? (p as any).data ?? []) }; });
const sprites = w.sprites.map((s) => s && { id: s.id, still: s.still, tiles: Array.from(s.tiles) });
writeFileSync(out, JSON.stringify({ tilesets, maps, pics, sprites }));
