import { uniform } from "three/tsl";

/**
 * Seconds of scene animation (grass sway, water), for shaders. The engine advances it with the
 * look's `time.animate`, so freezing time freezes them too; TSL's own `time` is the wall clock.
 */
export const sceneTime = uniform(0);
