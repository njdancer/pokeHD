import { describe, expect, it } from "vitest";
import * as THREE from "three/webgpu";
import { fakeWorld } from "./fake-world.ts";
import { GHOST_DELAY, type GhostState } from "./ghosts.ts";
import type { ChunkJob } from "./chunk.ts";
import { inPlaceBuilder, type ChunkBuilder, type ChunkResult } from "./chunk-builder.ts";
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

  it("adds a new chunk to the scene only once its shaders are compiled", async () => {
    const live = createLiveWorld(fakeWorld());
    const pending: (() => void)[] = [];
    live.setCompiler(() => new Promise<void>((resolve) => pending.push(resolve)));
    live.push(walk()[0]!, 0);
    live.update(0, camera, new THREE.Vector3(), false);
    expect(live.chunks.get(0)).toBe("built");
    const group = live.root.getObjectByName("hybrid");
    expect(group).toBeUndefined(); // built, still compiling
    expect(pending).toHaveLength(1);
    pending[0]!();
    await Promise.resolve();
    expect(live.root.getObjectByName("hybrid")?.parent).toBe(live.root);
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

describe("createLiveWorld with a background builder", () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 20, 20);
  /** Builds in place but hands results over only when `flush` is called, like a worker. */
  const deferred = () => {
    const local = inPlaceBuilder(fakeWorld());
    const queue: { job: ChunkJob; resolve: (r: ChunkResult) => void }[] = [];
    const builder: ChunkBuilder = {
      build: (job) => new Promise((resolve) => queue.push({ job, resolve })),
      dispose() {},
    };
    const flush = async () => {
      for (const q of queue.splice(0)) q.resolve(local.build(q.job) as ChunkResult);
      await Promise.resolve();
      await Promise.resolve();
    };
    return { builder, queue, flush };
  };

  it("builds one chunk at a time and shows it when it arrives", async () => {
    const { builder, queue, flush } = deferred();
    const live = createLiveWorld(fakeWorld(), { builder });
    live.push(walk()[0]!, 0);
    live.update(0, camera, new THREE.Vector3(), false);
    live.update(0, camera, new THREE.Vector3(), false);
    expect(queue.map((q) => q.job.map)).toEqual([0]);
    expect(live.chunks.get(0)).toBe("queued");
    await flush();
    expect(live.chunks.get(0)).toBe("built");
    expect(live.root.getObjectByName("hybrid")?.parent).toBe(live.root);
    live.update(0, camera, new THREE.Vector3(), false);
    expect(queue.map((q) => q.job.map)).toEqual([1]);
    live.dispose();
  });

  it("keeps a chunk that arrives after the player warped away, for when they come back", async () => {
    const { builder, queue, flush } = deferred();
    const live = createLiveWorld(fakeWorld(), { builder });
    const base = walk()[0]!;
    live.push(base, 0);
    live.update(0, camera, new THREE.Vector3(), false);
    live.push({ ...base, mapId: 2, player: { ...base.player, x: 0, y: 0 }, fade: 1 }, GB_FRAME_SECONDS);
    await flush(); // map A lands after the warp
    expect(live.root.getObjectByName("hybrid")).toBeUndefined();
    live.push(base, 2 * GB_FRAME_SECONDS);
    live.update(0, camera, new THREE.Vector3(), false);
    expect(live.chunks.get(0)).toBe("built"); // revived, not rebuilt
    expect(queue.map((q) => q.job.map)).toEqual([1]);
    live.dispose();
  });
});

describe("createLiveWorld holding the view while it loads", () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 20, 20);
  const fadeOf = (live: ReturnType<typeof createLiveWorld>) => {
    const quad = live.root.children.find((o) => o.renderOrder === 1000) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicNodeMaterial>;
    return quad.visible ? quad.material.opacity : 0;
  };
  const setup = () => {
    const local = inPlaceBuilder(fakeWorld());
    const queue: { job: ChunkJob; resolve: (r: ChunkResult) => void }[] = [];
    const builder: ChunkBuilder = { build: (job) => new Promise((resolve) => queue.push({ job, resolve })), dispose() {} };
    const flush = async () => {
      for (const q of queue.splice(0)) q.resolve(local.build(q.job) as ChunkResult);
      await Promise.resolve();
      await Promise.resolve();
    };
    let now = 0;
    const live = createLiveWorld(fakeWorld(), { builder, clock: () => now });
    const tick = (t: number) => {
      now = t;
      live.update(0, camera, new THREE.Vector3(), false);
    };
    return { live, flush, tick };
  };

  it("stays black until the map and the neighbours in view are drawn, then fades up", async () => {
    const { live, flush, tick } = setup();
    const base = walk()[0]!;
    live.push(base, 0);
    tick(0);
    expect(live.ready).toBe(false);
    expect(fadeOf(live)).toBe(1);
    await flush(); // map A
    tick(0.1);
    expect(live.ready).toBe(false); // map B, just north, isn't drawn yet
    expect(fadeOf(live)).toBe(1);
    await flush(); // map B
    tick(0.2);
    expect(live.ready).toBe(true);
    expect(fadeOf(live)).toBeGreaterThan(0);
    tick(0.3);
    tick(0.4);
    tick(0.5);
    expect(fadeOf(live)).toBe(0);
    live.dispose();
  });

  it("goes black again on a warp, whatever the game's fade says, until the new map is drawn", async () => {
    const { live, flush, tick } = setup();
    const base = walk()[0]!;
    live.push(base, 0);
    tick(0);
    await flush();
    tick(0.1);
    await flush();
    for (let t = 0.2; t < 1; t += 0.1) tick(t);
    expect(fadeOf(live)).toBe(0);
    live.push({ ...base, mapId: 2, player: { ...base.player, x: 0, y: 0 }, fade: 0 }, 1);
    tick(1);
    expect(live.ready).toBe(false);
    expect(fadeOf(live)).toBe(1);
    await flush();
    tick(1.1);
    expect(live.ready).toBe(true);
    live.dispose();
  });

  it("never holds the view across a connection", async () => {
    const { live, flush, tick } = setup();
    const frames = walk();
    live.push(frames[0]!, 0);
    tick(0);
    await flush();
    tick(0.1);
    await flush();
    let t = 0.2;
    for (const state of frames) {
      live.push(state, t);
      tick((t += GB_FRAME_SECONDS));
      if (t > 1) expect(live.ready).toBe(true);
      await flush();
    }
    expect(frames.at(-1)!.mapId).toBe(1);
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
