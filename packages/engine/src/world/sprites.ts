import * as THREE from "three/webgpu";
import type { Region } from "./region.ts";
import { TILE_UNITS } from "./region.ts";

// Placeholder people at each NPC's position, as crisp camera-facing billboards. Our own art:
// real sprite sheets come from the ROM in a later task.

const PALETTE: Record<string, number> = { k: 0x1e1a24, h: 0x3f7fd0, s: 0xf3c9a0, b: 0xd8473e, p: 0x3a3a52, w: 0xf4f1ea };
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

function personTexture(): THREE.DataTexture {
  const data = new Uint8Array(16 * 16 * 4);
  PERSON.forEach((row, y) => {
    for (let x = 0; x < 16; x++) {
      const hex = PALETTE[row[x]!];
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

export function npcSprites(region: Region) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardNodeMaterial({ map: personTexture(), alphaTest: 0.5, roughness: 1, side: THREE.DoubleSide });
  const geometry = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  for (const { map, x, y } of region.maps) {
    for (const npc of map.npcs) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x * TILE_UNITS + npc.x + 0.5, 0, y * TILE_UNITS + npc.y + 0.6);
      mesh.castShadow = true;
      group.add(mesh);
    }
  }
  return {
    group,
    /** Turns every sprite to face the camera about the vertical axis. */
    face(camera: THREE.Camera) {
      for (const s of group.children) s.rotation.y = Math.atan2(camera.position.x - s.position.x, camera.position.z - s.position.z);
    },
  };
}
