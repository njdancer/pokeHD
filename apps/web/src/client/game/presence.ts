// The game page's side of the shared world: our decoded state out as presence, friends'
// presence in as ghosts for the live world (p3-rooms-client, p3-ghosts).
import type { OverworldState } from "@pokehd/emu";
import type { GhostState } from "@pokehd/engine/world";
import type { Presence } from "@pokehd/protocol";
import type { Friend } from "../room/client.ts";

/** Our presence for the room; null (no ghost) until a map has loaded. */
export function toPresence(state: OverworldState, inWorld: boolean): Presence | null {
  if (!inWorld) return null;
  const { x, y, facing, step, animFrame, transport } = state.player;
  return { mapId: state.mapId, x, y, facing, step: step && { ...step }, animFrame, transport, mode: state.mode };
}

/** Friends who are in the world, as ghosts. */
export function toGhosts(friends: Readonly<Record<string, Friend>>): GhostState[] {
  return Object.values(friends).flatMap(({ id, name, presence: p }) =>
    p ? [{ id, name, mapId: p.mapId, x: p.x, y: p.y, step: p.step, animFrame: p.animFrame }] : [],
  );
}
