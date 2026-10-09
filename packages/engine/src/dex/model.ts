// The modelled Pokédex (p2-dex): the device built in Blender after the anime's (assets-src/dex/
// pokedex.blend, exported as a GLB). Its parts by name: "Cover" swings on the hinge (its
// "CoverOpen" action runs shut to open), and "Screen" is the quad the page is laid over, its
// UVs 0–1 with (0, 0) at the top left. It can be held in Ash's hand (hand.ts), a pixel-art sprite
// whose thumb rests on the body's face and whose fingers curl under it.
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { drawDexHand } from "./hand.ts";

export interface DexModel {
  /** The device (and the hand holding it), in centimetres. */
  root: THREE.Object3D;
  /** Whether a hand holds it. */
  held: boolean;
  /** Shut 0 … open 1. */
  setOpen(open: number): void;
  /** The screen's corners in `screenSpace`: top-left, top-right, bottom-right, bottom-left. */
  screenCorners: THREE.Vector3[];
  screenSpace: THREE.Object3D;
  /** The body's box (cover shut), and the whole device's open, in `root`'s space. */
  shut: THREE.Box3;
  opened: THREE.Box3;
  /** Its materials, for the lights' glow. */
  material(name: string): THREE.MeshStandardMaterial | undefined;
  dispose(): void;
}

export async function loadDexModel(url: string, options: { hand?: boolean } = {}): Promise<DexModel> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = new THREE.Group();
  // Blender's metres to the device's centimetres.
  gltf.scene.scale.setScalar(100);
  root.add(gltf.scene);
  const cover = gltf.scene.getObjectByName("Cover");
  const screen = gltf.scene.getObjectByName("Screen");
  if (!cover || !(screen instanceof THREE.Mesh)) throw new Error("Pokédex model is missing its Cover or Screen");
  const clip = THREE.AnimationClip.findByName(gltf.animations, "CoverOpen");
  if (!clip) throw new Error("Pokédex model has no CoverOpen action");
  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(clip).play();
  const setOpen = (open: number) => {
    // Just short of the end, where a clip would wrap back to its start.
    mixer.setTime(Math.min(open, 0.9999) * clip.duration);
    root.updateMatrixWorld(true);
  };

  // The screen's corners by their UVs.
  const pos = screen.geometry.getAttribute("position");
  const uv = screen.geometry.getAttribute("uv");
  const corner = (u: number, v: number) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const d = (uv.getX(i) - u) ** 2 + (uv.getY(i) - v) ** 2;
      if (d < bestD) [best, bestD] = [i, d];
    }
    // A hair in front, so the page sits on the glass rather than in it.
    return new THREE.Vector3().fromBufferAttribute(pos, best).setZ(pos.getZ(best) + 0.0002);
  };
  const screenCorners = [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)];

  const materials = new Map<string, THREE.MeshStandardMaterial>();
  gltf.scene.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) materials.set(o.material.name, o.material);
  });

  const box = () => new THREE.Box3().setFromObject(gltf.scene).applyMatrix4(new THREE.Matrix4().copy(root.matrixWorld).invert());
  root.updateMatrixWorld(true);
  setOpen(0);
  const shut = box();
  setOpen(1);
  const opened = box();
  if (options.hand) root.add(handSprite(shut, screen.localToWorld(screenCorners[0]!.clone()).applyMatrix4(new THREE.Matrix4().copy(root.matrixWorld).invert()).z));

  return {
    root,
    held: !!options.hand,
    setOpen,
    screenCorners,
    screenSpace: screen,
    shut,
    opened,
    material: (name) => materials.get(name),
    dispose() {
      mixer.stopAllAction();
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: THREE.Material) => m.dispose());
        }
      });
    },
  };
}

/** The hand's width, in centimetres. */
const HAND_W = 8.5;
/** Where the thumb rests, across the body from its left. */
const THUMB_AT = 0.3;

/**
 * The hand as two flat sprites: its fingers behind the body, its thumb on the face (`face` is
 * the face's depth), under the cover while that's ajar.
 */
function handSprite(shut: THREE.Box3, face: number): THREE.Object3D {
  const hand = drawDexHand();
  const px = HAND_W / hand.width;
  const group = new THREE.Group();
  const layer = (data: Uint8ClampedArray, z: number) => {
    const tex = new THREE.DataTexture(data, hand.width, hand.height, THREE.RGBAFormat);
    // Rows run top down; textures bottom up.
    tex.flipY = true;
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(hand.width * px, hand.height * px),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, toneMapped: false }),
    );
    mesh.position.set(
      shut.min.x + THUMB_AT * (shut.max.x - shut.min.x) + (hand.width / 2 - hand.thumb) * px,
      shut.min.y - (hand.height / 2 - hand.edge) * px,
      z,
    );
    group.add(mesh);
  };
  layer(hand.back, shut.min.z - 0.4);
  layer(hand.front, face + 0.25);
  return group;
}
