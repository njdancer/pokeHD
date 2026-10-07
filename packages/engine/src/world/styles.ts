import * as THREE from "three/webgpu";
import { LABELS, type Label } from "@pokehd/rom";
import { BUILDING_LABELS, findBuildings, findProps, findTrees, PROP_LABELS, tilesWith, type StepProp } from "./analyse.ts";
import { cutOut } from "./cutout.ts";
import { grass, water } from "./effects.ts";
import { colourRegion, commonTile } from "./palette.ts";
import type { StyleParams } from "./params.ts";
import { building, cards, imageTexture, terrain, voxelProps, voxelTerrain } from "./parts.ts";
import type { Region } from "./region.ts";

// The competing world styles for p0-styles. Each turns the same region into a THREE.Group;
// lighting, sky and camera belong to whoever renders it.

export const STYLES = {
  diorama: {
    name: "Extruded diorama",
    blurb: "Tile terrain with raised ledges, pop-up buildings with gabled roofs, trees and fences as cut-out cards.",
  },
  voxel: {
    name: "Voxel",
    blurb: "Every pixel is a column; height comes from what the tile is, plus relief from its shade.",
  },
  hybrid: {
    name: "Hybrid",
    blurb: "Diorama buildings; trees swell into rounded voxel volumes, fences become pixel slabs; instanced grass and shader water.",
  },
} as const;

export type StyleId = keyof typeof STYLES;

const UNDER_PROPS: ReadonlySet<Label> = new Set(["tree", ...PROP_LABELS]);

function common(region: Region) {
  const trees = findTrees(region);
  const props = findProps(region);
  const fillTile = commonTile(region, "lawn");
  const full = colourRegion(region);
  const ground = colourRegion(region, { replace: UNDER_PROPS, fillTile });
  const cutout = cutOut(full, region, [...trees, ...props]);
  return { trees, props, full, ground, cutout, buildings: findBuildings(region) };
}

export function buildStyle(id: StyleId, region: Region, params: StyleParams): THREE.Group {
  const group = new THREE.Group();
  group.name = id;
  const c = common(region);
  const treeScale = (p: StepProp) => (p.label === "tree" ? params.treeScale : 1);

  if (id === "voxel") {
    const tex = imageTexture(c.full);
    const w = c.full.width;
    const heightAt = (px: number, py: number) => {
      const label = region.labels[(py >> 3) * region.widthTiles + (px >> 3)]!;
      const shade = region.shades[py * w + px]!;
      return voxelHeight(labelName(label), shade, params);
    };
    for (const mesh of voxelTerrain(c.full, tex, heightAt)) group.add(mesh);
    return group;
  }

  const groundTex = imageTexture(c.ground);
  const fullTex = imageTexture(c.full);
  const cutTex = imageTexture(c.cutout);
  const flatWater = id === "diorama";
  group.add(
    terrain(region, c.ground, groundTex, (l) =>
      l === "ledge" ? params.ledgeHeight
      : l === "cliff" ? params.ledgeHeight * 2
      : l === "water" ? (flatWater ? -0.1 : -0.3)
      : 0,
    ),
  );
  for (const b of c.buildings) group.add(building(b, c.full, fullTex, params));

  if (id === "diorama") {
    group.add(cards([...c.trees, ...c.props], c.cutout, cutTex, params, treeScale));
  } else {
    group.add(voxelProps([...c.trees, ...c.props], region, c.cutout, cutTex, params, treeScale, (p) => p.label === "tree"));
    const tall = tilesWith(region, new Set<Label>(["tall-grass"]));
    if (tall.length) group.add(grass(tall, params));
    const wet = tilesWith(region, new Set<Label>(["water"]));
    if (wet.length) group.add(water(wet, -0.08));
  }
  return group;
}

const labelName = (i: number): Label | undefined => LABELS[i];

const VOXEL_BASE: Partial<Record<Label, number>> = {
  lawn: 0.02,
  "tall-grass": 0.16,
  flower: 0.05,
  tree: 0.9,
  cliff: 0.45,
  stairs: 0.08,
  water: -0.1,
  bridge: 0.04,
  roof: 1.5,
  wall: 1.1,
  window: 1.1,
  door: 1.05,
  lettering: 1.1,
  fence: 0.35,
  sign: 0.4,
  cave: 0.3,
};

export function voxelHeight(label: Label | undefined, shade: number, params: StyleParams): number {
  const base = label === "ledge" ? params.ledgeHeight : (VOXEL_BASE[label ?? "ground"] ?? 0);
  // Trees get more relief so canopies dome; buildings stay flat-faced.
  const relief = label === "tree" ? 3 : label && BUILDING_LABELS.has(label) ? 0.5 : 1;
  const h = base + (3 - shade) * params.voxelRelief * relief;
  return Math.round(h * 16) / 16; // snap to the pixel grid so it reads as voxels
}
