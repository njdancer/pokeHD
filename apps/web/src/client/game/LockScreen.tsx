// One device per save (D40): what the player sees when another device has this adventure. The
// game waits behind it to start (it starts by itself once the other device closes it), or has
// stopped because another device took it over. Either way "Play here" brings it to this one, and
// the other device keeps its progress first.
import type { LockHolder } from "../saves/lock.ts";
import { uiLook } from "./ui-look.ts";
import "./start-screen.css";

interface Props {
  kind: "in-use" | "waiting" | "lost";
  /** The other device. */
  other: LockHolder;
  /** What this device is called, to tell another tab here from another device. */
  mine: string;
  onTake(): void;
}

/** "the iPhone", "another window", "another device". */
function where(other: string, mine: string): string {
  if (other === mine) return other === "another device" ? "another window or device" : `another window or ${other}`;
  return other === "another device" ? "another device" : `the ${other}`;
}

export function LockScreen({ kind, other, mine, onTake }: Props) {
  const place = where(other.name, mine);
  return (
    <div className="start-screen lock-screen" data-look={uiLook()} data-testid="lock-screen" data-kind={kind}>
      <div className="start-panel">
        <i className="hd-corner tl" />
        <i className="hd-corner tr" />
        <i className="hd-corner bl" />
        <i className="hd-corner br" />
        {kind === "waiting" ? (
          <p className="start-title start-wait">Saving on {place}…</p>
        ) : (
          <>
            <p className="start-title">{kind === "lost" ? `Now playing on ${place}` : `Playing on ${place}`}</p>
            <p className="lock-note">
              {kind === "lost"
                ? "This adventure moved there, and everything you did here is saved."
                : "This adventure is open there. It starts here when it's closed there."}
            </p>
            <button type="button" className="start-button primary" onClick={onTake} data-testid="lock-take">
              Play here
            </button>
          </>
        )}
      </div>
    </div>
  );
}
