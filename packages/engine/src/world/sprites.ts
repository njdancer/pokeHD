import * as THREE from "three/webgpu";
import type { Region } from "./region.ts";
import { TILE_UNITS } from "./region.ts";

// Placeholder people at each NPC's position, as crisp camera-facing billboards. Our own art:
// real sprite sheets come from the ROM in a later task.

const BASE: Record<string, number> = { k: 0x1e1a24, s: 0xf3c9a0, p: 0x3a3a52, w: 0xf4f1ea };
/** Cap and shirt colours: the player in red, everyone else in blue, friends' ghosts in green. */
export const PERSON_COLOURS = {
  player: { h: 0xd8473e, b: 0x3f7fd0 },
  friend: { h: 0x4fa35a, b: 0xe8c547 },
  npc: { h: 0x3f7fd0, b: 0xd8473e },
} as const;
const PERSON = [
  "................",
  ".....kkkkkk.....",
  "....khhhhhhk....",
  "...khhhhhhhhk...",
  "...kkkkkkkkkk...",
  "...ksssssssk....",
  "...kskssksk.....",
  "...ksssssssk....",
  "....kksssskk....",
  "...kbbbbbbbbk...",
  "..ksbbbwwbbbsk..",
  "..kskbbbbbbksk..",
  "...kkbbbbbbkk...",
  "....kppppppk....",
  "....kppkkppk....",
  "....kkk..kkk....",
];

function personTexture(kind: keyof typeof PERSON_COLOURS): THREE.DataTexture {
  const palette: Record<string, number> = { ...BASE, ...PERSON_COLOURS[kind] };
  const data = new Uint8Array(16 * 16 * 4);
  PERSON.forEach((row, y) => {
    for (let x = 0; x < 16; x++) {
      const hex = palette[row[x]!];
      if (hex === undefined) continue;
      const i = ((15 - y) * 16 + x) * 4;
      data.set([hex >> 16, (hex >> 8) & 255, hex & 255, 255], i);
    }
  });
  const tex = new THREE.DataTexture(data, 16, 16);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** A one-step-wide billboard standing on its base. Share the result's geometry and material. */
export function personMaterial(kind: keyof typeof PERSON_COLOURS) {
  return new THREE.MeshStandardNodeMaterial({ map: personTexture(kind), alphaTest: 0.5, roughness: 1, side: THREE.DoubleSide });
}
export const PERSON_GEOMETRY = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);

/** Turns a billboard to face the camera about the vertical axis. */
export function faceCamera(sprite: THREE.Object3D, camera: THREE.Camera) {
  sprite.rotation.y = Math.atan2(camera.position.x - sprite.position.x, camera.position.z - sprite.position.z);
}

/** NPCs where the map data places them (static; the live world moves them from game state). */
export function npcSprites(region: Region) {
  const group = new THREE.Group();
  const material = personMaterial("npc");
  for (const { map, x, y } of region.maps) {
    for (const npc of map.npcs) {
      const mesh = new THREE.Mesh(PERSON_GEOMETRY, material);
      mesh.position.set(x * TILE_UNITS + npc.x + 0.5, 0, y * TILE_UNITS + npc.y + 0.6);
      mesh.castShadow = true;
      group.add(mesh);
    }
  }
  return {
    group,
    /** Turns every sprite to face the camera about the vertical axis. */
    face(camera: THREE.Camera) {
      for (const s of group.children) faceCamera(s, camera);
    },
  };
}
