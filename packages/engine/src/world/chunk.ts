import * as THREE from "three/webgpu";
import { LABEL_TABLES, type MapId, type WorldData } from "@pokehd/rom";
import { grassMaterial, waterMaterial } from "./effects.ts";
import type { StyleParams } from "./params.ts";
import type { PlaceColours } from "./place.ts";
import { buildRegion } from "./region.ts";
import { buildFlat, buildStyle, type StyleId } from "./styles.ts";

// One live-world chunk: a map built from ROM data, with the border blocks it owns. Building one
// takes 30–200 ms of CPU, so the live world does it in a worker (./chunk-worker.ts) and gets the
// result back as plain arrays (`serializeGroup`), which turn back into three.js objects on the
// main thread in a millisecond or two (`deserializeGroup`). Without workers (tests, Node) the
// same build runs in place.

/** A map's footprint in world blocks. */
export interface BlockRect {
  id: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ChunkJob {
  map: MapId;
  /** The map's own rect first, then its connected neighbours'. */
  rects: BlockRect[];
  marginBlocks: number;
  style: StyleId;
  params: StyleParams;
  colours: PlaceColours;
}

export interface BuiltChunk {
  group: THREE.Group;
  /** Where the root map's origin sits in the built region, in region tiles. */
  rootX: number;
  rootY: number;
}

export function buildChunk(world: WorldData, job: ChunkJob): BuiltChunk {
  const self = job.rects[0]!;
  const distance = (r: BlockRect, x: number, y: number) => Math.max(r.x0 - x, x - (r.x1 - 1), r.y0 - y, y - (r.y1 - 1), 0);
  // A border block belongs to the nearest map (lowest ID on ties), so neighbouring chunks
  // share the border without drawing it twice; none is drawn over a neighbouring map.
  const drawBorder = (x: number, y: number) => {
    const ax = self.x0 + x;
    const ay = self.y0 + y;
    let best = self;
    let bestD = Infinity;
    for (const r of job.rects) {
      const d = distance(r, ax, ay);
      if (d === 0 && r.id !== self.id) return false;
      if (d < bestD || (d === bestD && r.id < best.id)) {
        best = r;
        bestD = d;
      }
    }
    return best.id === self.id;
  };
  const region = buildRegion(world, job.map, { marginBlocks: job.marginBlocks, drawBorder });
  const labelled = LABEL_TABLES[world.tilesets[world.maps[job.map]!.tileset]!.name] !== undefined;
  const group = labelled ? buildStyle(job.style, region, job.params, job.colours) : buildFlat(region);
  return { group, rootX: region.rootX, rootY: region.rootY };
}

// Serialising a built group. Materials made from nodes (TSL) can't be copied, so those carry a
// `userData.recipe` naming the factory that makes them again; the rest are plain standard
// materials described by their fields.

/** Factories for node materials, by `userData.recipe`. */
const RECIPES: Record<string, () => THREE.Material> = { grass: grassMaterial, water: waterMaterial };

interface TextureData {
  data: Uint8Array;
  width: number;
  height: number;
  magFilter: THREE.MagnificationTextureFilter;
  minFilter: THREE.MinificationTextureFilter;
  generateMipmaps: boolean;
  colorSpace: string;
  flipY: boolean;
  wrapS: THREE.Wrapping;
  wrapT: THREE.Wrapping;
}

type MaterialData =
  | { recipe: string }
  | {
      color: number;
      roughness: number;
      metalness: number;
      side: THREE.Side;
      alphaTest: number;
      transparent: boolean;
      opacity: number;
      /** Index into `SerializedGroup.textures`. */
      map: number | null;
    };

interface AttributeData {
  array: THREE.TypedArray;
  itemSize: number;
  normalized: boolean;
}

interface GeometryData {
  attributes: Record<string, AttributeData>;
  index: AttributeData | null;
  groups: { start: number; count: number; materialIndex?: number }[];
  sphere: [number, number, number, number] | null;
}

interface ObjectData {
  kind: "group" | "mesh" | "instanced";
  name: string;
  matrix: number[];
  castShadow: boolean;
  receiveShadow: boolean;
  frustumCulled: boolean;
  renderOrder: number;
  visible: boolean;
  geometry?: GeometryData;
  /** Indices into `SerializedGroup.materials`; one, or one per geometry group. */
  material?: number | number[];
  instances?: { count: number; matrices: Float32Array; sphere: [number, number, number, number] | null };
  children: ObjectData[];
}

export interface SerializedGroup {
  root: ObjectData;
  textures: TextureData[];
  materials: MaterialData[];
}

const sphereData = (s: THREE.Sphere | null): [number, number, number, number] | null =>
  s ? [s.center.x, s.center.y, s.center.z, s.radius] : null;
const toSphere = (s: [number, number, number, number] | null) =>
  s ? new THREE.Sphere(new THREE.Vector3(s[0], s[1], s[2]), s[3]) : null;

/**
 * Flattens `group` into plain data, and lists the buffers to transfer. Throws on anything it
 * can't describe (a node material with no recipe, a non-data texture).
 */
export function serializeGroup(group: THREE.Group): { data: SerializedGroup; transfer: ArrayBuffer[] } {
  const textures: TextureData[] = [];
  const textureIndex = new Map<THREE.Texture, number>();
  const materials: MaterialData[] = [];
  const materialIndex = new Map<THREE.Material, number>();
  const transfer = new Set<ArrayBuffer>();
  const keep = <T extends THREE.TypedArray>(array: T): T => {
    transfer.add(array.buffer as ArrayBuffer);
    return array;
  };

  const texture = (t: THREE.Texture | null): number | null => {
    if (!t) return null;
    let i = textureIndex.get(t);
    if (i !== undefined) return i;
    if (!(t instanceof THREE.DataTexture)) throw new Error(`can't serialise texture ${t.type}`);
    const image = t.image as { data: Uint8Array; width: number; height: number };
    i = textures.length;
    textures.push({
      data: keep(image.data), width: image.width, height: image.height,
      magFilter: t.magFilter, minFilter: t.minFilter, generateMipmaps: t.generateMipmaps,
      colorSpace: t.colorSpace, flipY: t.flipY, wrapS: t.wrapS, wrapT: t.wrapT,
    });
    textureIndex.set(t, i);
    return i;
  };

  const material = (m: THREE.Material): number => {
    let i = materialIndex.get(m);
    if (i !== undefined) return i;
    const recipe = m.userData["recipe"] as string | undefined;
    let data: MaterialData;
    if (recipe) {
      if (!RECIPES[recipe]) throw new Error(`no material recipe ${recipe}`);
      data = { recipe };
    } else {
      if (!(m instanceof THREE.MeshStandardNodeMaterial)) throw new Error(`can't serialise material ${m.type}`);
      const n = m as unknown as Record<string, unknown>;
      for (const key of ["colorNode", "positionNode", "normalNode", "opacityNode", "emissiveNode", "roughnessNode", "metalnessNode", "outputNode", "fragmentNode", "vertexNode"]) {
        if (n[key]) throw new Error(`material has ${key} but no recipe`);
      }
      data = {
        color: m.color.getHex(), roughness: m.roughness, metalness: m.metalness, side: m.side,
        alphaTest: m.alphaTest, transparent: m.transparent, opacity: m.opacity, map: texture(m.map),
      };
    }
    i = materials.length;
    materials.push(data);
    materialIndex.set(m, i);
    return i;
  };

  const attribute = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): AttributeData => {
    if (!(a instanceof THREE.BufferAttribute)) throw new Error("can't serialise interleaved attributes");
    return { array: keep(a.array), itemSize: a.itemSize, normalized: a.normalized };
  };

  const geometry = (g: THREE.BufferGeometry): GeometryData => {
    if (!g.boundingSphere) g.computeBoundingSphere();
    return {
      attributes: Object.fromEntries(Object.entries(g.attributes).map(([k, a]) => [k, attribute(a)])),
      index: g.index ? attribute(g.index) : null,
      groups: g.groups.map((gr) => ({ ...gr })),
      sphere: sphereData(g.boundingSphere),
    };
  };

  const object = (o: THREE.Object3D): ObjectData => {
    o.updateMatrix();
    const out: ObjectData = {
      kind: "group", name: o.name, matrix: o.matrix.toArray(),
      castShadow: o.castShadow, receiveShadow: o.receiveShadow, frustumCulled: o.frustumCulled,
      renderOrder: o.renderOrder, visible: o.visible, children: o.children.map(object),
    };
    if (o instanceof THREE.Mesh) {
      out.kind = o instanceof THREE.InstancedMesh ? "instanced" : "mesh";
      out.geometry = geometry(o.geometry);
      out.material = Array.isArray(o.material) ? o.material.map(material) : material(o.material);
      if (o instanceof THREE.InstancedMesh) {
        if (!o.boundingSphere) o.computeBoundingSphere();
        out.instances = { count: o.count, matrices: keep(o.instanceMatrix.array as Float32Array), sphere: sphereData(o.boundingSphere) };
      }
    } else if (o.type !== "Group" && o.type !== "Object3D") {
      throw new Error(`can't serialise ${o.type}`);
    }
    return out;
  };

  const root = object(group);
  return { data: { root, textures, materials }, transfer: [...transfer] };
}

/** Rebuilds a group serialised by `serializeGroup`. */
export function deserializeGroup(data: SerializedGroup): THREE.Group {
  const textures = data.textures.map((t) => {
    const tex = new THREE.DataTexture(t.data, t.width, t.height);
    tex.magFilter = t.magFilter;
    tex.minFilter = t.minFilter;
    tex.generateMipmaps = t.generateMipmaps;
    tex.colorSpace = t.colorSpace;
    tex.flipY = t.flipY;
    tex.wrapS = t.wrapS;
    tex.wrapT = t.wrapT;
    tex.needsUpdate = true;
    return tex;
  });
  const materials = data.materials.map((m) => {
    if ("recipe" in m) return RECIPES[m.recipe]!();
    const out = new THREE.MeshStandardNodeMaterial({
      color: m.color, roughness: m.roughness, metalness: m.metalness, side: m.side,
      alphaTest: m.alphaTest, transparent: m.transparent, opacity: m.opacity,
    });
    if (m.map !== null) out.map = textures[m.map]!;
    return out;
  });
  const attribute = (a: AttributeData) => new THREE.BufferAttribute(a.array, a.itemSize, a.normalized);
  const geometry = (g: GeometryData) => {
    const out = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(g.attributes)) out.setAttribute(k, attribute(a));
    if (g.index) out.setIndex(attribute(g.index));
    for (const gr of g.groups) out.addGroup(gr.start, gr.count, gr.materialIndex);
    out.boundingSphere = toSphere(g.sphere);
    return out;
  };
  const object = (d: ObjectData): THREE.Object3D => {
    let o: THREE.Object3D;
    const material = d.material === undefined ? undefined
      : Array.isArray(d.material) ? d.material.map((i) => materials[i]!) : materials[d.material]!;
    if (d.kind === "instanced") {
      const mesh = new THREE.InstancedMesh(geometry(d.geometry!), material, d.instances!.count);
      mesh.instanceMatrix = new THREE.InstancedBufferAttribute(d.instances!.matrices, 16);
      mesh.boundingSphere = toSphere(d.instances!.sphere);
      o = mesh;
    } else if (d.kind === "mesh") {
      o = new THREE.Mesh(geometry(d.geometry!), material);
    } else {
      o = new THREE.Group();
    }
    o.name = d.name;
    o.matrix.fromArray(d.matrix);
    o.matrix.decompose(o.position, o.quaternion, o.scale);
    o.castShadow = d.castShadow;
    o.receiveShadow = d.receiveShadow;
    o.frustumCulled = d.frustumCulled;
    o.renderOrder = d.renderOrder;
    o.visible = d.visible;
    for (const c of d.children) o.add(object(c));
    return o;
  };
  return object(data.root) as THREE.Group;
}
