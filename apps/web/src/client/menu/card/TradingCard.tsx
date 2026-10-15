// A Pokémon as a trading card you hold (prototype, /dev/card): printed from the ROM's words and
// PokeAPI's artwork (face.ts), lit with relief, gloss and foil (gl.ts), and turned by the phone's
// gyro, the pointer, or a slow sway (tilt.ts). Face down until caught; catching turns it over.
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { cardPictures, drawBack, drawFront, type CardData, type CardImages, type Finish } from "./face.ts";
import { createCardRenderer, type CardRenderer, type FinishCode } from "./gl.ts";
import { gyroNeedsAsking, Tilt } from "./tilt.ts";
import "./card.css";

export interface TradingCardProps {
  /** The card's front; with none, only its back shows. */
  card: CardData | null;
  finish?: Finish;
  faceDown?: boolean;
  /** Foil strength, 0–1.5 (default 1). */
  foil?: number;
  /** Gloss and glare, 0–1.5 (default 1). */
  shine?: number;
  /** How raised the print feels, 0–2 (default 1). */
  bump?: number;
  /** Degrees the card turns at full tilt. */
  range?: number;
  onTap?(): void;
}

const FINISH: Record<Finish, FinishCode> = { holo: 0, reverse: 1, gold: 2 };
/** CSS perspective, px: about a phone held at reading distance, for a card this size. */
const PERSPECTIVE = 900;
/** The sharpest the print needs: a 3× phone showing the card about 370 px wide. */
const MAX_PIXELS = 1120;

export function TradingCard({ card, finish = "holo", faceDown = false, foil = 1, shine = 1, bump = 1, range = 16, onTap }: TradingCardProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [askTilt, setAskTilt] = useState(gyroNeedsAsking);
  const live = useRef({ finish, faceDown, foil, shine, bump, range, dirty: true });
  useEffect(() => {
    live.current = { finish, faceDown, foil, shine, bump, range, dirty: true };
  }, [finish, faceDown, foil, shine, bump, range]);
  const gpu = useRef<{ renderer: CardRenderer | null; flat: CanvasRenderingContext2D | null; sides: Partial<Record<"front" | "back", CardImages>> }>({ renderer: null, flat: null, sides: {} });
  const tiltRef = useRef<Tilt | null>(null);

  // The canvas follows the card's laid-out width (transforms, like the dex opening, don't count).
  useEffect(() => {
    const box = boxRef.current!;
    const ro = new ResizeObserver(() => setWidth(Math.round(box.clientWidth)));
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // The renderer, once per canvas; unlit 2D if WebGL2 can't start.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = createCardRenderer(canvas);
    gpu.current.renderer = renderer;
    gpu.current.flat = renderer ? null : canvas.getContext("2d");
    return () => {
      renderer?.dispose();
      gpu.current = { renderer: null, flat: null, sides: {} };
    };
  }, []);

  const pixels = Math.min(MAX_PIXELS, Math.round(width * Math.min(3, devicePixelRatio || 1)));

  // The print: the front once its pictures are in, and the back. Redrawn when what's printed
  // changes, not whenever the caller makes a new object for the same card.
  const printed = card && JSON.stringify(card);
  const printRef = useRef(card);
  useEffect(() => {
    printRef.current = card;
  });
  useEffect(() => {
    const card = printRef.current;
    if (!pixels) return;
    const canvas = canvasRef.current!;
    canvas.width = pixels;
    canvas.height = Math.round((pixels * 88) / 63);
    const g = gpu.current;
    const back = drawBack(pixels);
    g.sides.back = back;
    g.renderer?.setImages("back", back);
    live.current.dirty = true;
    if (!card) return;
    let gone = false;
    cardPictures(card).then((pics) => {
      if (gone) return;
      const front = drawFront(card, finish, pics, pixels);
      g.sides.front = front;
      g.renderer?.setImages("front", front);
      live.current.dirty = true;
    });
    return () => {
      gone = true;
    };
  }, [printed, finish, pixels]);

  // Every frame while on screen: step the tilt and the flip, turn the card, light it.
  useEffect(() => {
    const el = cardRef.current!;
    const tilt = new Tilt(el);
    tiltRef.current = tilt;
    let flip = live.current.faceDown ? Math.PI : 0, flipVel = 0;
    let raf = 0, last = performance.now(), visible = true;
    const turn = new Float32Array(9);
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!visible || document.hidden) return;
      const L = live.current;
      const moved = tilt.step(dt);
      const goal = L.faceDown ? Math.PI : 0;
      const flipping = Math.abs(goal - flip) > 1e-3 || Math.abs(flipVel) > 1e-3;
      if (flipping) {
        flipVel += ((goal - flip) * 90 - flipVel * 15) * dt;
        flip += flipVel * dt;
      }
      if (!moved && !flipping && !L.dirty) return;
      L.dirty = false;
      const k = (L.range * Math.PI) / 180;
      const ax = tilt.y * k, ay = tilt.x * k + flip;
      el.style.transform = `rotateX(${ax}rad) rotateY(${ay}rad)`;
      const back = Math.cos(ay) < 0;
      el.style.setProperty("--sx", `${(-tilt.x * 14).toFixed(1)}px`);
      el.style.setProperty("--sy", `${(18 + tilt.y * 10).toFixed(1)}px`);
      const g = gpu.current;
      if (g.renderer) {
        // World turn = Rx(−ax)·Ry(ay) (CSS's y points down), and half a turn more for the back.
        const b = back ? ay + Math.PI : ay;
        const cx = Math.cos(-ax), sx = Math.sin(-ax), cy = Math.cos(b), sy = Math.sin(b);
        // Column-major: columns are the card's x, y and z axes in the world.
        turn.set([cy, sx * sy, -cx * sy, 0, cx, sx, sy, -sx * cy, cx * cy]);
        g.renderer.draw({ turn, eye: PERSPECTIVE / Math.max(1, el.clientWidth), finish: FINISH[L.finish], foil: L.foil, shine: L.shine, bump: L.bump, back });
      } else if (g.flat) {
        const side = g.sides[back ? "back" : "front"];
        const c = g.flat;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, c.canvas.width, c.canvas.height);
        if (side) {
          if (back) c.setTransform(-1, 0, 0, 1, c.canvas.width, 0);
          c.drawImage(side.face, 0, 0);
        }
      }
    };
    raf = requestAnimationFrame(frame);
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      live.current.dirty = true;
    });
    io.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      tilt.dispose();
      tiltRef.current = null;
    };
  }, []);

  const tap = (e: MouseEvent<HTMLDivElement>) => {
    const tilt = tiltRef.current;
    if (tilt) {
      const r = e.currentTarget.getBoundingClientRect();
      tilt.nudge(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
      if (askTilt) tilt.askGyro().then((on) => on && setAskTilt(false));
    }
    onTap?.();
  };

  return (
    <div className="tc" ref={boxRef}>
      <div className="tc-stage" style={{ perspective: `${PERSPECTIVE}px` }}>
        <div className="tc-card" ref={cardRef} onClick={tap} role="img" aria-label={card && !faceDown ? `${card.name}'s card` : "A card, face down"}>
          <canvas ref={canvasRef} className="tc-canvas" />
        </div>
      </div>
      {askTilt && <p className="tc-hint">Tap the card, then tilt your phone</p>}
    </div>
  );
}
