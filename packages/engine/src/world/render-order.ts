// Draw order within the opaque pass, for the few things whose order matters. Everything else is
// 0 and drawn first.

/**
 * People's see-through copies (./sprites.ts `seeThroughMaterial`): after everything that can
 * stand in front of a person, so its depth is there to test against.
 */
export const SEE_THROUGH_RENDER_ORDER = 1;
/**
 * Tall grass, after the see-through copies: a person in the grass keeps their legs hidden, as the
 * game hides them, instead of showing them through the blades.
 */
export const GRASS_RENDER_ORDER = 2;
