// The modelled Pokédex (p2-dex): the device built in Blender after the anime's (assets-src/dex/
// pokedex.blend, exported as a GLB). Its parts by name: "Cover" swings on the hinge (its
// "CoverOpen" action runs shut to open), and "Screen" is the quad the page is laid over, its
// UVs 0–1 with (0, 0) at the top left. With a hand (pokedex-hand.glb, from the same file), it's
// held in the hand's "Grip" bone and the hand's "ThumbOpen" flicks the cover open in time.
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

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

export async function loadDexModel(url: string, handUrl?: string): Promise<DexModel> {
  const loader = new GLTFLoader();
  const [gltf, hand] = await Promise.all([
    loader.loadAsync(url),
    handUrl
      ? loader.loadAsync(handUrl).catch((e: unknown) => {
          console.warn("[pokeHD] Pokédex hand failed; the device alone", e);
          return null;
        })
      : null,
  ]);
  const root = new THREE.Group();
  // Blender's metres to the device's centimetres.
  const metres = new THREE.Group();
  metres.scale.setScalar(100);
  root.add(metres);
  // The device rides in the hand: its rest pose is where the hand's grip rests, and it moves as
  // the grip does.
  const holder = new THREE.Group();
  holder.matrixAutoUpdate = false;
  holder.add(gltf.scene);
  metres.add(holder);
  const noFollow = () => {};
  let follow = noFollow;
  let handOpen = (_open: number) => {};
  const grip = hand?.scene.getObjectByName("Grip");
  const thumb = hand && THREE.AnimationClip.findByName(hand.animations, "ThumbOpen");
  if (hand && grip && thumb) {
    metres.add(hand.scene);
    // The grip in the hand's own space, which is the holder's parent space too.
    const gripMatrix = (m: THREE.Matrix4) => {
      hand.scene.updateMatrixWorld(true);
      return m.copy(hand.scene.matrixWorld).invert().multiply(grip.matrixWorld);
    };
    const rest = gripMatrix(new THREE.Matrix4()).invert();
    const handMixer = new THREE.AnimationMixer(hand.scene);
    handMixer.clipAction(thumb).play();
    handOpen = (open) => handMixer.setTime(Math.min(open, 0.9999) * thumb.duration);
    follow = () => void gripMatrix(holder.matrix).multiply(rest);
  } else if (hand) console.warn("[pokeHD] Pokédex hand has no Grip or ThumbOpen; the device alone");
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
    handOpen(open);
    follow();
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

  return {
    root,
    held: follow !== noFollow,
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
