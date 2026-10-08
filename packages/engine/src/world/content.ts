import * as THREE from "three/webgpu";
import type { WorldContent } from "../index.ts";
import type { StyleParams } from "./params.ts";
import { TILE_UNITS, type Region } from "./region.ts";
import { npcSprites } from "./sprites.ts";
import type { InteriorLook } from "./interior.ts";
import { buildStyle, type StyleId } from "./styles.ts";

// A region in one style, packaged as engine content: the look-dev rig, sky and post stack light
// and frame it exactly as they will the game.

export interface Focus {
  name: string;
  /** World position at the centre of the map. */
  x: number;
  z: number;
}

/** The centre of each map in the region, for pointing the camera at. */
export function regionFocuses(region: Region): Focus[] {
  return region.maps.map(({ map, x, y }) => ({
    name: map.name,
    x: (x + map.widthBlocks * 2) * TILE_UNITS,
    z: (y + map.heightBlocks * 2) * TILE_UNITS,
  }));
}

export interface StyledWorld extends WorldContent {
  dispose(): void;
}

export function createStyledWorld(region: Region, style: StyleId, params: StyleParams, focus: Focus, interior?: InteriorLook): StyledWorld {
  const root = new THREE.Group();
  root.add(buildStyle(style, region, params, undefined, interior));
  const sprites = npcSprites(region);
  root.add(sprites.group);
  const target = new THREE.Vector3(focus.x, 0.5, focus.z);
  return {
    root,
    target,
    update(_seconds, camera) {
      sprites.face(camera);
    },
    dispose() {
      disposeTree(root);
    },
  };
}

/** Frees the geometry, materials and textures under `root`. */
export function disposeTree(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    for (const m of [o.material].flat() as THREE.Material[]) {
      const map = (m as THREE.MeshStandardMaterial).map;
      if (map) textures.add(map);
      m.dispose();
    }
  });
  for (const t of textures) t.dispose();
}
