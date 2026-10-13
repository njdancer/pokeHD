// The QA stream's page (/dev/stream), as OBS and the harness see it: the game the player drives,
// in the design's gap, over the overlay (/dev/stream/overlay) in its own frame. The overlay can
// be edited and reloaded while the stream runs without touching the game; this page stays small
// and is meant to change rarely. It draws only the PAUSED veil over the game itself.
import { useBus } from "./bus.ts";
import { BUS, GAME, useFit, useFonts } from "./stage.ts";
import "./stream.css";

export function StreamHost() {
  useFonts();
  const scale = useFit();
  const mode = useBus(BUS).status?.mode === "talk" ? "talk" : "play";
  return (
    <div className="qs-shell">
      <div className="qs-fit" style={{ transform: `translate(-50%,-50%) scale(${scale})` }}>
        <div className="qs" data-mode={mode}>
          <iframe className="qs-overlay" src={`/dev/stream/overlay${location.search}`} title="Stream overlay" />
          <div data-gap>
            <iframe id="game" className="qs-game" src={GAME} title="pokeHD" allow="autoplay; fullscreen; gamepad" />
            <div className="qs-veil">
              <div className="qs-veil-badge qs-display">
                <span className="qs-pausebars">
                  <i />
                  <i />
                </span>
                PAUSED
              </div>
              <div className="qs-veil-sub">Haiku is talking to Opus</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
