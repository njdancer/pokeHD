import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { createChangeWatch } from "./change-watch.ts";

describe("createChangeWatch", () => {
  const scene = () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
    root.add(mesh);
    return { root, mesh };
  };

  it("says yes first, then only when something drawn changes", () => {
    const { root, mesh } = scene();
    const watch = createChangeWatch();
    expect(watch.changed(root, [1])).toBe(true);
    expect(watch.changed(root, [1])).toBe(false);
    mesh.position.x = 0.5;
    expect(watch.changed(root, [1])).toBe(true);
    expect(watch.changed(root, [1])).toBe(false);
    expect(watch.changed(root, [2])).toBe(true);
  });

  it("sees a sprite change pose (a geometry swap) and a texture update", () => {
    const { root, mesh } = scene();
    const watch = createChangeWatch();
    watch.changed(root, []);
    mesh.geometry = new THREE.PlaneGeometry();
    expect(watch.changed(root, [])).toBe(true);
    const material = mesh.material as THREE.MeshBasicMaterial;
    material.map = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    expect(watch.changed(root, [])).toBe(true);
    material.map.needsUpdate = true;
    expect(watch.changed(root, [])).toBe(true);
    expect(watch.changed(root, [])).toBe(false);
  });

  it("sees objects appear and disappear, but not changes to hidden ones", () => {
    const { root, mesh } = scene();
    const watch = createChangeWatch();
    watch.changed(root, []);
    root.add(new THREE.Object3D());
    expect(watch.changed(root, [])).toBe(true);
    mesh.visible = false;
    expect(watch.changed(root, [])).toBe(true);
    mesh.position.y = 3;
    expect(watch.changed(root, [])).toBe(false);
  });

  it("grows past its first buffer", () => {
    const root = new THREE.Group();
    for (let i = 0; i < 400; i++) root.add(new THREE.Object3D());
    const watch = createChangeWatch();
    expect(watch.changed(root, [])).toBe(true);
    expect(watch.changed(root, [])).toBe(false);
    root.children[399]!.position.z = 1;
    expect(watch.changed(root, [])).toBe(true);
  });
});
