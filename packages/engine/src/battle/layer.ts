import * as THREE from "three/webgpu";
import type { CameraView } from "../index.ts";
import type { Ramp } from "../world/palette.ts";
import { faceCamera } from "../world/sprites.ts";
import { backgroundMask, paint, pixelTexture, shade } from "./picture.ts";

// HD battles (p2-battles): the two Pokémon as lit, crisp billboards standing in the 3D world (or
// on a stage), with the move animations' own sprites flying between them, the game's palette
// flashes over the view and its screen shakes on the camera. Everything is driven by what the
// Game Boy's battle screen shows (BattleScreen in packages/emu), so the battle plays exactly as
// the original: this only changes how it looks.

export type Side = "player" | "enemy";

/** A side's picture as the game draws it; `BattlePicture` in packages/emu fits. */
export interface BattlePictureView {
  /** 56×56 colour numbers (0–3, before rBGP), rows top-down; 255 where nothing is drawn. */
  pixels: Uint8Array;
  /** How far the picture has slid from home, in 8-pixel tiles. */
  dx: number;
  dy: number;
  /** Changes whenever `pixels` do. */
  version: number;
}

/** A sprite the game is drawing; `BattleObject` in packages/emu fits. */
export interface BattleObjectView {
  x: number;
  y: number;
  height: 8 | 16;
  pixels: Uint8Array;
  palette: 0 | 1;
}

export interface BattleView {
  enemy: BattlePictureView | null;
  player: BattlePictureView | null;
  /** Each side's colours (its SGB palette), lightest first. */
  ramps: Record<Side, Ramp>;
  objects: readonly BattleObjectView[];
  /** rBGP, rOBP0, rOBP1. */
  palettes: readonly [number, number, number];
  /** Where the battle screen sits on the Game Boy's screen, in pixels: the game shakes it. */
  origin: { x: number; y: number };
}

/** How the arena looks: the options compared for Nick (p2-battles). */
export type ArenaStyle = "field" | "bases" | "stage";
export const ARENA_STYLES: readonly ArenaStyle[] = ["field", "bases", "stage"];

/** What the ground is like where the battle is, for bases and the stage. */
export type ArenaGround = "grass" | "forest" | "cave" | "water" | "floor";

/** Where the battle stands, in world units on the ground plane. */
export interface ArenaPlacement {
  player: { x: number; z: number };
  enemy: { x: number; z: number };
  ground: ArenaGround;
}


const PIC = 56;
/** World units per picture pixel. A step (16 px of overworld sprite) is one unit. */
export const PICTURE_SCALE = 1 / 22;
/**
 * The enemy is drawn this much bigger, so both sides read the same size from the camera behind
 * the player's side, as they do on the Game Boy.
 */
const ENEMY_SCALE = 1.3;
/** The camera turns this far off the battle line, so the line runs into the screen diagonally. */
const CAMERA_TURN = 28;
/** Picture centres on the Game Boy screen (home cells + half a picture), in pixels. */
const SCREEN_CENTRE: Record<Side, { x: number; y: number }> = {
  player: { x: 1 * 8 + PIC / 2, y: 5 * 8 + PIC / 2 },
  enemy: { x: 12 * 8 + PIC / 2, y: PIC / 2 },
};

/** Base and stage colours: top, side. */
const GROUND_COLOURS: Record<ArenaGround, [number, number]> = {
  grass: [0x8dc762, 0x7b6552],
  forest: [0x6cb04a, 0x5c4a3a],
  cave: [0xa89884, 0x6a5c4e],
  water: [0x6cb6ea, 0x2f74b8],
  floor: [0xdcc28c, 0xa98d5c],
};

/** Move sprites' colours: bright, and glowing a little so they bloom. */
const EFFECT_RAMP: Ramp = [0xffffff, 0xfff1c2, 0xf08a4b, 0x3a2030];

export interface BattleLayer {
  readonly root: THREE.Group;
  /** Point the camera looks at (with any screen shake applied). */
  readonly target: THREE.Vector3;
  readonly view: CameraView;
  readonly style: ArenaStyle;
  /** Whether the overworld should be hidden (the stage stands alone). */
  readonly hidesWorld: boolean;
  setStyle(style: ArenaStyle): void;
  place(placement: ArenaPlacement): void;
  push(view: BattleView): void;
  update(camera: THREE.Camera): void;
  dispose(): void;
}

interface Picture {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardNodeMaterial;
  texture: THREE.DataTexture;
  painted: { version: number; register: number; ramp: Ramp } | null;
  mask: Uint8Array;
}

function createPicture(): Picture {
  const texture = pixelTexture(PIC, PIC);
  const material = new THREE.MeshStandardNodeMaterial({ map: texture, alphaTest: 0.5, roughness: 1, side: THREE.DoubleSide });
  const size = PIC * PICTURE_SCALE;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size).translate(0, size / 2, 0), material);
  mesh.castShadow = true;
  mesh.visible = false;
  return { mesh, material, texture, painted: null, mask: new Uint8Array(PIC * PIC) };
}

const OBJECT_SLOTS = 40;

export function createBattleLayer(initial: ArenaStyle = "field"): BattleLayer {
  const root = new THREE.Group();
  root.name = "battle";
  let style = initial;
  const target = new THREE.Vector3();
  const view: CameraView = { pitch: 24, yaw: 0, distance: 14, fov: 24 };
  let placement: ArenaPlacement = { player: { x: 0, z: 1.5 }, enemy: { x: 0, z: -1.5 }, ground: "grass" };
  /** Ground positions of the two sides, and the centre between them. */
  const home: Record<Side, THREE.Vector3> = { player: new THREE.Vector3(), enemy: new THREE.Vector3() };
  const centre = new THREE.Vector3();

  const pictures: Record<Side, Picture> = { player: createPicture(), enemy: createPicture() };
  root.add(pictures.player.mesh, pictures.enemy.mesh);
  pictures.enemy.mesh.scale.setScalar(ENEMY_SCALE);

  // Bases and the stage.
  const baseMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.95 });
  const sideMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
  const baseGeometry = new THREE.CylinderGeometry(1.25, 1.35, 0.14, 40).translate(0, 0.07, 0);
  const bases: Record<Side, THREE.Mesh> = {
    player: new THREE.Mesh(baseGeometry, [sideMaterial, baseMaterial, sideMaterial]),
    enemy: new THREE.Mesh(baseGeometry, [sideMaterial, baseMaterial, sideMaterial]),
  };
  for (const b of Object.values(bases)) {
    b.receiveShadow = true;
    b.castShadow = true;
    b.scale.set(1, 1, 0.75);
    root.add(b);
  }
  const stageGeometry = new THREE.CylinderGeometry(1, 0.86, 1, 64).translate(0, -0.5, 0);
  const stage = new THREE.Mesh(stageGeometry, [sideMaterial, baseMaterial, sideMaterial]);
  stage.receiveShadow = true;
  root.add(stage);

  // Move sprites: one quad per OAM slot, all drawing from one atlas row of 8×16 cells.
  const atlas = pixelTexture(8 * OBJECT_SLOTS, 16);
  const objectMaterial = new THREE.MeshBasicNodeMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, fog: false });
  const objects = Array.from({ length: OBJECT_SLOTS }, (_, i) => {
    const g = new THREE.PlaneGeometry(1, 1);
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let v = 0; v < uv.count; v++) uv.setX(v, (i + uv.getX(v)) / OBJECT_SLOTS);
    const mesh = new THREE.Mesh(g, objectMaterial);
    mesh.visible = false;
    mesh.renderOrder = 10;
    root.add(mesh);
    return { mesh, geometry: g };
  });

  // The game's palette flashes, over the whole view.
  const flashMaterial = new THREE.MeshBasicNodeMaterial({ color: 0xffffff, transparent: true, depthTest: false, depthWrite: false, fog: false });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), flashMaterial);
  flash.renderOrder = 999;
  flash.frustumCulled = false;
  flash.visible = false;
  root.add(flash);

  let latest: BattleView | null = null;
  /** Recent origins, to tell a shake from where the battle screen usually sits. */
  const scrolls: number[] = [];
  const shake = new THREE.Vector2();

  const applyStyle = () => {
    for (const b of Object.values(bases)) b.visible = style === "bases";
    stage.visible = style === "stage";
    const [top, side] = GROUND_COLOURS[placement.ground];
    baseMaterial.color.set(top);
    sideMaterial.color.set(side);
  };

  /** Where a point on the Game Boy screen lands: on the line between the two sides, raised. */
  const fromScreen = (sx: number, sy: number, out: THREE.Vector3) => {
    const p = SCREEN_CENTRE.player;
    const e = SCREEN_CENTRE.enemy;
    const a = (sx - p.x) / (e.x - p.x);
    const up = -(sy - p.y) - a * -(e.y - p.y);
    const lift = (PIC / 2) * PICTURE_SCALE;
    out.lerpVectors(home.player, home.enemy, a);
    out.y += lift + up * PICTURE_SCALE;
    return out;
  };

  const showPicture = (side: Side, view: BattlePictureView | null, all: BattleView) => {
    const pic = pictures[side];
    pic.mesh.visible = !!view;
    if (!view) return;
    const register = all.palettes[0];
    const ramp = all.ramps[side];
    const p = pic.painted;
    if (!p || p.version !== view.version || p.register !== register || p.ramp !== ramp) {
      if (!p || p.version !== view.version) pic.mask = backgroundMask(view.pixels, PIC, PIC);
      const mask = pic.mask;
      paint(pic.texture, view.pixels, register, ramp, (i) => mask[i] === 1);
      pic.painted = { version: view.version, register, ramp };
    }
    // A slide across the screen moves the picture along the battle line; down sinks it.
    const s = SCREEN_CENTRE[side];
    const at = fromScreen(s.x + view.dx * 8, s.y + view.dy * 8, new THREE.Vector3());
    at.y -= (PIC / 2) * PICTURE_SCALE;
    pic.mesh.position.copy(at);
  };

  let objectsShown = 0;
  const showObjects = (all: BattleView) => {
    // Most of a battle has no sprites: skip the upload until there are some.
    if (all.objects.length === 0 && objectsShown === 0) return;
    objectsShown = all.objects.length;
    const data = atlas.image.data as Uint8Array;
    data.fill(0);
    const width = 8 * OBJECT_SLOTS;
    all.objects.slice(0, OBJECT_SLOTS).forEach((o, slot) => {
      const register = all.palettes[o.palette === 1 ? 2 : 1];
      for (let y = 0; y < o.height; y++) {
        for (let x = 0; x < 8; x++) {
          const c = o.pixels[y * 8 + x]!;
          if (c === 0) continue;
          const hex = EFFECT_RAMP[shade(register, c)]!;
          data.set([hex >> 16, (hex >> 8) & 255, hex & 255, 255], ((15 - y) * width + slot * 8 + x) * 4);
        }
      }
      const { mesh, geometry } = objects[slot]!;
      const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
      const v0 = 1 - o.height / 16;
      for (let v = 0; v < uv.count; v++) uv.setY(v, v < 2 ? 1 : v0);
      uv.needsUpdate = true;
      mesh.scale.set(8 * PICTURE_SCALE, o.height * PICTURE_SCALE, 1);
      fromScreen(o.x + 4, o.y + o.height / 2, mesh.position);
      mesh.visible = true;
    });
    for (let slot = all.objects.length; slot < OBJECT_SLOTS; slot++) objects[slot]!.mesh.visible = false;
    atlas.needsUpdate = true;
  };

  const layer: BattleLayer = {
    root,
    target,
    view,
    get style() {
      return style;
    },
    get hidesWorld() {
      return style === "stage";
    },
    setStyle(next) {
      style = next;
      applyStyle();
    },
    place(next) {
      placement = next;
      home.player.set(next.player.x, 0, next.player.z);
      home.enemy.set(next.enemy.x, 0, next.enemy.z);
      centre.lerpVectors(home.player, home.enemy, 0.5);
      bases.player.position.copy(home.player);
      bases.enemy.position.copy(home.enemy);
      const length = home.player.distanceTo(home.enemy);
      stage.position.copy(centre);
      stage.scale.set(length * 0.95, 0.9, length * 0.95);
      const dx = home.enemy.x - home.player.x;
      const dz = home.enemy.z - home.player.z;
      // Behind the player's side, looking along the line toward the enemy, turned off it.
      view.yaw = (Math.atan2(-dx, -dz) * 180) / Math.PI + CAMERA_TURN;
      view.distance = 5 + length * 2.1;
      applyStyle();
    },
    push(next) {
      latest = next;
      scrolls.push(((next.origin.x & 255) << 8) | (next.origin.y & 255));
      if (scrolls.length > 90) scrolls.shift();
    },
    update(camera) {
      const all = latest;
      if (all) {
        showPicture("player", all.player, all);
        showPicture("enemy", all.enemy, all);
        showObjects(all);
        // Fades and flashes: how far rBGP has moved the shades, toward black or white.
        const register = all.palettes[0];
        let moved = 0;
        let distance = 0;
        for (let c = 0; c < 4; c++) {
          moved += shade(register, c) - c;
          distance += Math.abs(shade(register, c) - c);
        }
        const amount = Math.min(distance / 6, 1);
        flash.visible = amount > 0;
        flashMaterial.color.set(moved > 0 ? 0x000000 : 0xffffff);
        flashMaterial.opacity = moved > 0 ? Math.min(moved / 6, 1) : amount * 0.85;
        // Shakes: the screen moved away from where it usually sits.
        const counts = new Map<number, number>();
        let usual = scrolls[0] ?? 0;
        for (const s of scrolls) {
          const n = (counts.get(s) ?? 0) + 1;
          counts.set(s, n);
          if (n > (counts.get(usual) ?? 0)) usual = s;
        }
        const wrap = (v: number) => ((v + 128) & 255) - 128;
        shake.set(wrap(all.origin.x - (usual >> 8)), wrap(all.origin.y - (usual & 255)));
      }
      const dx = home.enemy.x - home.player.x;
      const dz = home.enemy.z - home.player.z;
      const length = Math.hypot(dx, dz) || 1;
      // Across the line and up, a Game Boy pixel of shake per world pixel.
      target.copy(centre);
      target.y = 0.9;
      target.x += (-dz / length) * shake.x * PICTURE_SCALE * 3;
      target.z += (dx / length) * shake.x * PICTURE_SCALE * 3;
      target.y += shake.y * PICTURE_SCALE * 3;

      faceCamera(pictures.player.mesh, camera);
      faceCamera(pictures.enemy.mesh, camera);
      for (const { mesh } of objects) if (mesh.visible) mesh.quaternion.copy(camera.quaternion);
      camera.getWorldDirection(flash.position);
      flash.position.multiplyScalar(0.6).add(camera.position);
      flash.quaternion.copy(camera.quaternion);
    },
    dispose() {
      for (const p of Object.values(pictures)) {
        p.mesh.geometry.dispose();
        p.material.dispose();
        p.texture.dispose();
      }
      for (const { geometry } of objects) geometry.dispose();
      objectMaterial.dispose();
      atlas.dispose();
      baseGeometry.dispose();
      stageGeometry.dispose();
      baseMaterial.dispose();
      sideMaterial.dispose();
      flash.geometry.dispose();
      flashMaterial.dispose();
    },
  };
  applyStyle();
  return layer;
}
