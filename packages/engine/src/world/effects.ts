import * as THREE from "three/webgpu";
import { color, float, floor, hash, instanceIndex, mix, positionLocal, positionWorld, sin, smoothstep, time, uv, vec3 } from "three/tsl";
import { LABEL_RAMPS } from "./palette.ts";
import type { StyleParams } from "./params.ts";
import { TILE_UNITS } from "./region.ts";

// Hybrid-only extras: instanced grass blades and shader water.

/** Swaying blades scattered over tall-grass tiles. */
export function grass(tiles: { tx: number; ty: number }[], params: StyleParams): THREE.InstancedMesh {
  // A tapered blade, three segments tall, so it can bend.
  const blade = new THREE.BufferGeometry();
  const rows = [0, 0.4, 0.75, 1];
  const pos: number[] = [];
  const uvs: number[] = [];
  rows.forEach((y, i) => {
    const w = 0.035 * (1 - y * 0.85);
    if (i === rows.length - 1) {
      pos.push(0, y, 0);
      uvs.push(0.5, y);
    } else {
      pos.push(-w, y, 0, w, y, 0);
      uvs.push(0, y, 1, y);
    }
  });
  blade.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  blade.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  blade.setIndex([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4, 4, 5, 6]);
  blade.computeVertexNormals();

  const ramp = LABEL_RAMPS["tall-grass"];
  const material = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.8 });
  const t = uv().y;
  material.colorNode = mix(color(ramp[3]), mix(color(ramp[2]), color(ramp[1]), t), smoothstep(0, 0.35, t));
  const phase = hash(instanceIndex).mul(6.283);
  const bend = positionLocal.y.mul(positionLocal.y);
  const sway = sin(time.mul(1.8).add(phase)).mul(0.12).mul(bend);
  material.positionNode = positionLocal.add(vec3(sway, 0, sway.mul(0.4)));

  const count = Math.round(tiles.length * params.grassDensity);
  const mesh = new THREE.InstancedMesh(blade, material, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    const tile = tiles[i % tiles.length]!;
    const h = params.grassHeight * (0.7 + rand() * 0.6);
    e.set((rand() - 0.5) * 0.4, rand() * Math.PI, (rand() - 0.5) * 0.4);
    m.compose(
      new THREE.Vector3((tile.tx + rand()) * TILE_UNITS, 0, (tile.ty + rand()) * TILE_UNITS),
      q.setFromEuler(e),
      new THREE.Vector3(h * 1.4, h, h),
    );
    mesh.setMatrixAt(i, m);
  }
  mesh.receiveShadow = true;
  return mesh;
}

/** Animated water over water tiles, rippling on the 16-px-per-unit pixel grid so it stays crisp. */
export function water(tiles: { tx: number; ty: number }[], y: number): THREE.Mesh {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const { tx, ty } of tiles) {
    const x0 = tx * TILE_UNITS, x1 = x0 + TILE_UNITS, z0 = ty * TILE_UNITS, z1 = z0 + TILE_UNITS;
    const s = pos.length / 3;
    pos.push(x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0);
    idx.push(s, s + 1, s + 2, s, s + 2, s + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();

  const ramp = LABEL_RAMPS.water;
  const q = floor(positionWorld.xz.mul(16)).div(16);
  const t = time;
  const wave = sin(q.x.mul(2.3).add(t.mul(1.1)))
    .add(sin(q.y.mul(3.1).sub(t.mul(0.8))))
    .add(sin(q.x.add(q.y).mul(1.7).add(t.mul(0.6))));
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.12, metalness: 0 });
  const base = mix(color(ramp[2]), color(ramp[1]), smoothstep(-1.5, 1.5, wave));
  material.colorNode = mix(base, color(ramp[0]), smoothstep(float(2.1), float(2.6), wave));
  const mesh = new THREE.Mesh(g, material);
  mesh.receiveShadow = true;
  return mesh;
}
