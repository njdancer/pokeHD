import { useState, useSyncExternalStore } from "react";
import type { PlayerInfo } from "@pokehd/protocol";
import type { RoomLink } from "./link.ts";
import "./link-picker.css";

interface Props {
  link: RoomLink;
  /** Everyone else in the room (the room client's player list). */
  players: readonly PlayerInfo[];
}

/**
 * Shown while the game waits at the Cable Club receptionist: who to link with. Friends who are
 * already waiting for this player come first. Closing it leaves the game to time out at the
 * receptionist, as if no one came.
 */
export function LinkPicker({ link, players }: Props) {
  const state = useSyncExternalStore(
    (onChange) => link.subscribe(onChange),
    () => link.state,
  );
  const [closedVisit, setClosedVisit] = useState<number>();
  if (state.status !== "choosing" || closedVisit === state.visit) return null;

  const waiting = new Set(state.waiting);
  const sorted = [...players].sort(
    (a, b) => Number(waiting.has(b.id)) - Number(waiting.has(a.id)) || a.name.localeCompare(b.name),
  );

  return (
    <div className="link-picker" role="dialog" aria-labelledby="link-picker-title">
      <h2 id="link-picker-title">Link with a friend</h2>
      {sorted.length === 0 ? (
        <p>No friends are online.</p>
      ) : (
        <ul>
          {sorted.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => link.choose(p.id)}>
                {p.name}
                {waiting.has(p.id) && <span> is waiting for you</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="link-picker-close" onClick={() => setClosedVisit(state.visit)}>
        Cancel
      </button>
    </div>
  );
}
