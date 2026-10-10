// The Map tab's picture of Kanto: every town and route from the player's ROM, joined the way the
// game joins them (map connections), painted as a storybook map: each tile coloured by what it
// is (grass, water, roof…) and shaded by its own pixels, at 4 pixels a tile. Buildings with a
// door to a Pokémon Center, Mart or Gym become pins, from the maps' warps.
import { blockLabels, MAP_NAMES, townMapPlace, type Label, type MapData, type WorldData } from "@pokehd/rom";
import { placeMaps } from "@pokehd/engine/world";

/** Pixels per 8×8 tile on the painted map. */
export const PX = 4;
/** Maps before this are towns and routes; after, indoors. */
const FIRST_INDOOR = 0x25;

export interface PlacedArea {
  map: MapData;
  /** Town map name ("ROUTE 1"), as the journal records visits. */
  place: string;
  /** Pixel rectangle on the painted map. */
  x: number;
  y: number;
  w: number;
  h: number;
  town: boolean;
}

export type PinKind = "center" | "mart" | "gym" | "dock" | "house";

export interface Pin {
  kind: PinKind;
  /** The building's map name ("VERMILION_GYM"). */
  to: string;
  place: string;
  x: number;
  y: number;
}

export interface WorldMap {
  width: number;
  height: number;
  areas: PlacedArea[];
  pins: Pin[];
  /** Pixel position of a step on a map. */
  at(map: number, x: number, y: number): { x: number; y: number };
  area(place: string): PlacedArea | undefined;
  /** The painted map. */
  paint(): HTMLCanvasElement;
}

/** Storybook colours per label: soft, a little warm, readable at a glance. */
const COLOUR: Partial<Record<Label, [number, number, number]>> = {
  ground: [236, 217, 168],
  lawn: [170, 214, 138],
  "tall-grass": [104, 176, 88],
  flower: [244, 168, 186],
  tree: [62, 140, 76],
  cliff: [184, 142, 96],
  ledge: [196, 156, 104],
  stairs: [214, 194, 140],
  water: [104, 172, 226],
  shore: [164, 210, 238],
  bridge: [200, 152, 92],
  roof: [216, 96, 79],
  wall: [240, 228, 205],
  window: [150, 205, 228],
  door: [140, 92, 60],
  lettering: [250, 246, 236],
  fence: [214, 182, 120],
  sign: [196, 146, 90],
  cave: [104, 80, 64],
  rock: [170, 150, 120],
};
const PAPER: [number, number, number] = [232, 222, 200];

const pinKind = (name: string): PinKind | null =>
  name.endsWith("POKECENTER") ? "center" : name.endsWith("MART") ? "mart" : name.endsWith("GYM") ? "gym" : name.includes("DOCK") ? "dock" : null;

export function buildWorldMap(rom: Uint8Array, world: WorldData): WorldMap {
  const ids: number[] = [];
  for (let i = 0; i < FIRST_INDOOR; i++) if (world.maps[i]) ids.push(i);
  const placed = placeMaps(world, 0, ids);
  const minX = Math.min(...placed.map((p) => p.bx));
  const minY = Math.min(...placed.map((p) => p.by));
  const maxX = Math.max(...placed.map((p) => p.bx + p.map.widthBlocks));
  const maxY = Math.max(...placed.map((p) => p.by + p.map.heightBlocks));
  const block = 4 * PX;
  const areas: PlacedArea[] = placed.map((p) => ({
    map: p.map,
    place: townMapPlace(rom, p.map.id).name,
    x: (p.bx - minX) * block,
    y: (p.by - minY) * block,
    w: p.map.widthBlocks * block,
    h: p.map.heightBlocks * block,
    town: !MAP_NAMES[p.map.id]!.startsWith("ROUTE"),
  }));
  const byId = new Map(areas.map((a) => [a.map.id, a]));
  const at = (map: number, x: number, y: number) => {
    const a = byId.get(map)!;
    return { x: a.x + (x * 2 + 1) * PX, y: a.y + (y * 2 + 1) * PX };
  };
  const pins: Pin[] = [];
  for (const a of areas) {
    const seen = new Set<string>();
    for (const w of a.map.warps) {
      if (w.to === "last") continue;
      const to = MAP_NAMES[w.to] ?? "";
      const kind = pinKind(to);
      if (!kind || seen.has(to)) continue;
      seen.add(to);
      const p = at(a.map.id, w.x, w.y);
      pins.push({ kind, to, place: a.place, x: p.x, y: p.y - PX * 2 });
    }
  }
  return {
    width: (maxX - minX) * block,
    height: (maxY - minY) * block,
    areas,
    pins,
    at,
    area: (place) => areas.find((a) => a.place === place.toUpperCase()) ?? areas.find((a) => a.place.replace(/\W/g, "") === place.toUpperCase().replace(/\W/g, "")),
    paint: () => paint(world, areas, (maxX - minX) * block, (maxY - minY) * block),
  };
}

function paint(world: WorldData, areas: PlacedArea[], width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(width, height);
  const labelCache = new Map<number, (Label | undefined)[][]>();
  const step = 8 / PX;
  for (const a of areas) {
    const ts = world.tilesets[a.map.tileset]!;
    let labels = labelCache.get(a.map.tileset);
    if (!labels) labelCache.set(a.map.tileset, (labels = blockLabels(ts)));
    for (let by = 0; by < a.map.heightBlocks; by++) {
      for (let bx = 0; bx < a.map.widthBlocks; bx++) {
        const b = a.map.blocks[by * a.map.widthBlocks + bx]!;
        for (let t = 0; t < 16; t++) {
          const tile = ts.blocks[b * 16 + t]!;
          const base = COLOUR[labels[b]![t]!] ?? PAPER;
          const ox = a.x + (bx * 4 + (t & 3)) * PX;
          const oy = a.y + (by * 4 + (t >> 2)) * PX;
          for (let py = 0; py < PX; py++) {
            for (let px = 0; px < PX; px++) {
              // The tile's own shading, averaged over the pixels this one covers: 0 light … 3 dark.
              let shade = 0;
              for (let sy = 0; sy < step; sy++) for (let sx = 0; sx < step; sx++) shade += ts.tiles[tile * 64 + (py * step + sy) * 8 + px * step + sx]!;
              shade /= step * step;
              const k = 1.06 - shade * 0.13;
              const i = ((oy + py) * width + ox + px) * 4;
              img.data[i] = Math.min(255, base[0] * k);
              img.data[i + 1] = Math.min(255, base[1] * k);
              img.data[i + 2] = Math.min(255, base[2] * k);
              img.data[i + 3] = 255;
            }
          }
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * The fog over places not visited yet: paper with soft clouds, cleared (with a soft edge) over
 * visited places. In the real build it clears tile by tile along the player's trail.
 */
export function paintFog(map: WorldMap, visited: ReadonlySet<string>, partly: ReadonlySet<string>): HTMLCanvasElement {
  const s = 4; // the fog is soft, so a quarter of the size is plenty
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(map.width / s);
  canvas.height = Math.ceil(map.height / s);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ebe1cc";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Cloud puffs: a fixed sprinkle, so the fog has some texture.
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 260; i++) {
    const x = rnd() * canvas.width;
    const y = rnd() * canvas.height;
    const r = 6 + rnd() * 18;
    ctx.fillStyle = rnd() < 0.5 ? "#efe7d5" : "#e6dbc4";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "destination-out";
  ctx.filter = "blur(5px)";
  for (const a of map.areas) {
    if (!visited.has(a.place)) continue;
    const w = partly.has(a.place) ? a.w * 0.5 : a.w;
    ctx.fillRect((a.x - 4) / s, (a.y - 4) / s, (w + 8) / s, (a.h + 8) / s);
  }
  ctx.filter = "none";
  ctx.globalCompositeOperation = "source-over";
  return canvas;
}
