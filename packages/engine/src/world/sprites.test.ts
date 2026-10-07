import { describe, expect, it } from "vitest";
import * as THREE from "three/webgpu";
import { fakeWorld } from "./fake-world.ts";
import { createLiveWorld, GB_FRAME_SECONDS } from "./live.ts";
import { spriteFrame } from "./sprites.ts";

describe("spriteFrame", () => {
  it("follows the game's facing and animation table", () => {
    expect(spriteFrame("down", 0)).toEqual({ frame: 0, flip: false });
    expect(spriteFrame("down", 1)).toEqual({ frame: 3, flip: false });
    expect(spriteFrame("down", 2)).toEqual({ frame: 0, flip: false });
    expect(spriteFrame("down", 3)).toEqual({ frame: 3, flip: true });
    expect(spriteFrame("up", 3)).toEqual({ frame: 4, flip: true });
    expect(spriteFrame("left", 3)).toEqual({ frame: 5, flip: false });
    expect(spriteFrame("right", 0)).toEqual({ frame: 2, flip: true });
    expect(spriteFrame("right", 1)).toEqual({ frame: 5, flip: true });
    expect(spriteFrame("left", 1, true)).toEqual({ frame: 0, flip: false });
  });
});

describe("live world sprites", () => {
  it("draws each object with its own sheet and the player with Red's", () => {
    const world = fakeWorld();
    const ball = { id: 0x3d, still: true, tiles: new Uint8Array(4 * 64) };
    world.sprites[0x3d] = ball;
    const live = createLiveWorld(world);
    const camera = new THREE.PerspectiveCamera();
    const npc = { x: 1, y: 1, step: null, animFrame: 0, visible: true };
    live.push({
      mapId: 0,
      player: { x: 0, y: 0, step: null, animFrame: 0, facing: "left" },
      npcs: [{ ...npc, slot: 1, pictureId: 1 }, { ...npc, slot: 2, pictureId: 0x3d }, { ...npc, slot: 3, pictureId: 0x30 }],
      fade: 0,
    }, 0);
    live.update(0, camera, new THREE.Vector3(), false);
    live.update(GB_FRAME_SECONDS, camera, new THREE.Vector3(), false);
    const maps = live.root.children
      .filter((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.castShadow)
      .map((m) => (m.material as THREE.MeshStandardNodeMaterial).map as THREE.DataTexture | null);
    const [player, person, item, missing] = maps;
    expect(player).toBe(person); // both sprite 1 in the fake world
    expect(item).not.toBe(person);
    expect(item?.image.width).toBe(96);
    expect(missing?.image.width).toBe(16); // no sheet: the placeholder
    live.dispose();
  });
});
