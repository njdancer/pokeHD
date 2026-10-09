// Oak's introduction in HD (tap-first UI): the pictures the game draws above the message box
// (Oak, the Nidorino, the player and the rival) are lifted off the Game Boy screen each frame and
// stood over the HD world, crisp, with the HD text layer drawing the words. The game draws and
// times everything; this only moves it off the little screen.
import { forwardRef } from "react";
import { SCREEN_WIDTH } from "@pokehd/emu";
import { STAGE_HEIGHT } from "./intro-pictures.ts";
import "./text-overlay.css";

export const IntroStage = forwardRef<HTMLCanvasElement>(function IntroStage(_props, ref) {
  return (
    <div className="hd-text intro-stage" aria-hidden>
      <div className="intro-light" />
      <div className="hd-text-stage">
        <canvas ref={ref} width={SCREEN_WIDTH} height={STAGE_HEIGHT} />
      </div>
    </div>
  );
});
