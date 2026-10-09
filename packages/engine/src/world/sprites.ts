import * as THREE from "three/webgpu";
import { markMovingShadow } from "../look/cached-shadow.ts";
import type { NpcMovement, SpriteSheet } from "@pokehd/rom";
import type { Ramp } from "./palette.ts";
import type { Region } from "./region.ts";
import { TILE_UNITS } from "./region.ts";

// People and objects as crisp camera-facing billboards. Map objects and the player use their
// sprite sheets from the ROM; the placeholder person below (our own art) is for friends' ghosts
// and anything whose sheet is missing.

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

export type Facing = "down" | "up" | "left" | "right";

/** SPRITE_RED and SPRITE_SEEL (constants/sprite_constants.asm): the player walking and surfing. */
export const SPRITE_RED = 0x01;
export const SPRITE_SEEL = 0x3c;

/**
 * Neutral sprite colours, for places whose SGB palette is near-grey (./place.ts): DMG shades
 * 0–3, lightest first. Shade 2 goes unused; the overworld's object palette skips it.
 */
export const SPRITE_RAMP: Ramp = [0xfbf7ef, 0xc9b9a6, 0x7a6a5c, 0x1e1a24];
/** rOBP0 in the overworld ($d0): colour 1 → shade 0, 2 → 1, 3 → 3. Colour 0 is transparent. */
const OBP0 = 0xd0;
/** Frames per sheet texture: standing down, up, left, then walking down, up, left. */
const FRAMES = 6;

function sheetTexture(sheet: SpriteSheet, ramp: Ramp): THREE.DataTexture {
  const width = FRAMES * 16;
  const data = new Uint8Array(width * 16 * 4);
  const tiles = sheet.tiles.length / 64;
  for (let t = 0; t < tiles; t++) {
    // Tiles run frame by frame, each frame top-left, top-right, bottom-left, bottom-right.
    const fx = (t >> 2) * 16 + (t & 1) * 8;
    const fy = (t & 2) * 4;
    for (let p = 0; p < 64; p++) {
      const colour = sheet.tiles[t * 64 + p]!;
      if (colour === 0) continue;
      const hex = ramp[(OBP0 >> (colour * 2)) & 3]!;
      const x = fx + (p & 7);
      const y = fy + (p >> 3);
      data.set([hex >> 16, (hex >> 8) & 255, hex & 255, 255], ((15 - y) * width + x) * 4);
    }
  }
  const tex = new THREE.DataTexture(data, width, 16);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The frame the game draws (SpriteFacingAndAnimationTable, data/sprites/facings.asm): walk
 * frames 1 and 3 step, down and up alternating feet by mirroring; facing right is facing left
 * mirrored. Still sheets always show their one frame.
 */
export function spriteFrame(facing: Facing, animFrame: number, still = false): { frame: number; flip: boolean } {
  if (still) return { frame: 0, flip: false };
  const walking = (animFrame & 1) === 1;
  const row = facing === "down" ? 0 : facing === "up" ? 1 : 2;
  const frame = row + (walking ? 3 : 0);
  const flip = facing === "right" || (row < 2 && animFrame === 3);
  return { frame, flip };
}

/** Billboard geometry per frame and mirroring, `[frame * 2 + flip]`; shared, never disposed. */
const FRAME_GEOMETRY = Array.from({ length: FRAMES * 2 }, (_, i) => {
  const frame = i >> 1;
  const flip = (i & 1) === 1;
  const g = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let v = 0; v < uv.count; v++) {
    const u = uv.getX(v);
    uv.setX(v, (frame + (flip ? 1 - u : u)) / FRAMES);
  }
  return g;
});

/** A billboard mesh showing a sprite sheet, or the placeholder person when there's no sheet. */
export interface SpriteActor {
  mesh: THREE.Mesh;
  /** Picks the sheet, the frame to show and its colours (the set's ramp when absent). */
  show(sheet: SpriteSheet | null | undefined, facing: Facing, animFrame: number, ramp?: Ramp): void;
}

/** Materials per sheet and ramp, shared by every actor using them. Dispose when the world goes. */
export function createSpriteSet(defaultRamp: Ramp = SPRITE_RAMP) {
  const materials = new Map<Ramp, Map<SpriteSheet, THREE.MeshStandardNodeMaterial>>();
  const fallback = personMaterial("npc");
  const material = (sheet: SpriteSheet, ramp: Ramp) => {
    let byRamp = materials.get(ramp);
    if (!byRamp) materials.set(ramp, (byRamp = new Map()));
    let m = byRamp.get(sheet);
    if (!m) {
      m = new THREE.MeshStandardNodeMaterial({ map: sheetTexture(sheet, ramp), alphaTest: 0.5, roughness: 1, side: THREE.DoubleSide });
      byRamp.set(sheet, m);
    }
    return m;
  };
  return {
    actor(): SpriteActor {
      const mesh = new THREE.Mesh(PERSON_GEOMETRY, fallback);
      mesh.castShadow = true;
      markMovingShadow(mesh);
      return {
        mesh,
        show(sheet, facing, animFrame, ramp = defaultRamp) {
          if (!sheet) {
            mesh.material = fallback;
            mesh.geometry = PERSON_GEOMETRY;
            return;
          }
          const { frame, flip } = spriteFrame(facing, animFrame, sheet.still);
          mesh.material = material(sheet, ramp);
          mesh.geometry = FRAME_GEOMETRY[frame * 2 + (flip ? 1 : 0)]!;
        },
      };
    },
    dispose() {
      for (const m of [...[...materials.values()].flatMap((b) => [...b.values()]), fallback]) {
        m.map?.dispose();
        m.dispose();
      }
      materials.clear();
    },
  };
}

/** The way a map object faces before the game moves it. */
export function initialFacing(movement: NpcMovement): Facing {
  return movement.kind === "stay" && movement.facing !== "none" && movement.facing !== "any" ? movement.facing : "down";
}

/** Map objects where the map data places them (static; the live world moves them from game state). */
export function npcSprites(region: Region, ramp?: Ramp) {
  const group = new THREE.Group();
  const set = createSpriteSet(ramp);
  for (const { map, x, y } of region.maps) {
    for (const npc of map.npcs) {
      const { mesh, show } = set.actor();
      show(region.sprites[npc.sprite], initialFacing(npc.movement), 0);
      mesh.position.set(x * TILE_UNITS + npc.x + 0.5, 0, y * TILE_UNITS + npc.y + 0.6);
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
