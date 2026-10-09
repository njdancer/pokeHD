import * as THREE from "three/webgpu";
import { color, float, floor, mix, mod, normalWorldGeometry, positionWorld, texture, transformNormalToView, normalize, vec3 } from "three/tsl";
import { markMovingShadow } from "./cached-shadow.ts";

// Stand-in world for look-dev until the real map renderer lands (Track D): a patch of ground on
// a step grid, two gabled houses, a ledge, a pond, trees, a fence and some crisp pixel-sprite
// billboards. 1 world unit = 1 player step (16 px). Everything is our own placeholder art.

const SPRITE_PALETTE: Record<string, number> = {
  k: 0x1e1a24, // outline
  h: 0xd8473e, // cap
  H: 0xa8302c, // cap shade
  s: 0xf3c9a0, // skin
  e: 0x1e1a24, // eyes
  b: 0x3f7fd0, // shirt
  B: 0x2c5ea3, // shirt shade
  p: 0x3a3a52, // trousers
  w: 0xf4f1ea, // white
};

// A 16×16 walker of our own design ("." is transparent).
const KID = [
  "......kkkk......",
  "....kkhhhhkk....",
  "...khhhhhhhhk...",
  "...kHHHHHHHHkk..",
  "..kkkkkkkkkkkwk.",
  "..ksssssssssk...",
  "..ksseessesk....",
  "..ksssssssssk...",
  "...kssskssk.....",
  "..kkbbbbbbbbkk..",
  ".kswbbbbbbbbwsk.",
  ".kskBbbbbbbBksk.",
  "..kkBBBBBBBBkk..",
  "...kppppppppk...",
  "...kppk..kppk...",
  "...kkkk..kkkk...",
];

function pixelTexture(rows: string[], tintShirt?: number): THREE.DataTexture {
  const h = rows.length;
  const w = rows[0]!.length;
  const data = new Uint8Array(w * h * 4);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const ch = row[x]!;
      if (ch === ".") continue;
      let hex = SPRITE_PALETTE[ch] ?? 0xff00ff;
      if (tintShirt !== undefined && (ch === "b" || ch === "B")) hex = ch === "b" ? tintShirt : darken(tintShirt);
      const i = ((h - 1 - y) * w + x) * 4; // DataTexture rows run bottom-up
      data[i] = (hex >> 16) & 255;
      data[i + 1] = (hex >> 8) & 255;
      data[i + 2] = hex & 255;
      data[i + 3] = 255;
    }
  });
  const tex = new THREE.DataTexture(data, w, h);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const darken = (hex: number) => {
  const c = new THREE.Color(hex).multiplyScalar(0.72);
  return c.getHex();
};

export interface Billboard {
  sprite: THREE.Mesh;
  /** Invisible card turned to face the sun, so the shadow is the sprite's full silhouette. */
  shadowCaster: THREE.Mesh;
  group: THREE.Group;
}

function createBillboard(tex: THREE.Texture): Billboard {
  const geometry = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const map = texture(tex);

  const material = new THREE.MeshStandardNodeMaterial({ transparent: false, alphaTest: 0.5, side: THREE.DoubleSide });
  material.colorNode = map;
  material.opacityNode = map.a;
  material.roughness = 0.9;
  // Light the card as if its normal leaned skywards: a vertical card facing away from the
  // sun would otherwise go flat black. Sprites read like the HD-2D references this way.
  material.normalNode = transformNormalToView(normalize(normalWorldGeometry.add(vec3(0, 1.4, 0))));
  const sprite = new THREE.Mesh(geometry, material);
  markMovingShadow(sprite);
  sprite.receiveShadow = true;

  const shadowMaterial = new THREE.MeshBasicNodeMaterial({ alphaTest: 0.5, side: THREE.DoubleSide, colorWrite: false, depthWrite: false });
  shadowMaterial.colorNode = map;
  shadowMaterial.opacityNode = map.a;
  const shadowCaster = new THREE.Mesh(geometry, shadowMaterial);
  shadowCaster.castShadow = true;
  markMovingShadow(shadowCaster);

  const group = new THREE.Group();
  group.add(sprite, shadowCaster);
  return { sprite, shadowCaster, group };
}

function gabledRoof(width: number, depth: number, height: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(0, height);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

function std(hex: number, roughness = 0.85, metalness = 0) {
  return new THREE.MeshStandardNodeMaterial({ color: hex, roughness, metalness });
}

function house(x: number, z: number, roof: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(4, 2.4, 3), std(0xeee3cf));
  body.position.y = 1.2;
  const roofMesh = new THREE.Mesh(gabledRoof(4.8, 3.6, 1.6), std(roof, 0.6));
  roofMesh.rotation.y = Math.PI / 2;
  roofMesh.position.y = 2.4;
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.3, 0.1), std(0x6b4a2f));
  door.position.set(-0.8, 0.65, 1.52);
  const win = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.08), std(0x9fd2f0, 0.15));
  win.position.set(0.9, 1.4, 1.52);
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.5), std(0x8c7b6b));
  chimney.position.set(1.1, 3.4, -0.5);
  for (const m of [body, roofMesh, door, win, chimney]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  g.add(body, roofMesh, door, win, chimney);
  g.position.set(x, 0, z);
  return g;
}

function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.Matrix4[]) {
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export interface Placeholder {
  root: THREE.Group;
  billboards: Billboard[];
  /** Point the camera and the DoF focus follow. */
  target: THREE.Vector3;
  update(seconds: number, camera: THREE.Camera, sunDirection: THREE.Vector3, spriteShadows: boolean): void;
}

export function createPlaceholder(): Placeholder {
  const root = new THREE.Group();

  // Ground with a faint step grid so scale reads at a glance.
  const groundMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95 });
  const cell = floor(positionWorld.xz);
  const checker = mod(cell.x.add(cell.y), float(2));
  groundMat.colorNode = mix(color(0x7fb35a), color(0x77ab53), checker);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160).rotateX(-Math.PI / 2), groundMat);
  ground.receiveShadow = true;
  root.add(ground);

  const path = new THREE.Mesh(new THREE.BoxGeometry(3, 0.04, 40), std(0xd9c08e, 0.95));
  path.position.set(0, 0.02, 4);
  path.receiveShadow = true;
  root.add(path);

  // A one-step ledge across the south of the scene.
  const ledge = new THREE.Mesh(new THREE.BoxGeometry(14, 0.5, 1), std(0x6f9c4c, 0.95));
  ledge.position.set(-9, 0.25, 9);
  ledge.castShadow = true;
  ledge.receiveShadow = true;
  root.add(ledge);

  root.add(house(-6, -4, 0xc0453a), house(6, -4, 0x3d6fb6));

  const pond = new THREE.Mesh(new THREE.CircleGeometry(3, 48).rotateX(-Math.PI / 2), std(0x2f6fa8, 0.08, 0));
  pond.position.set(7, 0.03, 6);
  pond.receiveShadow = true;
  root.add(pond);

  // Trees: a ring around the clearing plus a few inside.
  const trunks: THREE.Matrix4[] = [];
  const crowns: THREE.Matrix4[] = [];
  const rand = mulberry32(7);
  const place = (x: number, z: number) => {
    const s = 0.85 + rand() * 0.4;
    trunks.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0.6 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)));
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand() * Math.PI, 0));
    crowns.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 2 * s, z), q, new THREE.Vector3(s, s * 1.1, s)));
  };
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2;
    const r = 15 + rand() * 4;
    place(Math.cos(a) * r, Math.sin(a) * r);
  }
  place(-11, 4);
  place(-3, 13);
  place(11, -9);
  root.add(
    instanced(new THREE.CylinderGeometry(0.18, 0.25, 1.2, 8), std(0x6b4a2f), trunks),
    instanced(new THREE.IcosahedronGeometry(1.2, 1), std(0x3f7d3a, 0.8), crowns),
  );

  // Fence along the north-east.
  const posts: THREE.Matrix4[] = [];
  for (let i = 0; i < 12; i++) posts.push(new THREE.Matrix4().makeTranslation(2 + i, 0.4, 1));
  root.add(instanced(new THREE.BoxGeometry(0.15, 0.8, 0.15), std(0xe8dcc4), posts));
  const rail = new THREE.Mesh(new THREE.BoxGeometry(11, 0.1, 0.08), std(0xe8dcc4));
  rail.position.set(7.5, 0.6, 1);
  rail.castShadow = true;
  root.add(rail);

  const billboards = [
    createBillboard(pixelTexture(KID)),
    createBillboard(pixelTexture(KID, 0x58a55c)),
    createBillboard(pixelTexture(KID, 0xc68a3a)),
  ];
  billboards[1]!.group.position.set(-4.5, 0, -1.5);
  billboards[2]!.group.position.set(4, 0, 3);
  for (const bb of billboards) root.add(bb.group);

  const target = new THREE.Vector3();
  const player = billboards[0]!;
  const cameraDir = new THREE.Vector3();

  return {
    root,
    billboards,
    target,
    update(seconds, camera, sunDirection, spriteShadows) {
      // The player paces a loop on the step grid so motion and shadows can be judged.
      const t = (seconds * 0.25) % 4;
      const leg = Math.floor(t);
      const f = t - leg;
      const corners = [[-2, 2], [2, 2], [2, 6], [-2, 6], [-2, 2]] as const;
      const [ax, az] = corners[leg]!;
      const [bx, bz] = corners[leg + 1]!;
      player.group.position.set(ax + (bx - ax) * f, Math.abs(Math.sin(seconds * 8)) * 0.04, az + (bz - az) * f);
      target.set(player.group.position.x, 0.5, player.group.position.z);

      camera.getWorldDirection(cameraDir);
      const cameraYaw = Math.atan2(-cameraDir.x, -cameraDir.z);
      const sunYaw = Math.atan2(sunDirection.x, sunDirection.z);
      for (const bb of billboards) {
        bb.sprite.rotation.y = cameraYaw; // cylindrical billboard: upright, faces the camera
        bb.shadowCaster.rotation.y = sunYaw;
        bb.shadowCaster.visible = spriteShadows;
        bb.sprite.castShadow = !spriteShadows;
      }
    },
  };
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
