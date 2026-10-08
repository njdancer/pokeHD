import { describe, expect, it } from "vitest";
import * as THREE from "three/webgpu";
import { buildChunk, deserializeGroup, serializeGroup, type ChunkJob } from "./chunk.ts";
import { grass, water } from "./effects.ts";
import { fakeWorld } from "./fake-world.ts";
import { DEFAULT_STYLE_PARAMS } from "./params.ts";
import { PLAIN_COLOURS } from "./place.ts";

const job = (map: number): ChunkJob => ({
  map: map as ChunkJob["map"], rects: [{ id: map, x0: 0, y0: 0, x1: 2, y1: 2 }], marginBlocks: 1,
  style: "hybrid", params: DEFAULT_STYLE_PARAMS, colours: PLAIN_COLOURS,
});

/** Everything about a tree that serialisation should keep, as plain data. */
function describe3(root: THREE.Object3D) {
  const out: unknown[] = [];
  root.traverse((o) => {
    const entry: Record<string, unknown> = { type: o.type, name: o.name, matrix: o.matrix.toArray(), cast: o.castShadow, receive: o.receiveShadow };
    if (o instanceof THREE.Mesh) {
      const g = o.geometry as THREE.BufferGeometry;
      entry["attributes"] = Object.fromEntries(Object.entries(g.attributes).map(([k, a]) => [k, Array.from((a as THREE.BufferAttribute).array)]));
      entry["index"] = g.index ? Array.from(g.index.array) : null;
      entry["groups"] = g.groups;
      entry["materials"] = [o.material].flat().map((m: THREE.MeshStandardNodeMaterial) => ({
        type: m.type, recipe: m.userData["recipe"], color: m.color.getHex(), roughness: m.roughness, side: m.side,
        alphaTest: m.alphaTest, map: m.map ? Array.from((m.map.image as { data: Uint8Array }).data) : null,
      }));
      if (o instanceof THREE.InstancedMesh) entry["instances"] = [o.count, Array.from(o.instanceMatrix.array)];
    }
    out.push(entry);
  });
  return out;
}

describe("chunk serialisation", () => {
  it("rebuilds a built chunk exactly", () => {
    const built = buildChunk(fakeWorld(), job(0));
    built.group.updateMatrixWorld(true);
    const before = describe3(built.group);
    const { data, transfer } = serializeGroup(built.group);
    expect(transfer.length).toBeGreaterThan(0);
    const copy = deserializeGroup(structuredClone(data));
    copy.updateMatrixWorld(true);
    expect(describe3(copy)).toEqual(before);
  });

  it("remakes node materials from their recipes", () => {
    const group = new THREE.Group();
    group.add(grass([{ tx: 0, ty: 0 }, { tx: 1, ty: 0 }], DEFAULT_STYLE_PARAMS), water([{ tx: 0, ty: 1 }], -0.08));
    const copy = deserializeGroup(structuredClone(serializeGroup(group).data));
    const [g, w] = copy.children as THREE.Mesh[];
    expect(g).toBeInstanceOf(THREE.InstancedMesh);
    expect((g!.material as THREE.Material).userData["recipe"]).toBe("grass");
    expect((w!.material as THREE.MeshStandardNodeMaterial).colorNode).toBeTruthy();
  });

  it("refuses node materials it can't remake", () => {
    const m = new THREE.MeshStandardNodeMaterial();
    m.colorNode = new THREE.Node("vec3") as never;
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.PlaneGeometry(), m));
    expect(() => serializeGroup(group)).toThrow(/no recipe/);
  });
});
