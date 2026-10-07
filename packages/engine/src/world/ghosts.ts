import * as THREE from "three/webgpu";
import type { LiveActor } from "./live.ts";
import { faceCamera, PERSON_GEOMETRY, personMaterial } from "./sprites.ts";

// Friends' ghosts (p3-ghosts): other players drawn where their presence says they are, with the
// same billboard as the local player. Presence arrives over the network at uneven intervals, so
// each ghost plays its samples back a short, fixed delay behind the newest one (snapshot
// interpolation): the motion stays smooth through jitter, at the cost of that delay.

/**
 * One friend's presence, structurally the parts of `Presence` (packages/protocol) this reads,
 * plus who they are. `x`/`y` are step cells on map `mapId`.
 */
export interface GhostState extends LiveActor {
  id: string;
  name?: string;
  mapId: number;
}

/** How a ghost is told apart from the local player; the options Nick chose from (D21). */
export interface GhostLook {
  /** `player`: the local player's colours. `friend`: a green palette swap. */
  palette: "player" | "friend";
  /** 1 is solid. */
  opacity: number;
  /** A name tag above the head. */
  tag: boolean;
}

export const GHOST_LOOKS = {
  plain: { palette: "player", opacity: 1, tag: false },
  tint: { palette: "friend", opacity: 1, tag: false },
  translucent: { palette: "player", opacity: 0.55, tag: false },
  tag: { palette: "player", opacity: 1, tag: true },
  "tint-tag": { palette: "friend", opacity: 1, tag: true },
} as const satisfies Record<string, GhostLook>;
export type GhostLookId = keyof typeof GHOST_LOOKS;
/** Nick picked this (D21). */
export const DEFAULT_GHOST_LOOK: GhostLookId = "tint-tag";

/** Seconds a ghost is drawn behind its newest sample. About six Game Boy frames. */
export const GHOST_DELAY = 0.1;

interface Sample {
  at: number;
  mapId: number;
  /** Map-local position in world units (sprite base centre, before the map's origin). */
  x: number;
  z: number;
  bob: number;
}

/** A loaded map's origin in world units, or undefined if it isn't loaded. */
export type Locate = (mapId: number) => { x: number; z: number } | undefined;

export interface Ghosts {
  readonly group: THREE.Group;
  /** The full set of friends present now; anyone missing has left. `at` is in seconds. */
  set(ghosts: readonly GhostState[], at: number): void;
  /** Places every ghost for time `now` and turns it to the camera. */
  update(now: number, camera: THREE.Camera, locate: Locate): void;
  setLook(look: GhostLook): void;
  /** Friend ID → whether their ghost is drawn this frame, for tests and debugging. */
  readonly visible: ReadonlyMap<string, boolean>;
  dispose(): void;
}

export function actorOffset(a: LiveActor) {
  return {
    x: a.x + (a.step ? a.step.dx * a.step.progress : 0) + 0.5,
    z: a.y + (a.step ? a.step.dy * a.step.progress : 0) + 0.6,
  };
}
export const actorBob = (a: LiveActor) => (a.step && a.animFrame % 2 === 1 ? 0.04 : 0);

interface Ghost {
  name: string;
  samples: Sample[];
  sprite: THREE.Mesh;
  tag: THREE.Sprite | null;
}

export function createGhosts(initial: GhostLook = GHOST_LOOKS[DEFAULT_GHOST_LOOK]): Ghosts {
  const group = new THREE.Group();
  group.name = "ghosts";
  const ghosts = new Map<string, Ghost>();
  const visible = new Map<string, boolean>();
  let look = initial;
  let material = ghostMaterial(look);

  const addTag = (g: Ghost) => {
    if (!look.tag || g.tag) return;
    g.tag = nameTag(g.name);
    if (g.tag) group.add(g.tag);
  };
  const dropTag = (g: Ghost) => {
    if (!g.tag) return;
    group.remove(g.tag);
    g.tag.material.map?.dispose();
    g.tag.material.dispose();
    g.tag = null;
  };

  return {
    group,
    visible,
    set(states, at) {
      const present = new Set<string>();
      for (const s of states) {
        present.add(s.id);
        let g = ghosts.get(s.id);
        if (!g) {
          const sprite = new THREE.Mesh(PERSON_GEOMETRY, material);
          sprite.castShadow = true;
          sprite.visible = false;
          group.add(sprite);
          g = { name: s.name ?? "", samples: [], sprite, tag: null };
          ghosts.set(s.id, g);
          addTag(g);
        } else if (s.name !== undefined && s.name !== g.name) {
          g.name = s.name;
          dropTag(g);
          addTag(g);
        }
        const last = g.samples.at(-1);
        // Samples must move forward in time; a late one replaces nothing.
        if (last && at <= last.at) continue;
        g.samples.push({ at, mapId: s.mapId, ...actorOffset(s), bob: actorBob(s) });
      }
      for (const [id, g] of ghosts) {
        if (present.has(id)) continue;
        group.remove(g.sprite);
        dropTag(g);
        ghosts.delete(id);
        visible.delete(id);
      }
    },
    update(now, camera, locate) {
      const t = now - GHOST_DELAY;
      for (const [id, g] of ghosts) {
        const s = g.samples;
        // The newest sample at or before t, and the one after it.
        let i = s.length - 1;
        while (i > 0 && s[i]!.at > t) i--;
        // Nothing before that sample is needed again.
        s.splice(0, i);
        const a = s[0];
        const b = s[1];
        const pos = a && place(a, b, t, locate);
        g.sprite.visible = !!pos;
        visible.set(id, !!pos);
        if (g.tag) g.tag.visible = !!pos;
        if (!pos) continue;
        g.sprite.position.set(pos.x, pos.bob, pos.z);
        faceCamera(g.sprite, camera);
        g.tag?.position.set(pos.x, pos.bob + 1.5, pos.z);
      }
    },
    setLook(next) {
      look = next;
      const old = material;
      material = ghostMaterial(look);
      for (const g of ghosts.values()) {
        g.sprite.material = material;
        if (look.tag) addTag(g);
        else dropTag(g);
      }
      old.map?.dispose();
      old.dispose();
    },
    dispose() {
      for (const g of ghosts.values()) dropTag(g);
      ghosts.clear();
      group.clear();
      material.map?.dispose();
      material.dispose();
    },
  };
}

/**
 * Where a ghost is drawn at time t, between samples a and b. A ghost is drawn only on a loaded
 * map. Between maps it slides only when both are loaded (a connection); a warp jumps.
 */
function place(a: Sample, b: Sample | undefined, t: number, locate: Locate) {
  const oa = locate(a.mapId);
  if (!b || t <= a.at) return oa && { x: oa.x + a.x, z: oa.z + a.z, bob: a.bob };
  const ob = locate(b.mapId);
  const k = Math.min(Math.max((t - a.at) / (b.at - a.at), 0), 1);
  if (oa && ob) {
    const ax = oa.x + a.x;
    const az = oa.z + a.z;
    const bx = ob.x + b.x;
    const bz = ob.z + b.z;
    // A jump longer than a step in one sample is a warp within loaded maps: don't slide.
    if (Math.hypot(bx - ax, bz - az) > 1.5) return k < 1 ? { x: ax, z: az, bob: a.bob } : { x: bx, z: bz, bob: b.bob };
    return { x: ax + (bx - ax) * k, z: az + (bz - az) * k, bob: k < 0.5 ? a.bob : b.bob };
  }
  // One side isn't loaded: show whichever is, without sliding.
  return oa ? { x: oa.x + a.x, z: oa.z + a.z, bob: a.bob } : undefined;
}

function ghostMaterial(look: GhostLook) {
  const m = personMaterial(look.palette);
  if (look.opacity < 1) {
    m.transparent = true;
    m.opacity = look.opacity;
    m.depthWrite = false;
  }
  return m;
}

/** A camera-facing name label, or null where there's no canvas (Node tests). */
function nameTag(name: string): THREE.Sprite | null {
  if (!name || typeof OffscreenCanvas === "undefined") return null;
  const scale = 4;
  const font = `600 ${11 * scale}px system-ui, sans-serif`;
  const measure = new OffscreenCanvas(1, 1).getContext("2d")!;
  measure.font = font;
  const pad = 5 * scale;
  const w = Math.ceil(measure.measureText(name).width) + pad * 2;
  const h = 18 * scale;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(20, 18, 28, 0.72)";
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, h / 2);
  ctx.fill();
  ctx.font = font;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, w / 2, h / 2 + scale);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteNodeMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false });
  const sprite = new THREE.Sprite(material);
  const height = 0.6;
  sprite.scale.set((height * w) / h, height, 1);
  sprite.renderOrder = 900;
  return sprite;
}
