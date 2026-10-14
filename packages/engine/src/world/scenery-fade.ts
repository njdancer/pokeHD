import * as THREE from "three/webgpu";
import {
  abs, bool, cameraPosition, dot, float, floor, Fn, fract, Loop, max, min, normalize, positionWorld, screenCoordinate,
  smoothstep, uniform, uniformArray, vec2, vec3,
} from "three/tsl";

// Scenery fades where it stands in front of a person (QA bug 38). On the Game Boy a person is
// never hidden, but here a tree, roof or ledge on the step in front stands up between them and
// the camera (trees are 1.35 steps tall and lean back; the camera looks down at 38°). Every
// scenery fragment that lies between the camera and a nearby person's sprite, within a soft
// margin around the sprite, is dithered away, so the person stays solid and whole and the
// scenery opens around them. Where nothing stands in front of a person nothing changes.
//
// The test is in world space, so it needs only each person's feet: the fragment's view ray is
// carried on to the person's sprite plane (upright, turned to face the camera like the sprite,
// see ./sprites.ts `faceCamera`), and where it lands on that plane, relative to the sprite's
// 1 × 1 quad, says how much to fade. Below the feet nothing fades, so the ground in front of a
// person stays put. Shadows are untouched (`maskShadowNode`): the tree still shades the person.

/** People faded around at once: the player and the nearest NPCs. */
export const FADE_PEOPLE = 8;
/** World units the fade reaches past the sprite's sides and top. */
const MARGIN = 0.35;
/** The sprite quad's half width and height (./sprites.ts `PERSON_GEOMETRY`). */
const HALF_WIDTH = 0.5;
const HEIGHT = 1;

/** Each person's feet in world space (w unused). */
const feet = uniformArray(Array.from({ length: FADE_PEOPLE }, () => new THREE.Vector4()), "vec4");
const count = uniform(0, "int");

/** A 4 × 4 ordered-dither threshold in [0, 1) for a screen pixel. */
const bayer2 = (a: THREE.Node<"vec2">) => fract(dot(a, vec2(0.5, a.y.mul(0.75))));
const bayer4 = (p: THREE.Node<"vec2">) => bayer2(floor(p.mul(0.5))).mul(0.25).add(bayer2(floor(p)));

/** True to keep the fragment: false where it covers a person. */
const keep = Fn(() => {
  const fade = float(0).toVar();
  const eye = cameraPosition;
  const ray = positionWorld.sub(eye);
  Loop(count, ({ i }) => {
    const at = (feet.element(i) as unknown as THREE.Node<"vec4">).xyz;
    // The sprite plane's normal, toward the camera; the sprite turns about the vertical only.
    const n = normalize(vec3(eye.x.sub(at.x), 0, eye.z.sub(at.z)));
    // How far the fragment is in front of the plane (positive: between camera and person).
    const front = dot(positionWorld.sub(at), n);
    // Where its view ray meets the plane, in the sprite's own coordinates. In front of the
    // plane the ray heads away from the camera (negative); kept off zero for fragments behind it,
    // which `front` zeroes anyway, so they never make a NaN.
    const t = dot(at.sub(eye), n).div(min(dot(ray, n), -1e-4));
    const hit = eye.add(ray.mul(t)).sub(at);
    const side = abs(dot(hit, vec3(n.z, 0, n.x.negate())));
    const up = hit.y;
    const outside = vec2(max(side.sub(HALF_WIDTH), 0), max(up.sub(HEIGHT), 0)).length();
    const f = float(1).sub(smoothstep(0, MARGIN, outside))
      .mul(smoothstep(-0.02, 0.04, up))
      .mul(smoothstep(0.02, 0.12, front));
    fade.assign(max(fade, f));
  });
  return bayer4(screenCoordinate.xy).greaterThanEqual(fade);
})();

/** Fades this scenery material around people; idempotent. Call before it's compiled. */
export function fadeAroundPeople(material: THREE.Material) {
  if (!(material instanceof THREE.NodeMaterial) || material.maskNode === keep) return;
  material.maskNode = keep;
  // The shadow pass would otherwise use the mask too, seen from the sun.
  material.maskShadowNode = bool(true);
  material.needsUpdate = true;
}

/**
 * Fades a built map's scenery around people: every mesh but tall grass (which hides a person's
 * legs, as the game does) and water (flat, never in front of anyone).
 */
export function fadeSceneryAroundPeople(group: THREE.Object3D) {
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const recipe = (m as THREE.Material).userData["recipe"] as string | undefined;
      if (recipe === "grass" || recipe === "water") continue;
      fadeAroundPeople(m as THREE.Material);
    }
  });
}

const pool = Array.from({ length: 64 }, () => new THREE.Vector3());
const scratch = new THREE.Vector3();
/**
 * Sets the people to fade around this frame, nearest `from` first; hidden ones are skipped. Reads
 * their positions as just set (through their parent's matrix), not last frame's world matrices.
 */
export function setFadePeople(people: Iterable<THREE.Object3D>, from: THREE.Vector3 | null) {
  const near: THREE.Vector3[] = [];
  for (const p of people) {
    if (!p.visible || near.length === pool.length) continue;
    const v = pool[near.length]!.copy(p.position);
    if (p.parent) v.applyMatrix4(p.parent.matrixWorld);
    near.push(v);
  }
  if (from) near.sort((a, b) => scratch.subVectors(a, from).lengthSq() - scratch.subVectors(b, from).lengthSq());
  const n = Math.min(near.length, FADE_PEOPLE);
  for (let i = 0; i < n; i++) (feet.array[i] as THREE.Vector4).set(near[i]!.x, near[i]!.y, near[i]!.z, 1);
  count.value = n;
}
