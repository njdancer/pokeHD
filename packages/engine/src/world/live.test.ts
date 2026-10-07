import { describe, expect, it } from "vitest";
import * as THREE from "three/webgpu";
import { fakeWorld } from "./fake-world.ts";
import { createLiveWorld, GB_FRAME_SECONDS } from "./live.ts";
import { scriptedWalk } from "./playback.ts";

// Map A (2×2 blocks) has map B (3×1) to its north, starting one block further west; C stands alone.
const walk = () => scriptedWalk(fakeWorld(), { maps: [0, 1], start: { map: 0, x: 2, y: 3 }, goal: { map: 1, x: 3, y: 0 } });

describe("scriptedWalk", () => {
  it("walks across the connection one 8-frame step at a time", () => {
    const frames = walk();
    expect(frames[0]!.mapId).toBe(0);
    expect(frames.at(-1)!.mapId).toBe(1);
    const progress = frames.map((f) => f.player.step?.progress).filter((p) => p !== undefined);
    expect(progress.slice(0, 7)).toEqual([1, 2, 3, 4, 5, 6, 7].map((n) => n / 8));
  });
});

describe("createLiveWorld", () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 20, 20);

  it("follows the player across a connection without rebuilding or jumping", () => {
    const live = createLiveWorld(fakeWorld());
    const frames = walk();
    let previous: THREE.Vector3 | null = null;
    let groupOfA: THREE.Object3D | undefined;
    frames.forEach((state, i) => {
      live.push(state, i * GB_FRAME_SECONDS);
      live.update(0, camera, new THREE.Vector3(0, 1, 0), false);
      // Pushed states are a frame apart; the drawn position never moves more than a step.
      if (previous) expect(live.target.distanceTo(previous)).toBeLessThanOrEqual(1);
      previous = live.target.clone();
      if (i === 5) groupOfA = live.root.getObjectByName("hybrid");
    });
    expect(live.chunks.get(0)).toBe("built");
    expect(live.chunks.get(1)).toBe("built");
    expect(groupOfA?.parent).toBe(live.root); // A's chunk survived the crossing
    live.dispose();
  });

  it("starts over around the new map on a warp", () => {
    const live = createLiveWorld(fakeWorld());
    const base = walk()[0]!;
    live.push(base, 0);
    live.update(0, camera, new THREE.Vector3(), false);
    live.update(0, camera, new THREE.Vector3(), false);
    live.push({ ...base, mapId: 2, player: { ...base.player, x: 0, y: 0 }, fade: 1 }, GB_FRAME_SECONDS);
    live.update(0, camera, new THREE.Vector3(), false);
    expect([...live.chunks.keys()]).toEqual([2]);
    live.dispose();
  });
});
