import { describe, expect, it } from "vitest";
import * as THREE from "three/webgpu";
import { fakeWorld } from "./fake-world.ts";
import { GHOST_DELAY, type GhostState } from "./ghosts.ts";
import { createLiveWorld, GB_FRAME_SECONDS } from "./live.ts";
import { asGhost, scriptedWalk } from "./playback.ts";

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

  it("reuses the chunks it left on a warp when the player comes back", () => {
    const live = createLiveWorld(fakeWorld());
    const base = walk()[0]!;
    const settle = () => {
      for (let i = 0; i < 4; i++) live.update(0, camera, new THREE.Vector3(), false);
    };
    live.push(base, 0);
    settle();
    const before = live.builds.length;
    const groupOfA = live.root.getObjectByName("hybrid");
    live.push({ ...base, mapId: 2, player: { ...base.player, x: 0, y: 0 }, fade: 1 }, GB_FRAME_SECONDS);
    settle();
    expect(groupOfA?.parent).toBeNull(); // left, not drawn
    live.push(base, 2 * GB_FRAME_SECONDS);
    settle();
    expect(live.builds.length).toBe(before + 1); // only map C was built
    expect(groupOfA?.parent).toBe(live.root);
    expect(live.chunks.get(0)).toBe("built");
    live.dispose();
  });
});

describe("ghosts", () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 20, 20);
  const friend = (mapId: number, x: number, y: number, step: GhostState["step"] = null): GhostState => ({
    id: "f1", name: "Gary", mapId, x, y, step, animFrame: 0,
  });

  it("appear, move, change map and leave", () => {
    let now = 0;
    const live = createLiveWorld(fakeWorld(), { clock: () => now });
    const tick = (t: number) => {
      now = t;
      live.update(0, camera, new THREE.Vector3(), false);
    };
    live.push(walk()[0]!, 0); // the local player stands on map A
    tick(0);
    tick(0);
    const group = live.root.getObjectByName("ghosts")!;
    const sprite = () => group.children[0]!;

    // Appear: on the local player's map, at the cell its presence names.
    live.setGhosts([friend(0, 1, 1)], 0);
    tick(0);
    expect(live.ghosts.get("f1")).toBe(true);
    expect(sprite().position.x).toBeCloseTo(1.5);
    expect(sprite().position.z).toBeCloseTo(1.6);

    // Move: a step east, drawn GHOST_DELAY behind the newest sample.
    live.setGhosts([friend(0, 1, 1, { dx: 1, dy: 0, progress: 0.5 })], 0.1);
    live.setGhosts([friend(0, 2, 1)], 0.2);
    tick(0.1 + GHOST_DELAY + 0.05);
    expect(sprite().position.x).toBeCloseTo(2.25);
    tick(0.2 + GHOST_DELAY);
    expect(sprite().position.x).toBeCloseTo(2.5);

    // Change map across the connection to B (loaded): it slides, it doesn't jump.
    live.setGhosts([friend(0, 2, 0, { dx: 0, dy: -1, progress: 0.5 })], 0.3);
    live.setGhosts([friend(1, 4, 1)], 0.4); // B is one block west of A, two steps tall: same cell
    tick(0.3 + GHOST_DELAY);
    let before = sprite().position.clone();
    for (let t = 0.3; t <= 0.4 + GHOST_DELAY + 1e-9; t += 0.02) {
      tick(t + GHOST_DELAY);
      expect(sprite().position.distanceTo(before)).toBeLessThanOrEqual(0.5);
      before = sprite().position.clone();
    }
    expect(sprite().position.x).toBeCloseTo(2.5);
    expect(sprite().position.z).toBeCloseTo(-0.4);
    expect(live.ghosts.get("f1")).toBe(true);

    // Change map to one that isn't loaded (a warp to C): not drawn once the delay catches up.
    live.setGhosts([friend(2, 0, 0)], 0.5);
    tick(0.5 + GHOST_DELAY - 0.02);
    expect(live.ghosts.get("f1")).toBe(true);
    tick(0.5 + GHOST_DELAY);
    expect(live.ghosts.get("f1")).toBe(false);
    expect(sprite().visible).toBe(false);

    // Back on a loaded map: drawn again, without sliding from C.
    live.setGhosts([friend(0, 0, 0)], 0.6);
    tick(0.6 + GHOST_DELAY);
    expect(live.ghosts.get("f1")).toBe(true);
    expect(sprite().position.x).toBeCloseTo(0.5);

    // Leave: missing from the set.
    live.setGhosts([], 0.7);
    tick(0.7 + GHOST_DELAY);
    expect(live.ghosts.has("f1")).toBe(false);
    expect(group.children).toHaveLength(0);
    live.dispose();
  });

  it("a ghost on a map the local player has warped away from disappears", () => {
    let now = 0;
    const live = createLiveWorld(fakeWorld(), { clock: () => now });
    const base = walk()[0]!;
    live.push(base, 0);
    live.update(0, camera, new THREE.Vector3(), false);
    live.setGhosts([friend(0, 1, 1)], 0);
    now = 1;
    live.update(0, camera, new THREE.Vector3(), false);
    expect(live.ghosts.get("f1")).toBe(true);
    live.push({ ...base, mapId: 2, player: { ...base.player, x: 0, y: 0 } }, 1);
    live.update(0, camera, new THREE.Vector3(), false);
    expect(live.ghosts.get("f1")).toBe(false);
    live.dispose();
  });

  it("plays a scripted walk back as a ghost", () => {
    const frames = walk();
    const g = asGhost("f2", "Blue", frames[10]!);
    expect(g).toMatchObject({ id: "f2", name: "Blue", mapId: frames[10]!.mapId, x: frames[10]!.player.x });
  });
});
