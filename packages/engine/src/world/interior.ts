import * as THREE from "three/webgpu";
import { LABELS, type Label } from "@pokehd/rom";
import { type StepProp } from "./analyse.ts";
import { cutOut } from "./cutout.ts";
import { colourRegion, commonTile, LABEL_RAMPS, type Image } from "./palette.ts";
import type { StyleParams } from "./params.ts";
import type { PlaceColours } from "./place.ts";
import { imageTexture, terrain, texturedMaterial, voxelProps } from "./parts.ts";
import { labelAt, TILE_UNITS, type Region } from "./region.ts";

// Interiors (p1-interiors). The Game Boy draws a room from above with its back wall, shelves and
// machines as front elevations. So the floor and low furniture stay on the ground as raised
// slabs, and every wall-like run of tiles stands up at its front edge with its drawing on the
// front face, the way outdoor facades do. The looks differ only in how the room is enclosed.

export const INTERIOR_LOOKS = {
  open: {
    name: "Open room",
    blurb: "Just the back wall, at the height the Game Boy draws it; the room is a rug on the ground.",
  },
  dollhouse: {
    name: "Dollhouse",
    blurb: "Tall back wall and side walls, front cut away, on a thick floor slab.",
  },
  "walls-down": {
    name: "Walls down",
    blurb: "Tall back wall; the side and front walls are knee-high, so the room reads as closed.",
  },
} as const;

export type InteriorLook = keyof typeof INTERIOR_LOOKS;

/** Not yet picked by Nick: the dev page shows all three. */
export const DEFAULT_INTERIOR_LOOK: InteriorLook = "dollhouse";

/** Tiles drawn as a front elevation: they stand up at their group's front edge. */
const UPRIGHT: ReadonlySet<Label> = new Set(["wall-interior", "picture", "window", "shelf", "machine"]);
/** Round, free-standing props: voxel volumes like trees. */
const ROUND: ReadonlySet<Label> = new Set(["plant", "statue", "rock"]);
/** Slab heights for things seen from above, in units. */
const SLAB: Partial<Record<Label, number>> = { table: 0.32, counter: 0.42, furniture: 0.18 };

const WALL_LABELS: ReadonlySet<Label> = new Set(["wall-interior", "picture", "window"]);

/** A region is indoors when anything in it is labelled floor. */
export function isInterior(region: Region): boolean {
  const floor = LABELS.indexOf("floor");
  return region.labels.includes(floor);
}

interface Group {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** A wall run (back wall, partitions) rather than a piece of furniture. */
  wall: boolean;
}

/**
 * Tiles inside one of the region's maps. Indoors the border blocks around a room are filler
 * (often wall tiles), so only the maps themselves are built.
 */
function inMaps(region: Region): Uint8Array {
  const inside = new Uint8Array(region.widthTiles * region.heightTiles);
  for (const { map, x, y } of region.maps) {
    for (let ty = y; ty < y + map.heightBlocks * 4; ty++) {
      for (let tx = x; tx < x + map.widthBlocks * 4; tx++) {
        if (tx >= 0 && ty >= 0 && tx < region.widthTiles && ty < region.heightTiles) inside[ty * region.widthTiles + tx] = 1;
      }
    }
  }
  return inside;
}

/** 4-connected runs of upright tiles. Walls and furniture don't merge with each other. */
function uprightGroups(region: Region, inside: Uint8Array): Group[] {
  const { widthTiles: w, heightTiles: h } = region;
  const seen = new Uint8Array(w * h);
  const kind = (x: number, y: number) => {
    const l = labelAt(region, x, y);
    if (!l || !UPRIGHT.has(l) || !region.present[y * w + x] || !inside[y * w + x]) return 0;
    return WALL_LABELS.has(l) ? 1 : 2;
  };
  const out: Group[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = kind(x, y);
      if (!k || seen[y * w + x]) continue;
      let x0 = x, y0 = y, x1 = x + 1, y1 = y + 1;
      const stack = [[x, y] as const];
      seen[y * w + x] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        x0 = Math.min(x0, cx); y0 = Math.min(y0, cy);
        x1 = Math.max(x1, cx + 1); y1 = Math.max(y1, cy + 1);
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]] as const) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] || kind(nx, ny) !== k) continue;
          seen[ny * w + nx] = 1;
          stack.push([nx, ny]);
        }
      }
      out.push({ x0, y0, x1, y1, wall: k === 1 });
    }
  }
  return out;
}

/** Steps (2×2 tiles) that are mostly one round prop. */
function roundProps(region: Region): StepProp[] {
  const out: StepProp[] = [];
  for (let sy = 0; sy < region.heightTiles / 2; sy++) {
    for (let sx = 0; sx < region.widthTiles / 2; sx++) {
      const labels = [0, 1, 2, 3].map((i) => labelAt(region, sx * 2 + (i & 1), sy * 2 + (i >> 1)));
      const round = labels.filter((l): l is Label => l !== undefined && ROUND.has(l));
      if (round.length >= 2) out.push({ sx, sy, label: round[0]! });
    }
  }
  return out;
}

/** The room's extent in tiles: everything drawn that isn't void. */
function roomBounds(region: Region, inside: Uint8Array) {
  const voidLabel = LABELS.indexOf("void");
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = 0; y < region.heightTiles; y++) {
    for (let x = 0; x < region.widthTiles; x++) {
      const i = y * region.widthTiles + x;
      if (!region.present[i] || !inside[i] || region.labels[i] === voidLabel || region.labels[i] === 255) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
    }
  }
  return x1 > x0 ? { x0, y0, x1, y1 } : null;
}

/**
 * A box standing at the group's front edge: the drawing on its front face (square pixels at
 * `wallScale`), plain wall above that up to `height`, and a dark cap.
 */
function upright(g: Group, image: Image, tex: THREE.Texture, wallScale: number, height: number, depth: number, colour: number) {
  const x0 = g.x0 * TILE_UNITS;
  const x1 = g.x1 * TILE_UNITS;
  const zF = g.y1 * TILE_UNITS;
  const zB = zF - depth;
  const drawn = (g.y1 - g.y0) * TILE_UNITS * wallScale;
  const top = Math.max(height, drawn);
  const u0 = (g.x0 * 8) / image.width;
  const u1 = (g.x1 * 8) / image.width;
  const vTop = (g.y0 * 8) / image.height;
  const vBottom = (g.y1 * 8) / image.height;

  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const groups: { start: number; count: number; material: number }[] = [];
  const quad = (p: number[][], t: number[][], material: number) => {
    const s = pos.length / 3;
    p.forEach((c) => pos.push(...c));
    t.forEach((c) => uv.push(...c));
    idx.push(s, s + 1, s + 2, s, s + 2, s + 3);
    groups.push({ start: idx.length - 6, count: 6, material });
  };
  const none = [[0, 0], [0, 0], [0, 0], [0, 0]];
  quad([[x0, 0, zF], [x1, 0, zF], [x1, drawn, zF], [x0, drawn, zF]], [[u0, vBottom], [u1, vBottom], [u1, vTop], [u0, vTop]], 0);
  if (top > drawn) quad([[x0, drawn, zF], [x1, drawn, zF], [x1, top, zF], [x0, top, zF]], none, 1);
  quad([[x0, 0, zB], [x0, 0, zF], [x0, top, zF], [x0, top, zB]], none, 1);
  quad([[x1, 0, zF], [x1, 0, zB], [x1, top, zB], [x1, top, zF]], none, 1);
  quad([[x1, 0, zB], [x0, 0, zB], [x0, top, zB], [x1, top, zB]], none, 1);
  quad([[x0, top, zF], [x1, top, zF], [x1, top, zB], [x0, top, zB]], none, 2);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(idx);
  for (const gr of groups) geometry.addGroup(gr.start, gr.count, gr.material);
  geometry.computeVertexNormals();
  const face = texturedMaterial(tex);
  const plain = new THREE.MeshStandardNodeMaterial({ color: colour, roughness: 0.95 });
  const cap = new THREE.MeshStandardNodeMaterial({ color: 0x2c2620, roughness: 1 });
  const mesh = new THREE.Mesh(geometry, [face, plain, cap]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A plain wall slab between two points on the floor, `thick` units thick. */
function slab(xa: number, za: number, xb: number, zb: number, height: number, thick: number, colour: number) {
  const w = Math.max(Math.abs(xb - xa), thick);
  const d = Math.max(Math.abs(zb - za), thick);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, height, d),
    new THREE.MeshStandardNodeMaterial({ color: colour, roughness: 0.95 }),
  );
  mesh.position.set((xa + xb) / 2, height / 2, (za + zb) / 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildInterior(region: Region, params: StyleParams, look: InteriorLook, colours?: PlaceColours): THREE.Group {
  const group = new THREE.Group();
  group.name = `interior-${look}`;
  const ramps = colours?.ramps;
  const inside = inMaps(region);
  const uprights = uprightGroups(region, inside);
  const round = roundProps(region).filter((p) => inside[p.sy * 2 * region.widthTiles + p.sx * 2]);
  const full = colourRegion(region, { ramps });
  const fullTex = imageTexture(full);
  const cut = cutOut(full, region, round);
  const cutTex = imageTexture(cut);
  const wallColour = LABEL_RAMPS["wall-interior"][1];
  const tall = look === "open" ? 0 : 2.6;

  // Floor and slabs. Void and upright tiles drop out (uprights stand on their own); the floor
  // under round props shows through their cut-out background.
  const floorImage = colourRegion(region, { ramps, replace: ROUND, fillTile: commonTile(region, "floor"), fillLabel: "floor" });
  const hidden = new Set<Label>(["void", ...UPRIGHT]);
  const room = { ...region, present: region.present.map((p, i) => p & inside[i]!) };
  group.add(
    terrain(room, floorImage, imageTexture(floorImage), (l) => (l && hidden.has(l) ? NaN : (SLAB[l ?? "floor"] ?? 0))),
  );

  for (const g of uprights) {
    // Walls sit back as thick as they're drawn; furniture is a shallow cabinet.
    const depth = g.wall ? (g.y1 - g.y0) * TILE_UNITS : Math.min(0.45, (g.y1 - g.y0) * TILE_UNITS);
    const height = g.wall ? tall : 0;
    group.add(upright(g, full, fullTex, params.wallScale, height, depth, wallColour));
  }
  if (round.length) group.add(voxelProps(round, region, cut, cutTex, params, () => 1, () => true));

  const bounds = roomBounds(region, inside);
  if (bounds && look !== "open") {
    const x0 = bounds.x0 * TILE_UNITS;
    const x1 = bounds.x1 * TILE_UNITS;
    const z0 = bounds.y0 * TILE_UNITS;
    const z1 = bounds.y1 * TILE_UNITS;
    const t = 0.18;
    const side = look === "dollhouse" ? tall : 0.45;
    // Side walls: full height at the back, stepping down toward the camera in the dollhouse so
    // the room stays open; knee-high all the way with walls down.
    if (look === "dollhouse") {
      const back = z0 + (z1 - z0) * 0.45;
      group.add(slab(x0 - t / 2, z0, x0 - t / 2, back, side, t, wallColour));
      group.add(slab(x1 + t / 2, z0, x1 + t / 2, back, side, t, wallColour));
      group.add(slab(x0 - t / 2, back, x0 - t / 2, z1, 0.45, t, wallColour));
      group.add(slab(x1 + t / 2, back, x1 + t / 2, z1, 0.45, t, wallColour));
    } else {
      group.add(slab(x0 - t / 2, z0, x0 - t / 2, z1, side, t, wallColour));
      group.add(slab(x1 + t / 2, z0, x1 + t / 2, z1, side, t, wallColour));
      group.add(slab(x0 - t, z1 + t / 2, x1 + t, z1 + t / 2, side, t, wallColour));
    }
  }
  return group;
}
