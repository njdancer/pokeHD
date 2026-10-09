// The page's own start screen (tap-first UI), in place of the title screen and the game's
// CONTINUE / NEW GAME menu. The game runs them unseen behind it and the page presses its buttons
// for the choice (Starter in onboarding.ts).
import { useState } from "react";
import type { SaveSummary } from "@pokehd/emu";
import { decodeText } from "@pokehd/rom";
import type { StartChoice } from "./onboarding.ts";
import type { UiLook } from "./ui-look.ts";
import "./text-overlay.css";
import "./start-screen.css";

interface Props {
  save: SaveSummary | null;
  /** The signed-in player's name, for a new game's greeting. */
  accountName: string | null;
  look: UiLook;
  /** Set once a choice is on its way into the game. */
  starting: StartChoice | null;
  onStart(choice: StartChoice): void;
}

export function StartScreen({ save, accountName, look, starting, onStart }: Props) {
  const [confirmNew, setConfirmNew] = useState(false);
  const name = save ? decodeText(save.name) : accountName;
  return (
    <div className="start-screen" data-look={look} data-testid="start-screen">
      <div className="start-panel">
        <i className="hd-corner tl" />
        <i className="hd-corner tr" />
        <i className="hd-corner bl" />
        <i className="hd-corner br" />
        {starting ? (
          <p className="start-title start-wait">{starting === "continue" ? "Off we go…" : "Here we go…"}</p>
        ) : save ? (
          <>
            <p className="start-title">Welcome back{name ? `, ${name}` : ""}!</p>
            <ul className="start-facts">
              <li><strong>{save.badges}</strong> {save.badges === 1 ? "badge" : "badges"}</li>
              <li><strong>{save.owned}</strong> caught</li>
              <li><strong>{save.hours}:{String(save.minutes).padStart(2, "0")}</strong> played</li>
            </ul>
            <button type="button" className="start-button primary" onClick={() => onStart("continue")} data-testid="start-continue">
              Continue
            </button>
            {confirmNew ? (
              <div className="start-new-check">
                <p>Start again from the very beginning? Your adventure so far stays saved until you save the new one.</p>
                <div className="start-row">
                  <button type="button" className="start-button" onClick={() => setConfirmNew(false)}>Keep playing mine</button>
                  <button type="button" className="start-button" onClick={() => onStart("new")} data-testid="start-new">New game</button>
                </div>
              </div>
            ) : (
              <button type="button" className="start-link" onClick={() => setConfirmNew(true)}>New game</button>
            )}
          </>
        ) : (
          <>
            <p className="start-title">Hello there{name ? `, ${name}` : ""}!</p>
            <p className="start-sub">A world of adventure is waiting.</p>
            <button type="button" className="start-button primary" onClick={() => onStart("new")} data-testid="start-new">
              Start my adventure
            </button>
          </>
        )}
      </div>
    </div>
  );
}
