import { useEffect, useRef } from "react";
import { createEngine, type Engine } from "@pokehd/engine";

/** Mounts the engine once. React never touches the frame loop. */
export function GameView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let engine: Engine | undefined;
    let cancelled = false;
    createEngine(canvasRef.current!).then(
      (e) => {
        if (cancelled) return e.dispose();
        engine = e;
        console.info(`[pokeHD] renderer backend: ${e.backend}`);
      },
      (err) => console.error("[pokeHD] renderer failed", err),
    );
    return () => {
      cancelled = true;
      engine?.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="scene" />;
}
