import * as THREE from "three/webgpu";
import { FIRST_INDOOR_MAP, type MapData, type MapId, type WorldData } from "@pokehd/rom";
import type { CameraView, LookController, WorldContent } from "../index.ts";
import { arenaPlacement } from "../battle/placement.ts";
import { createBattleLayer, type ArenaStyle, type BattleLayer, type BattleView } from "../battle/layer.ts";
import type { BlockRect } from "./chunk.ts";
import { createChunkBuilder, type ChunkBuilder, type ChunkResult } from "./chunk-builder.ts";
import { disposeTree } from "./content.ts";
import { actorBob, actorOffset, createGhosts, GHOST_LOOKS, DEFAULT_GHOST_LOOK, type GhostLook, type GhostState } from "./ghosts.ts";
import { DEFAULT_STYLE_PARAMS, type StyleParams } from "./params.ts";
import { placeColours as sgbPlaceColours, PLAIN_COLOURS, playerRamp } from "./place.ts";
import { placeMaps, TILE_UNITS } from "./region.ts";
import { createSpriteSet, faceCamera, SPRITE_RED, SPRITE_SEEL, type Facing, type SpriteActor } from "./sprites.ts";
import { DEFAULT_STYLE, type StyleId } from "./styles.ts";

// The live overworld (p1-state-render): the world the game is in, driven by a stream of decoded
// game state. Each map is a chunk built from ROM data and positioned by its connections, so
// walking across a route edge needs no rebuild. Chunks two connections away are built ahead,
// one at a time and only while the player is well inside a map. Builds run in a worker
// (./chunk-builder.ts), so the main thread only turns the result into three.js objects. Chunks left behind (by a warp, or by walking more than two
// connections away) are kept, unrendered, for a while: going back outside from a house reuses
// them rather than building them again, and keeps their shaders compiled (the first frame that
// draws freshly built chunks can take 80–160 ms in WebGPU and seconds in WebGL2). Given the
// engine's precompiler, a new chunk joins the scene only once its shaders are compiled.
// World units: 1 unit = 1 step, as everywhere in ./world.

/**
 * The parts of `OverworldState` (packages/emu/src/state/overworld.ts) this reads. Kept
 * structural so the engine doesn't depend on the emulator package; `OverworldState` fits it.
 * Feed it the stateful decoder's output: a map change that isn't a connection is assumed to be
 * hidden behind a fade.
 */
export interface LiveActor {
  x: number;
  y: number;
  step: { dx: number; dy: number; progress: number } | null;
  animFrame: number;
  /** Which way the sprite faces; down when absent. */
  facing?: Facing;
}
export interface LiveState {
  mapId: number;
  /**
   * wLastMap, the town or route last stepped out of: buildings take its colours. When absent,
   * the last outdoor map this world saw stands in.
   */
  lastMap?: number;
  /** `transport` picks the player's sheet (walking, bike, surfing); walking when absent. */
  player: LiveActor & { transport?: "walk" | "bike" | "surf" };
  /**
   * `pictureId` is the sprite ID (SPRITE_* constant); when absent, the map data's sprite for
   * the slot's object is used.
   */
  npcs: (LiveActor & { slot: number; visible: boolean; pictureId?: number })[];
  /** 0 normal, 1 black, −1 white. */
  fade: number;
}

/** The emulator's frame rate; states arrive this often. */
export const GB_FRAME_SECONDS = 1 / 59.7275;
/** Border blocks drawn around each map. */
const MARGIN_BLOCKS = 3;
/** Chunks this many connections from the player's map are kept loaded. */
const KEEP_HOPS = 2;
/** Far chunks wait until the player is this many steps inside the current map. */
const BUILD_CLEARANCE = 4;
/** Built chunks kept, unrendered, after they leave the loaded set. */
const SPARE_CHUNKS = 10;
/** Seconds the camera takes to swing into a battle and back out. */
const BATTLE_SWING = 1.1;
/** The look's camera when there's no look to read it from. */
const DEFAULT_VIEW: CameraView = { pitch: 38, yaw: 0, distance: 30, fov: 24 };

export interface LiveWorldOptions {
  style?: StyleId;
  params?: StyleParams;
  /** Lets fades to black wrap the day to morning when it's due (D16). Or call `setLook` later. */
  look?: LookLike;
  /** How friends' ghosts are drawn; see `GHOST_LOOKS`. */
  ghostLook?: GhostLook;
  /** Colour places from their SGB palettes (./place.ts); false gives the plain base look. Default true. */
  sgbColours?: boolean;
  /** How battles look; see `ARENA_STYLES`. */
  arena?: ArenaStyle;
  /** Seconds on the performance clock; tests replace it. */
  clock?: () => number;
  /** Where chunks get built; defaults to a worker where there is one. */
  builder?: ChunkBuilder;
}

type LookLike = Pick<LookController, "params" | "wrapToMorning">;

export interface LiveWorld extends WorldContent {
  /** Hands over the state decoded after an emulator frame. `at` is in seconds (performance clock). */
  push(state: LiveState, at?: number): void;
  /**
   * Friends present now, from the room's presence; anyone missing has left. A friend is drawn
   * only while their map is loaded. `at` is in seconds (performance clock).
   */
  setGhosts(ghosts: readonly GhostState[], at?: number): void;
  setGhostLook(look: GhostLook): void;
  /** Friend ID → whether their ghost is drawn this frame. */
  readonly ghosts: ReadonlyMap<string, boolean>;
  /** The engine hands over its shader precompiler; new chunks wait for it before being drawn. */
  setCompiler(compile: ((object: THREE.Object3D) => Promise<void>) | null): void;
  /** The engine's look, once it exists (the engine is created with this world as content). */
  setLook(look: LookLike): void;
  /**
   * The latest chunk builds, newest last (at most 16), for perf checks. `ms` is main-thread time
   * (the whole build when there's no worker), `at` when that started (performance.now()), and
   * `totalMs` the time from asking for the build to having it.
   */
  readonly builds: readonly ChunkBuild[];
  /** Map ID → chunk build status, for debugging. */
  readonly chunks: ReadonlyMap<MapId, "queued" | "built">;
  /**
   * The battle screen after each emulator frame while a battle is on, null otherwise. The
   * battle is staged where the player stands; the camera swings round to it and back after.
   */
  setBattle(view: BattleView | null): void;
  setArenaStyle(style: ArenaStyle): void;
  /** The battle camera while one is on screen (or swinging back). */
  readonly view: CameraView | null;
  dispose(): void;
}

export interface ChunkBuild {
  map: MapId;
  ms: number;
  at: number;
  totalMs: number;
}

interface Chunk {
  map: MapData;
  /** Connections from the player's map. */
  hops: number;
  /** Map origin in world blocks. */
  bx: number;
  by: number;
  group: THREE.Group | null;
  /** Where the group sits relative to the map origin, in world units. */
  offset: { x: number; z: number };
}

export function createLiveWorld(world: WorldData, options: LiveWorldOptions = {}): LiveWorld {
  const style = options.style ?? DEFAULT_STYLE;
  const params = options.params ?? DEFAULT_STYLE_PARAMS;
  const root = new THREE.Group();
  const target = new THREE.Vector3();
  const chunks = new Map<MapId, Chunk>();
  let current: MapId | null = null;
  /** The town or route outside, for indoor maps' colours. */
  let outside: MapId | undefined;
  let look = options.look;
  let disposed = false;
  let compile: ((object: THREE.Object3D) => Promise<void>) | null = null;
  /** Chunk groups whose shaders are compiled (or that were built with no compiler to wait for). */
  const compiled = new WeakSet<THREE.Group>();
  /** Adds a loaded chunk's group to the scene, once it's compiled. */
  const show = (c: Chunk) => {
    if (c.group && compiled.has(c.group)) root.add(c.group);
  };
  const clock = options.clock ?? (() => performance.now() / 1000);
  const sgb = options.sgbColours ?? true;
  const placeColours = (...args: Parameters<typeof sgbPlaceColours>) => (sgb ? sgbPlaceColours(...args) : PLAIN_COLOURS);

  // Placing maps: the first map anchors world space; connected maps are placed relative to it.
  const place = (id: MapId): Chunk | undefined => chunks.get(id);
  const neighbours = (c: Chunk) =>
    placeMaps(world, c.map.id, c.map.connections.map((n) => n.map))
      .filter((p) => p.map.id !== c.map.id)
      .map((p) => ({ map: p.map, bx: c.bx + p.bx, by: c.by + p.by }));

  const enter = (id: MapId) => {
    if (id === current) return;
    let here = place(id);
    if (!here) {
      // Not connected to what's loaded: a warp. Start over around the new map.
      const map = world.maps[id];
      if (!map) return;
      for (const c of chunks.values()) retire(c);
      chunks.clear();
      here = revive(map, 0, 0, 0);
      chunks.set(id, here);
    }
    current = id;
    // Keep maps up to KEEP_HOPS connections away; anything missing joins the build queue.
    here.hops = 0;
    const keep = new Set([id]);
    let ring = [here];
    for (let hops = 1; hops <= KEEP_HOPS; hops++) {
      const next: Chunk[] = [];
      for (const c of ring) {
        for (const n of neighbours(c)) {
          if (keep.has(n.map.id)) continue;
          keep.add(n.map.id);
          const chunk = chunks.get(n.map.id) ?? revive(n.map, n.bx, n.by, hops);
          chunk.hops = hops;
          chunks.set(n.map.id, chunk);
          next.push(chunk);
        }
      }
      ring = next;
    }
    for (const [cid, c] of chunks) {
      if (!keep.has(cid)) {
        retire(c);
        chunks.delete(cid);
      }
    }
  };

  /** Built chunks out of the loaded set, oldest first. Their maps' borders don't depend on placement. */
  const spare = new Map<MapId, Chunk>();
  const retire = (c: Chunk) => {
    if (!c.group) return;
    root.remove(c.group);
    spare.delete(c.map.id);
    spare.set(c.map.id, c);
    for (const [id, old] of spare) {
      if (spare.size <= SPARE_CHUNKS) break;
      spare.delete(id);
      drop(old);
    }
  };
  /** A chunk for `map` at a new placement: a spare one if there is one, else one to build. */
  const revive = (map: MapData, bx: number, by: number, hops: number): Chunk => {
    const old = spare.get(map.id);
    if (!old?.group) return { map, bx, by, hops, group: null, offset: { x: 0, z: 0 } };
    spare.delete(map.id);
    const c = { ...old, bx, by, hops };
    c.group!.position.set(bx * 2 + c.offset.x, 0, by * 2 + c.offset.z);
    show(c);
    return c;
  };

  const drop = (c: Chunk) => {
    if (!c.group) return;
    root.remove(c.group);
    disposeTree(c.group);
    c.group = null;
  };

  const builder = options.builder ?? createChunkBuilder(world);
  /** The chunk being built in the background; one at a time, nearest first. */
  let building: Chunk | null = null;
  const builds: ChunkBuild[] = [];
  const build = (c: Chunk) => {
    const rect = (m: { map: MapData; bx: number; by: number }): BlockRect => ({
      id: m.map.id, x0: m.bx, y0: m.by, x1: m.bx + m.map.widthBlocks, y1: m.by + m.map.heightBlocks,
    });
    const result = builder.build({
      map: c.map.id,
      rects: [rect(c), ...neighbours(c).map(rect)],
      marginBlocks: MARGIN_BLOCKS,
      style,
      params,
      colours: placeColours(world, c.map.id, outside),
    });
    if (!(result instanceof Promise)) return finish(c, result);
    building = c;
    result.then(
      (r) => {
        building = null;
        if (!disposed) finish(c, r);
      },
      (e: unknown) => {
        building = null;
        console.warn(`[pokeHD] couldn't build map ${c.map.id}`, e);
        c.group = new THREE.Group(); // don't try again
      },
    );
  };
  /** Takes a built chunk on: into the scene once compiled, or kept spare if it's no longer loaded. */
  const finish = (c: Chunk, r: ChunkResult) => {
    // The map may have been left and come back since (a new Chunk, still unbuilt); its border
    // doesn't depend on placement, so the build serves it.
    const now = chunks.get(c.map.id);
    const owner = now && !now.group ? now : c;
    const group = r.group;
    owner.offset = { x: -r.rootX * TILE_UNITS, z: -r.rootY * TILE_UNITS };
    group.position.set(owner.bx * 2 + owner.offset.x, 0, owner.by * 2 + owner.offset.z);
    owner.group = group;
    if (!compile) {
      compiled.add(group);
      show(owner);
    } else {
      const ready = () => {
        compiled.add(group);
        // It may have been dropped, or retired and revived (a new Chunk with the same group).
        const current = chunks.get(owner.map.id);
        if (current?.group === group) show(current);
      };
      compile(group).then(ready, (e: unknown) => {
        console.warn("[pokeHD] couldn't precompile a map chunk", e);
        ready();
      });
    }
    if (chunks.get(owner.map.id) !== owner) retire(owner);
    const at = performance.now() - r.mainMs;
    builds.push({ map: owner.map.id, ms: r.mainMs, at, totalMs: r.totalMs });
    if (builds.length > 16) builds.shift();
  };

  // Actors, interpolated one emulator frame behind the newest state.
  const sprites = createSpriteSet();
  const player = sprites.actor();
  const playerColours = sgb ? playerRamp(world) : PLAIN_COLOURS.people;
  const playerSprite = player.mesh;
  root.add(playerSprite);
  const npcSprites = new Map<number, SpriteActor>();
  const playerSheet = (transport: LiveState["player"]["transport"]) =>
    transport === "bike" ? world.bikeSprite : world.sprites[transport === "surf" ? SPRITE_SEEL : SPRITE_RED];

  interface Sample { at: number; x: number; z: number }
  let prev: Sample | null = null;
  let last: Sample | null = null;
  let latest: LiveState | null = null;
  let wrapped = false;

  const fadeMaterial = new THREE.MeshBasicNodeMaterial({ color: 0x000000, transparent: true, depthTest: false, depthWrite: false, fog: false });
  const fadeQuad = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), fadeMaterial);
  fadeQuad.renderOrder = 1000;
  fadeQuad.frustumCulled = false;
  root.add(fadeQuad);

  /** An actor's drawn position in world units (sprite base centre), for the current map. */
  const drawn = (a: LiveActor, c: Chunk) => {
    const o = actorOffset(a);
    return { x: c.bx * 2 + o.x, z: c.by * 2 + o.z };
  };
  const bob = actorBob;

  const ghosts = createGhosts(options.ghostLook ?? GHOST_LOOKS[DEFAULT_GHOST_LOOK]);
  root.add(ghosts.group);
  const locate = (mapId: number) => {
    const c = chunks.get(mapId as MapId);
    return c?.group ? { x: c.bx * 2, z: c.by * 2 } : undefined;
  };

  // Battles: a layer staged where the player stood when the battle began.
  let battle: BattleLayer | null = null;
  let arenaStyle = options.arena ?? "field";
  let inBattle = false;
  /** 0 overworld … 1 battle, eased by the update. */
  let swing = 0;
  let swungAt = clock();
  let view: CameraView | null = null;
  const walkTarget = new THREE.Vector3();
  const startBattle = () => {
    const here = current === null ? undefined : chunks.get(current);
    const p = latest?.player;
    if (!here || !p) return;
    battle ??= createBattleLayer(arenaStyle);
    if (!battle.root.parent) root.add(battle.root);
    const placed = arenaPlacement(world, here.map, { x: p.x, y: p.y, facing: p.facing ?? "down" }, p.transport === "surf");
    const ox = here.bx * 2;
    const oz = here.by * 2;
    battle.place({
      player: { x: ox + placed.player.x, z: oz + placed.player.z },
      enemy: { x: ox + placed.enemy.x, z: oz + placed.enemy.z },
      ground: placed.ground,
    });
  };
  const ease = (t: number) => t * t * (3 - 2 * t);
  const mixAngle = (a: number, b: number, t: number) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;

  return {
    root,
    target,
    get view() {
      return view;
    },
    setBattle(next) {
      if (next && !inBattle) startBattle();
      inBattle = next !== null && battle !== null;
      if (next) battle?.push(next);
    },
    setArenaStyle(style) {
      arenaStyle = style;
      battle?.setStyle(style);
    },
    setLook(next) {
      look = next;
    },
    setCompiler(next) {
      compile = next;
    },
    setGhosts(states, at = clock()) {
      ghosts.set(states, at);
    },
    setGhostLook(next) {
      ghosts.setLook(next);
    },
    get ghosts() {
      return ghosts.visible;
    },
    get builds() {
      return builds;
    },
    get chunks() {
      return new Map([...chunks].map(([id, c]) => [id, c.group ? "built" : "queued"] as const));
    },
    get placeTint() {
      return current === null ? null : placeColours(world, current, outside).tint;
    },
    push(state, at = clock()) {
      const before = current;
      if (state.lastMap !== undefined) outside = state.lastMap;
      else if (state.mapId < FIRST_INDOOR_MAP) outside = state.mapId;
      enter(state.mapId);
      const c = current === null ? undefined : chunks.get(current);
      if (!c) return;
      const p = drawn(state.player, c);
      // A warp jumps; don't slide across it.
      const jumped = before !== current && !(before !== null && chunks.has(before));
      prev = jumped || !last ? { at, ...p } : last;
      last = { at, ...p };
      latest = state;
    },
    update(_seconds, camera) {
      // One build at a time: this map, then its neighbours, then (only away from the
      // edges) maps two connections out.
      const here = current === null ? undefined : chunks.get(current);
      const p = latest?.player;
      const inside =
        !!here && !!p &&
        Math.min(p.x, p.y, here.map.widthBlocks * 2 - 1 - p.x, here.map.heightBlocks * 2 - 1 - p.y) >= BUILD_CLEARANCE;
      if (!building) {
        const pending = [...chunks.values()].filter((c) => !c.group && (c.hops <= 1 || inside));
        pending.sort((a, b) => a.hops - b.hops);
        if (pending[0]) build(pending[0]);
      }

      if (latest && here && prev && last) {
        const now = clock();
        const span = Math.max(last.at - prev.at, 1e-3);
        const t = Math.min(Math.max((now - last.at) / span, 0), 1);
        const x = prev.x + (last.x - prev.x) * t;
        const z = prev.z + (last.z - prev.z) * t;
        playerSprite.position.set(x, bob(latest.player), z);
        player.show(playerSheet(latest.player.transport), latest.player.facing ?? "down", latest.player.animFrame, playerColours);
        const people = placeColours(world, here.map.id, outside).people;
        target.set(x, 0.5, z);

        const seen = new Set<number>();
        for (const npc of latest.npcs) {
          let s = npcSprites.get(npc.slot);
          if (!s) {
            s = sprites.actor();
            npcSprites.set(npc.slot, s);
            root.add(s.mesh);
          }
          const d = drawn(npc, here);
          const sprite = npc.pictureId ?? here.map.npcs[npc.slot - 1]?.sprite;
          s.show(sprite === undefined ? null : world.sprites[sprite], npc.facing ?? "down", npc.animFrame, people);
          s.mesh.position.set(d.x, bob(npc), d.z);
          s.mesh.visible = npc.visible;
          seen.add(npc.slot);
        }
        for (const [slot, s] of npcSprites) if (!seen.has(slot)) s.mesh.visible = false;

        // Fades: the game's own fade drawn over the HD view; the day wraps inside a black one.
        const fade = latest.fade;
        fadeQuad.visible = fade !== 0;
        fadeMaterial.color.set(fade > 0 ? 0x000000 : 0xffffff);
        fadeMaterial.opacity = Math.min(Math.abs(fade), 1);
        if (fade >= 1 && !wrapped && look && look.params.time.phase >= 1) {
          look.wrapToMorning(true);
          wrapped = true;
        }
        if (fade < 1) wrapped = false;
      }

      // Battles: swing the camera between the walk and the battle, and hide the walk while it's on.
      const now = clock();
      const dt = Math.min(Math.max(now - swungAt, 0), 0.1);
      swungAt = now;
      swing = Math.min(Math.max(swing + (inBattle ? dt : -dt) / BATTLE_SWING, 0), 1);
      const s = ease(swing);
      walkTarget.copy(target);
      const staged = battle !== null && swing > 0;
      if (battle) {
        battle.root.visible = inBattle;
        if (staged) {
          battle.update(camera);
          target.lerpVectors(walkTarget, battle.target, s);
          const base = look?.params.camera ?? DEFAULT_VIEW;
          const b = battle.view;
          view = {
            pitch: base.pitch + (b.pitch - base.pitch) * s,
            yaw: mixAngle(base.yaw, b.yaw, s),
            distance: base.distance + (b.distance - base.distance) * s,
            fov: base.fov + (b.fov - base.fov) * s,
          };
        } else view = null;
      }
      const away = staged && s > 0.5;
      playerSprite.visible = !away;
      for (const sprite of npcSprites.values()) if (away) sprite.mesh.visible = false;
      ghosts.group.visible = !away;
      const hideWorld = away && inBattle && battle!.hidesWorld;
      for (const c of chunks.values()) if (c.group) c.group.visible = !hideWorld;

      ghosts.update(clock(), camera, locate);
      faceCamera(playerSprite, camera);
      for (const s of npcSprites.values()) faceCamera(s.mesh, camera);
      // Keep the fade quad just in front of the camera, filling the view.
      camera.getWorldDirection(fadeQuad.position);
      fadeQuad.position.multiplyScalar(0.6).add(camera.position);
      fadeQuad.quaternion.copy(camera.quaternion);
    },
    dispose() {
      disposed = true;
      if (!options.builder) builder.dispose();
      for (const c of [...chunks.values(), ...spare.values()]) drop(c);
      chunks.clear();
      spare.clear();
      fadeQuad.geometry.dispose();
      fadeMaterial.dispose();
      ghosts.dispose();
      sprites.dispose();
      battle?.dispose();
    },
  };
}
