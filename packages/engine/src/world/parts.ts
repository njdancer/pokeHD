import * as THREE from "three/webgpu";
import type { Label } from "@pokehd/rom";
import type { Building, StepProp } from "./analyse.ts";
import { meshHeightfield, type MeshArrays } from "./heightfield.ts";
import { LABEL_RAMPS, type Image } from "./palette.ts";
import type { StyleParams } from "./params.ts";
import { labelAt, TILE_UNITS, type Region } from "./region.ts";

// three.js pieces the styles share. Region tile (tx, ty) sits at world (tx/2, 0, ty/2).

export function imageTexture(image: Image): THREE.DataTexture {
  const tex = new THREE.DataTexture(image.data, image.width, image.height);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function geometryFrom(arrays: MeshArrays | MeshArrays[]): THREE.BufferGeometry {
  const list = Array.isArray(arrays) ? arrays : [arrays];
  const total = (k: "positions" | "normals" | "uvs" | "indices") => list.reduce((n, a) => n + a[k].length, 0);
  const positions = new Float32Array(total("positions"));
  const normals = new Float32Array(total("normals"));
  const uvs = new Float32Array(total("uvs"));
  const indices = new Uint32Array(total("indices"));
  let p = 0, u = 0, i = 0;
  for (const a of list) {
    positions.set(a.positions, p * 3);
    normals.set(a.normals, p * 3);
    uvs.set(a.uvs, u);
    indices.set(a.indices.map((n) => n + p), i);
    p += a.positions.length / 3;
    u += a.uvs.length;
    i += a.indices.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  g.computeBoundingSphere();
  return g;
}

export function texturedMaterial(tex: THREE.Texture, opts: { cutout?: boolean } = {}): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.9, metalness: 0 });
  if (opts.cutout) {
    m.alphaTest = 0.5;
    m.side = THREE.DoubleSide;
  }
  return m;
}

function shadowed<T extends THREE.Object3D>(o: T, cast = true): T {
  o.castShadow = cast;
  o.receiveShadow = true;
  return o;
}

/**
 * Terrain on the tile grid: each tile a column at `heightOf(label)`, textured with `image`. With
 * `edgeColour`, the outline walls (where the ground drops away at its edge) are that plain colour
 * instead of their edge pixels stretched down the face.
 */
export function terrain(
  region: Region,
  image: Image,
  tex: THREE.Texture,
  heightOf: (l: Label | undefined, i: number) => number,
  edgeColour?: number,
) {
  const heights = new Float32Array(region.widthTiles * region.heightTiles);
  for (let ty = 0; ty < region.heightTiles; ty++) {
    for (let tx = 0; tx < region.widthTiles; tx++) {
      const i = ty * region.widthTiles + tx;
      heights[i] = region.present[i] ? heightOf(labelAt(region, tx, ty), i) : NaN;
    }
  }
  const arrays = meshHeightfield({
    width: region.widthTiles,
    height: region.heightTiles,
    heights,
    base: -1,
    uv: (x, y) => [(x * 8) / image.width, (y * 8) / image.height],
    origin: [0, 0, 0],
    ax: [TILE_UNITS, 0, 0],
    ay: [0, 0, TILE_UNITS],
    ah: [0, 1, 0],
    splitEdges: edgeColour !== undefined,
  });
  const geometry = geometryFrom(arrays);
  if (edgeColour === undefined || arrays.edgeStart === undefined) return shadowed(new THREE.Mesh(geometry, texturedMaterial(tex)));
  geometry.addGroup(0, arrays.edgeStart, 0);
  geometry.addGroup(arrays.edgeStart, arrays.indices.length - arrays.edgeStart, 1);
  const edge = new THREE.MeshStandardNodeMaterial({ color: edgeColour, roughness: 0.95, metalness: 0 });
  return shadowed(new THREE.Mesh(geometry, [texturedMaterial(tex), edge]));
}

/** Voxel terrain at pixel resolution: every pixel a column. */
export function voxelTerrain(image: Image, tex: THREE.Texture, heightAt: (px: number, py: number) => number) {
  const w = image.width;
  const h = image.height;
  const heights = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) heights[y * w + x] = heightAt(x, y);
  // Mesh in strips so no single buffer grows huge, and culling can skip off-screen strips.
  const meshes: THREE.Mesh[] = [];
  const strip = 64;
  const material = texturedMaterial(tex);
  for (let y0 = 0; y0 < h; y0 += strip) {
    const sh = Math.min(strip, h - y0);
    const arrays = meshHeightfield({
      width: w,
      height: sh,
      heights: heights.subarray(y0 * w, (y0 + sh) * w),
      base: -1,
      uv: (x, y) => [x / w, (y0 + y) / h],
      origin: [0, 0, y0 / 16],
      ax: [1 / 16, 0, 0],
      ay: [0, 0, 1 / 16],
      ah: [0, 1, 0],
    });
    meshes.push(shadowed(new THREE.Mesh(geometryFrom(arrays), material)));
  }
  return meshes;
}

/**
 * A building popped up from its Game Boy drawing: the bottom rows of its tiles become the front
 * wall, the rows above become the front slope of a gabled roof.
 */
export function building(b: Building, image: Image, tex: THREE.Texture, params: StyleParams): THREE.Mesh {
  const W = image.width;
  const H = image.height;
  const x0 = b.x0 * TILE_UNITS;
  const x1 = b.x1 * TILE_UNITS;
  const zBack = b.y0 * TILE_UNITS;
  const zFront = b.y1 * TILE_UNITS;
  const wallH = b.facadeRows * TILE_UNITS * params.wallScale;
  const depth = zFront - zBack;
  const zMid = (zBack + zFront) / 2;
  const ridge = wallH + params.roofPitch * (depth / 2);
  const e = params.eave;
  const eaveY = wallH - params.roofPitch * e;

  const u0 = (b.x0 * 8) / W;
  const u1 = (b.x1 * 8) / W;
  const vFacadeTop = ((b.y1 - b.facadeRows) * 8) / H;
  const vFacadeBottom = (b.y1 * 8) / H;
  const vRoofTop = (b.y0 * 8) / H;

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
  const tri = (p: number[][], material: number) => {
    const s = pos.length / 3;
    p.forEach((c) => pos.push(...c));
    p.forEach(() => uv.push(0, 0));
    idx.push(s, s + 1, s + 2);
    groups.push({ start: idx.length - 3, count: 3, material });
  };

  // Front wall (faces +z), textured with the facade rows.
  quad([[x0, 0, zFront], [x1, 0, zFront], [x1, wallH, zFront], [x0, wallH, zFront]],
    [[u0, vFacadeBottom], [u1, vFacadeBottom], [u1, vFacadeTop], [u0, vFacadeTop]], 0);
  // Front roof slope, textured with the roof rows; back slope mirrors it.
  quad([[x0 - e, eaveY, zFront + e], [x1 + e, eaveY, zFront + e], [x1 + e, ridge, zMid], [x0 - e, ridge, zMid]],
    [[u0, vFacadeTop], [u1, vFacadeTop], [u1, vRoofTop], [u0, vRoofTop]], 0);
  quad([[x1 + e, eaveY, zBack - e], [x0 - e, eaveY, zBack - e], [x0 - e, ridge, zMid], [x1 + e, ridge, zMid]],
    [[u1, vFacadeTop], [u0, vFacadeTop], [u0, vRoofTop], [u1, vRoofTop]], 0);
  // Back and side walls plus gables, plain.
  quad([[x1, 0, zBack], [x0, 0, zBack], [x0, wallH, zBack], [x1, wallH, zBack]], [[0, 0], [0, 0], [0, 0], [0, 0]], 1);
  quad([[x0, 0, zBack], [x0, 0, zFront], [x0, wallH, zFront], [x0, wallH, zBack]], [[0, 0], [0, 0], [0, 0], [0, 0]], 1);
  quad([[x1, 0, zFront], [x1, 0, zBack], [x1, wallH, zBack], [x1, wallH, zFront]], [[0, 0], [0, 0], [0, 0], [0, 0]], 1);
  tri([[x0, wallH, zBack], [x0, wallH, zFront], [x0, ridge, zMid]], 1);
  tri([[x1, wallH, zFront], [x1, wallH, zBack], [x1, ridge, zMid]], 1);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  for (const gr of groups) g.addGroup(gr.start, gr.count, gr.material);
  g.computeVertexNormals();
  const roofSide = texturedMaterial(tex);
  roofSide.side = THREE.DoubleSide; // the roof's underside shows past the eaves
  const plain = new THREE.MeshStandardNodeMaterial({ color: LABEL_RAMPS.wall[1], roughness: 0.95 });
  plain.side = THREE.DoubleSide;
  return shadowed(new THREE.Mesh(g, [roofSide, plain]));
}

/** Lean rotation shared by cards and extruded props: tips the top back (−z). */
function leanBasis(params: StyleParams) {
  const a = (params.propLean * Math.PI) / 180;
  return { up: [0, Math.cos(a), -Math.sin(a)] as const, out: [0, Math.sin(a), Math.cos(a)] as const };
}

/** Upright cut-out cards (one quad per step) showing each prop's 16×16 pixels. */
export function cards(props: StepProp[], image: Image, tex: THREE.Texture, params: StyleParams, scaleOf: (p: StepProp) => number) {
  const { up } = leanBasis(params);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const p of props) {
    const s = scaleOf(p);
    const cx = p.sx + 0.5;
    const cz = p.sy + 0.75;
    const base = pos.length / 3;
    for (const [dx, dy] of [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]] as const) {
      pos.push(cx + dx * s, -0.02 + up[1] * dy * s, cz + up[2] * dy * s);
      uv.push((p.sx * 16 + (dx + 0.5) * 16) / image.width, (p.sy * 16 + (1 - dy) * 16) / image.height);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return shadowed(new THREE.Mesh(g, texturedMaterial(tex, { cutout: true })));
}

/**
 * Props built from their pixels as voxels (hybrid). `round` props (trees) swell out of the card
 * plane by each row's width, so a canopy becomes a rounded volume; the rest are flat slabs
 * `propDepth` thick. Both lean back like cards.
 */
export function voxelProps(
  props: StepProp[],
  region: Region,
  image: Image,
  tex: THREE.Texture,
  params: StyleParams,
  scaleOf: (p: StepProp) => number,
  round: (p: StepProp) => boolean,
  groundY: (p: StepProp) => number = () => 0,
): THREE.Group {
  // Props drawn with the same four tiles look identical, so each look is meshed once and
  // instanced: a city's worth of trees is a handful of shapes. Instances are binned into
  // 16-step squares so frustum culling can skip the bins off screen.
  const BIN = 16;
  const looks = new Map<string, StepProp[]>();
  const bins = new Map<string, StepProp[]>();
  for (const p of props) {
    const t = (dx: number, dy: number) => region.tiles[(p.sy * 2 + dy) * region.widthTiles + p.sx * 2 + dx];
    const look = `${t(0, 0)},${t(1, 0)},${t(0, 1)},${t(1, 1)},${scaleOf(p)},${round(p)}`;
    if (!looks.has(look)) looks.set(look, [p]);
    const bin = `${look}|${Math.floor(p.sx / BIN)},${Math.floor(p.sy / BIN)}`;
    bins.set(bin, [...(bins.get(bin) ?? []), p]);
  }
  const group = new THREE.Group();
  const material = texturedMaterial(tex);
  const geometries = new Map([...looks].map(([look, [p]]) => [look, geometryFrom(voxelProp(p!, region, image, params, scaleOf, round))]));
  const m = new THREE.Matrix4();
  for (const [bin, list] of bins) {
    const mesh = shadowed(new THREE.InstancedMesh(geometries.get(bin.split("|")[0]!)!, material, list.length));
    list.forEach((p, i) => mesh.setMatrixAt(i, m.makeTranslation(p.sx + 0.5, groundY(p), p.sy + 0.75)));
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

/** One voxel prop, centred on its card's base, textured from where it sits in `image`. */
function voxelProp(
  p: StepProp,
  region: Region,
  image: Image,
  params: StyleParams,
  scaleOf: (p: StepProp) => number,
  round: (p: StepProp) => boolean,
): MeshArrays[] {
  const { up, out } = leanBasis(params);
  const s = scaleOf(p);
  const px = s / 16;
  const opaque = (i: number) => image.data[((p.sy * 16 + (i >> 4)) * image.width + p.sx * 16 + (i & 15)) * 4 + 3]! > 0;
  const half = new Float32Array(256).fill(NaN);
  for (let row = 0; row < 16; row++) {
    let min = 16, max = -1;
    for (let x = 0; x < 16; x++) {
      if (!opaque(row * 16 + x)) continue;
      min = Math.min(min, x);
      max = Math.max(max, x);
    }
    if (max < 0) continue;
    const r = (max - min + 1) / 2;
    const c = (min + max + 1) / 2;
    for (let x = min; x <= max; x++) {
      const i = row * 16 + x;
      if (!opaque(i)) continue;
      const shade = region.shades[(p.sy * 16 + row) * image.width + p.sx * 16 + x]!;
      // Darker pixels (outlines, shadowed leaves) sit one pixel deeper.
      const recess = shade >= 2 ? 1 : 0;
      const depthPx = round(p)
        ? Math.max(1, Math.ceil(Math.sqrt(Math.max(0, r * r - (x + 0.5 - c) ** 2))) - recess)
        : Math.max(1, Math.round((params.propDepth / 2) * 16) - recess);
      half[i] = depthPx * px;
    }
  }
  // Grid y runs down the image from the card's top-left corner; columns grow both ways.
  const origin = [-s / 2, -0.02 + up[1] * s, up[2] * s] as const;
  return [1, -1].map((side) =>
    meshHeightfield({
      width: 16,
      height: 16,
      heights: half,
      base: 0,
      uv: (x, y) => [(p.sx * 16 + x) / image.width, (p.sy * 16 + y) / image.height],
      origin,
      ax: [px, 0, 0],
      ay: [0, -up[1] * px, -up[2] * px],
      ah: [out[0] * side, out[1] * side, out[2] * side],
    }),
  );
}
