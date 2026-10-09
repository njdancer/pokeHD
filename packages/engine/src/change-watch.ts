import type * as THREE from "three/webgpu";

// The engine draws a frame only when it would differ from the last one (D34). Rather than have
// every piece of content report its changes, this reads what decides the picture straight off
// the scene graph: each visible object's transform, and each mesh's geometry, material and
// texture version (a sprite changes pose by swapping geometry). Values that live outside the
// graph (the camera, the time of day) come in as `extra`. Content that changes pictures any
// other way (a uniform, a vertex attribute) has to ask for frames itself.

export interface ChangeWatch {
  /** Whether anything differs from the previous call. The first call always says yes. */
  changed(root: THREE.Object3D, extra: readonly number[]): boolean;
}

export function createChangeWatch(): ChangeWatch {
  let prev = new Float64Array(4096);
  let next = new Float64Array(4096);
  let prevLength = -1;
  let n = 0;
  let same = true;
  const put = (v: number) => {
    if (n === next.length) {
      const grown = new Float64Array(next.length * 2);
      grown.set(next);
      next = grown;
    }
    if (same && (n >= prevLength || prev[n] !== v)) same = false;
    next[n++] = v;
  };
  const putMaterial = (m: THREE.Material) => {
    put((m as unknown as { id: number }).id); // three.js numbers every material; its types omit it
    put(m.version);
    put(m.opacity);
    put((m as THREE.MeshStandardMaterial).map?.version ?? -1);
  };
  const visit = (o: THREE.Object3D) => {
    put(o.id);
    const { position: p, quaternion: q, scale: s } = o;
    put(p.x);
    put(p.y);
    put(p.z);
    put(q.x);
    put(q.y);
    put(q.z);
    put(q.w);
    put(s.x);
    put(s.y);
    put(s.z);
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    put(mesh.geometry.id);
    if (Array.isArray(mesh.material)) mesh.material.forEach(putMaterial);
    else putMaterial(mesh.material);
    const instanced = o as THREE.InstancedMesh;
    if (instanced.isInstancedMesh) {
      put(instanced.count);
      put(instanced.instanceMatrix.version);
    }
  };
  return {
    changed(root, extra) {
      n = 0;
      same = true;
      for (const v of extra) put(v);
      root.traverseVisible(visit);
      if (n !== prevLength) same = false;
      [prev, next] = [next, prev];
      prevLength = n;
      return !same;
    },
  };
}
