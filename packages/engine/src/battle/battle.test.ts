import { describe, expect, it } from "vitest";
import * as THREE from "three/webgpu";
import { fakeWorld } from "../world/fake-world.ts";
import { createLiveWorld } from "../world/live.ts";
import { createBattleLayer, type BattleView } from "./layer.ts";
import { backgroundMask, paint, pixelTexture, shade } from "./picture.ts";
import { arenaPlacement } from "./placement.ts";

const RAMP = [0xffffff, 0xaaaaaa, 0x555555, 0x000000] as const;

/** A picture: a colour-3 square with a colour-0 eye, on colour 0. */
function picture(version = 1) {
  const pixels = new Uint8Array(56 * 56);
  for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) pixels[y * 56 + x] = y === 30 && x === 30 ? 0 : 3;
  return { pixels, dx: 0, dy: 0, version };
}

function view(overrides: Partial<BattleView> = {}): BattleView {
  return {
    enemy: picture(),
    player: picture(),
    ramps: { player: RAMP, enemy: RAMP },
    objects: [],
    palettes: [0xe4, 0xe4, 0xe4],
    origin: { x: 0, y: 0 },
    ...overrides,
  };
}

describe("backgroundMask", () => {
  it("clears colour 0 reachable from the edge, and keeps it inside", () => {
    const { pixels } = picture();
    const mask = backgroundMask(pixels, 56, 56);
    expect(mask[0]).toBe(1);
    expect(mask[30 * 56 + 30]).toBe(0); // the eye
    expect(mask[25 * 56 + 25]).toBe(0);
  });

  it("reads palette registers like the Game Boy", () => {
    expect([0, 1, 2, 3].map((c) => shade(0xe4, c))).toEqual([0, 1, 2, 3]);
    expect([0, 1, 2, 3].map((c) => shade(0x1b, c))).toEqual([3, 2, 1, 0]);
  });
});

describe("arenaPlacement", () => {
  const world = fakeWorld();
  const map = world.maps[0]!;

  it("lines the battle up the way the player faces when there's room", () => {
    expect(arenaPlacement(world, map, { x: 0, y: 3, facing: "up" })).toEqual({
      player: { x: 0.5, z: 3.6 },
      enemy: { x: 0.5, z: 3.6 - 3 },
      ground: "grass",
    });
  });

  it("turns to the most open way when the way ahead is blocked", () => {
    // Up from (2, 3) is one step of ground, then the house; left has two steps.
    const placed = arenaPlacement(world, map, { x: 2, y: 3, facing: "up" });
    expect(placed.enemy).toEqual({ x: 2.5 - 2.5, z: 3.6 });
  });
});

describe("createBattleLayer", () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 10, 10);

  it("stands both pictures on their ground positions and frames them", () => {
    const layer = createBattleLayer("field");
    layer.place({ player: { x: 0, z: 0 }, enemy: { x: 0, z: -4 }, ground: "grass" });
    layer.push(view());
    layer.update(camera);
    const pictures = layer.root.children.filter((o) => o instanceof THREE.Mesh && o.visible && o.castShadow && o.geometry.type === "PlaneGeometry");
    expect(pictures).toHaveLength(2);
    const [player, enemy] = pictures.map((p) => p.position);
    expect(player!.distanceTo(new THREE.Vector3(0, 0, 0))).toBeCloseTo(0);
    expect(enemy!.distanceTo(new THREE.Vector3(0, 0, -4))).toBeCloseTo(0);
    expect(layer.target.z).toBeCloseTo(-2);
    // Behind the player's side (facing north), turned off the line.
    expect(layer.view.yaw).toBeGreaterThan(0);
    expect(layer.view.yaw).toBeLessThan(90);
    layer.push(view({ enemy: null }));
    layer.update(camera);
    expect(layer.root.children.filter((o) => o instanceof THREE.Mesh && o.visible && o.castShadow && o.geometry.type === "PlaneGeometry")).toHaveLength(1);
    layer.dispose();
  });

  it("shows bases and the stage only in their styles", () => {
    const layer = createBattleLayer("field");
    const cylinders = () => layer.root.children.filter((o) => o instanceof THREE.Mesh && (o.geometry as THREE.BufferGeometry).type === "CylinderGeometry");
    expect(cylinders().filter((o) => o.visible)).toHaveLength(0);
    layer.setStyle("bases");
    expect(cylinders().filter((o) => o.visible)).toHaveLength(2);
    layer.setStyle("stage");
    expect(cylinders().filter((o) => o.visible)).toHaveLength(1);
    expect(layer.hidesWorld).toBe(true);
    layer.dispose();
  });

  it("shakes the camera when the game moves the screen", () => {
    const layer = createBattleLayer();
    layer.place({ player: { x: 0, z: 0 }, enemy: { x: 0, z: -4 }, ground: "grass" });
    for (let i = 0; i < 30; i++) layer.push(view());
    layer.update(camera);
    const still = layer.target.clone();
    layer.push(view({ origin: { x: 3, y: 0 } }));
    layer.update(camera);
    expect(layer.target.distanceTo(still)).toBeGreaterThan(0);
    layer.dispose();
  });
});

describe("LiveWorld battles", () => {
  it("swings the camera to the battle and back", () => {
    let now = 0;
    const live = createLiveWorld(fakeWorld(), { clock: () => now });
    const camera = new THREE.PerspectiveCamera();
    const state = { mapId: 0, player: { x: 0, y: 3, step: null, animFrame: 0, facing: "up" as const }, npcs: [], fade: 0 };
    live.push(state, now);
    live.update(0, camera, new THREE.Vector3(), false);
    expect(live.view).toBeNull();
    live.setBattle(view());
    for (let i = 0; i < 120; i++) {
      now += 1 / 60;
      live.push(state, now);
      live.update(now, camera, new THREE.Vector3(), false);
    }
    expect(live.view).toMatchObject({ pitch: 24 });
    live.setBattle(null);
    for (let i = 0; i < 120; i++) {
      now += 1 / 60;
      live.push(state, now);
      live.update(now, camera, new THREE.Vector3(), false);
    }
    expect(live.view).toBeNull();
    live.dispose();
  });

  // QA bug 11: EndOfBattle clears wIsInBattle with the battle still on screen, then whites it out
  // (GBPalWhiteOut) and reloads the map behind the white before fading back in.
  it("holds the battle until the game whites it out, then cuts back to the walk behind the white", () => {
    let now = 0;
    const live = createLiveWorld(fakeWorld(), { clock: () => now });
    const camera = new THREE.PerspectiveCamera();
    const state = { mapId: 0, player: { x: 0, y: 3, step: null, animFrame: 0, facing: "up" as const }, npcs: [], fade: 0 };
    const frame = (fade: number) => {
      now += 1 / 60;
      live.push({ ...state, fade }, now);
      live.update(now, camera, new THREE.Vector3(), false);
    };
    live.push(state, now);
    live.update(0, camera, new THREE.Vector3(), false);
    live.setBattle(view());
    for (let i = 0; i < 120; i++) frame(0);
    const battle = live.root.getObjectByName("battle")!;
    // Over: the last frame holds while the game waits for its sound effect.
    live.setBattle(null);
    for (let i = 0; i < 5; i++) frame(0);
    expect(live.view).toMatchObject({ pitch: 24 });
    expect(battle.visible).toBe(true);
    expect(live.fade).toBe(0);
    // White: the camera is back on the walk at once, the battle gone, the screen all white.
    frame(-1);
    expect(live.view).toBeNull();
    expect(battle.visible).toBe(false);
    expect(live.fade).toBe(-1);
    // The game fades the field back in, as it is.
    for (const f of [-1, -2 / 3, -1 / 3, 0]) {
      frame(f);
      expect(live.view).toBeNull();
      expect(live.fade).toBe(f);
    }
    live.dispose();
  });
});

describe("hand-coloured pictures (D43)", () => {
  it("paints the art's colour where it has one and the ramp elsewhere", () => {
    const { pixels } = picture();
    const art = new Uint8ClampedArray(56 * 56 * 4);
    art.set([200, 40, 10, 255], (25 * 56 + 25) * 4);
    const tex = pixelTexture(56, 56);
    paint(tex, pixels, 0b11100100, RAMP, () => false, art);
    const data = tex.image.data as Uint8Array;
    const at = (x: number, y: number) => Array.from(data.subarray(((55 - y) * 56 + x) * 4, ((55 - y) * 56 + x) * 4 + 4));
    expect(at(25, 25)).toEqual([200, 40, 10, 255]);
    expect(at(26, 25)).toEqual([0, 0, 0, 255]);
  });
});
