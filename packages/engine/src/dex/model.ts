// The modelled Pokédex (p2-dex): the device built in Blender after the anime's (assets-src/dex/
// pokedex.blend, exported as a GLB). Its parts by name: "Cover" swings on the hinge (its
// "CoverOpen" action runs shut to open), and "Screen" is the quad the page is laid over, its
// UVs 0–1 with (0, 0) at the top left.
//
// Its screen is parametric (Nick 2026-10-11): `reshape` makes it taller, to the shape of the
// phone it's on, and rounds its corners to match the phone's. The body is cut through the middle
// of the screen and everything above the cut moves up, so the screen, its white frame, the body
// and the hinge grow while the lens band and the buttons keep their size; the cover grows by the
// same amount between two cuts that miss its keys and display, so it still lines up shut.
// Moving along the hinge's axis only, so the CoverOpen action is untouched.
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface DexModel {
  /** The device, in centimetres. */
  root: THREE.Object3D;
  /** Shut 0 … open 1. */
  setOpen(open: number): void;
  /** The screen's corners in `screenSpace`: top-left, top-right, bottom-right, bottom-left. */
  screenCorners: THREE.Vector3[];
  screenSpace: THREE.Object3D;
  /** The body's box (cover shut), and the whole device's open, in `root`'s space. */
  shut: THREE.Box3;
  opened: THREE.Box3;
  /**
   * The screen's shape: `aspect` is its width over height (the modelled screen's 4.6 × 3.9 cm,
   * about 1.18, is the widest it goes; it only grows taller) and `radius` its corners' radius as
   * a fraction of its width. Moves `screenCorners`, `shut` and `opened` with it.
   */
  reshape(shape: ScreenShape): void;
  /** The screen's shape now. */
  readonly shape: ScreenShape;
  /** Its materials, for the lights' glow. */
  material(name: string): THREE.MeshStandardMaterial | undefined;
  dispose(): void;
}

export interface ScreenShape {
  aspect: number;
  radius: number;
}

/** Heights (metres, up the hinge, cover shut) where the device stretches, and each one's share. */
const BODY_CUTS: [y: number, share: number][] = [[0.0765, 1]];
/** The cover's miss its keys (5.0–7.4 cm), white keys (3.7–4.5) and display (7.9–10.5). */
const COVER_CUTS: [y: number, share: number][] = [[0.0475, 0.5], [0.0765, 0.5]];

/** A rounded rectangle from (x0, y0) to (x1, y1), corners of radius `r`. */
function roundedRect(x0: number, y0: number, x1: number, y1: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  if (r <= 0) {
    s.moveTo(x0, y0).lineTo(x1, y0).lineTo(x1, y1).lineTo(x0, y1).closePath();
    return s;
  }
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0);
  s.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x1, y1 - r);
  s.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
  s.lineTo(x0 + r, y1);
  s.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x0, y0 + r);
  s.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

export async function loadDexModel(url: string): Promise<DexModel> {
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
  let opened01 = 0;
  const setOpen = (open: number) => {
    opened01 = open;
    // Just short of the end, where a clip would wrap back to its start.
    mixer.setTime(Math.min(open, 0.9999) * clip.duration);
    root.updateMatrixWorld(true);
  };
  root.updateMatrixWorld(true);
  setOpen(0);

  // How each vertex moves as the device grows: along the hinge's axis (up, in the scene), by its
  // share of the growth from every cut below it, measured with the cover shut.
  const toScene = new THREE.Matrix4().copy(gltf.scene.matrixWorld).invert();
  const parts: { mesh: THREE.Mesh; base: Float32Array; weight: Float32Array; up: THREE.Vector3 }[] = [];
  const underCover = (o: THREE.Object3D) => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === cover) return true;
    return false;
  };
  const p = new THREE.Vector3();
  gltf.scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o === screen) return;
    // Meshes can share geometry: each moves its own copy.
    o.geometry = (o.geometry as THREE.BufferGeometry).clone();
    const m = new THREE.Matrix4().multiplyMatrices(toScene, o.matrixWorld);
    const back = new THREE.Matrix3().setFromMatrix4(m.clone().invert());
    const pos = o.geometry.getAttribute("position") as THREE.BufferAttribute;
    const cuts = underCover(o) ? COVER_CUTS : BODY_CUTS;
    const weight = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(m);
      weight[i] = cuts.reduce((w, [y, share]) => (p.y > y ? w + share : w), 0);
    }
    parts.push({ mesh: o, base: Float32Array.from(pos.array as ArrayLike<number>), weight, up: new THREE.Vector3(0, 1, 0).applyMatrix3(back) });
  });

  // The screen as modelled: a rectangle in its own x–y, facing +z, upright in the scene. Its
  // bottom edge is below the cut and its top above, so only the top moves.
  screen.geometry.computeBoundingBox();
  const rest = screen.geometry.boundingBox!.clone();
  const screenM = new THREE.Matrix4().multiplyMatrices(toScene, screen.matrixWorld);
  const edgeWeight = (y: number) => BODY_CUTS.reduce((w, [cut, share]) => (p.set(rest.min.x, y, rest.min.z).applyMatrix4(screenM).y > cut ? w + share : w), 0);
  const [lowW, highW] = [edgeWeight(rest.min.y), edgeWeight(rest.max.y)];
  const restW = rest.max.x - rest.min.x;
  const restH = rest.max.y - rest.min.y;
  const screenCorners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const shut = new THREE.Box3();
  const opened = new THREE.Box3();
  const box = (into: THREE.Box3) => into.setFromObject(gltf.scene).applyMatrix4(new THREE.Matrix4().copy(root.matrixWorld).invert());
  let shape: ScreenShape = { aspect: restW / restH, radius: 0 };

  const reshape = (next: ScreenShape) => {
    shape = { aspect: next.aspect, radius: Math.max(0, next.radius) };
    const grow = Math.max(0, restW / shape.aspect - restH);
    for (const { mesh, base, weight, up } of parts) {
      const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      const a = pos.array as Float32Array;
      for (let i = 0; i < pos.count; i++) {
        const d = weight[i]! * grow;
        a[i * 3] = base[i * 3]! + up.x * d;
        a[i * 3 + 1] = base[i * 3 + 1]! + up.y * d;
        a[i * 3 + 2] = base[i * 3 + 2]! + up.z * d;
      }
      pos.needsUpdate = true;
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
    }
    // The screen itself: rebuilt as a rounded rectangle over its stretched outline, UVs 0–1
    // with (0, 0) at the top left as modelled.
    const min = { x: rest.min.x, y: rest.min.y + lowW * grow };
    const max = { x: rest.max.x, y: rest.max.y + highW * grow };
    const z = rest.min.z;
    const flat = new THREE.ShapeGeometry(roundedRect(min.x, min.y, max.x, max.y, shape.radius * restW), 16);
    const fp = flat.getAttribute("position") as THREE.BufferAttribute;
    const fuv = flat.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < fp.count; i++) {
      fp.setZ(i, z);
      fuv.setXY(i, (fp.getX(i) - min.x) / (max.x - min.x), (max.y - fp.getY(i)) / (max.y - min.y));
    }
    screen.geometry.dispose();
    screen.geometry = flat;
    // A hair in front, so the page sits on the glass rather than in it.
    screenCorners[0]!.set(min.x, max.y, z + 0.0002);
    screenCorners[1]!.set(max.x, max.y, z + 0.0002);
    screenCorners[2]!.set(max.x, min.y, z + 0.0002);
    screenCorners[3]!.set(min.x, min.y, z + 0.0002);
    const now = opened01;
    setOpen(0);
    box(shut);
    setOpen(1);
    box(opened);
    setOpen(now);
  };
  reshape(shape);

  const materials = new Map<string, THREE.MeshStandardMaterial>();
  gltf.scene.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) materials.set(o.material.name, o.material);
  });

  return {
    root,
    setOpen,
    reshape,
    get shape() {
      return shape;
    },
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

