// The Pokédex as it opens over the game (p2-dex, p2-menu): the modelled dex shut in the top-right
// corner as the menu button; tapped, it flies to the middle and opens with Nick's tuned motion
// (motion.ts), and the menu draws on its screen. Turning the phone rolls the open dex onto its
// side and the page swaps to the landscape layout as it goes (both drawn while it rolls, crossing
// over). The screen is shaped to the phone's safe area and its corners to the display's, never
// bigger than the largest iPhone's display, so a big monitor gets a phone-sized dex in the middle.
//
// The host owns time and placement; what goes on the screen is the caller's (`children`, given
// the page elements to portal into, or null to draw it some other way if the dex can't load).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { DexStage } from "@pokehd/engine/dex";
import { DEX_MOTION, DexRoll, buttonRect, dexPose, fitBox, heldAngle, motionLength, pageCorners, pageSize, quadTransform, type DexFrame, type Held } from "@pokehd/engine/dex/motion";
import type { Layout } from "../menu/DexMenu.tsx";
import { displayRadius, safeInsets, type SafeInsets } from "./display.ts";
import "./dex-host.css";

const MODEL = "/models/pokedex.glb";
const M = DEX_MOTION;
const LENGTH = motionLength(M);

/** Where the menu draws: the page for how the phone is held, and the other one while it rolls. */
export interface DexSlots {
  screen: HTMLElement;
  layout: Layout;
  also: { screen: HTMLElement; layout: Layout } | null;
}

export interface DexHostProps {
  open: boolean;
  onOpen(): void;
  onClose(): void;
  /** The safe area of the frame the host fills (default: this device's own). */
  insets?: SafeInsets;
  /** The display's corner radius in CSS px (default: this device's, or the canonical dex's 4). */
  radius?: number;
  /** Whether the frame is held sideways, for a frame that isn't the real screen (a mock phone). */
  held?: Held;
  /** A glow of news on the shut dex (a gift waiting). */
  alert?: boolean;
  /** The shut dex steps aside (hidden) while something else has the screen. */
  away?: boolean;
  children(slots: DexSlots | null): ReactNode;
}

export function DexHost({ open, onOpen, onClose, insets, radius, held: heldProp, alert, away, children }: DexHostProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const shadeRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // The two pages: in refs for the frame loop, in state so the menu can portal into them.
  const pagesRef = useRef<{ p: HTMLDivElement | null; l: HTMLDivElement | null }>({ p: null, l: null });
  const [pageP, setPageP] = useState<HTMLDivElement | null>(null);
  const [pageL, setPageL] = useState<HTMLDivElement | null>(null);
  const refP = useCallback((el: HTMLDivElement | null) => {
    pagesRef.current.p = el;
    setPageP(el);
  }, []);
  const refL = useCallback((el: HTMLDivElement | null) => {
    pagesRef.current.l = el;
    setPageL(el);
  }, []);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [held, setHeld] = useState<Held>(0);
  const [rolling, setRolling] = useState(false);
  const [settled, setSettled] = useState(open);

  // Everything the frame loop reads, kept current without re-running effects.
  const live = useRef({ open, insets, radius, heldProp, onClose });
  useLayoutEffect(() => {
    live.current = { open, insets, radius, heldProp, onClose };
  });
  const loop = useRef<{ kick(): void; relayout(): void } | null>(null);

  useEffect(() => {
    // A canvas of its own each time: a disposed renderer loses its canvas's context for good.
    const root = rootRef.current!, canvas = document.createElement("canvas");
    canvas.className = "dh-canvas";
    shadeRef.current!.after(canvas);
    let disposed = false;
    let stage: DexStage | null = null;
    let raf = 0;
    // Opening runs `ms` from 0 to the motion's length; closing back, `close.speed` times faster.
    let ms = live.current.open ? LENGTH : 0;
    let last = 0;
    let heldNow: Held = 0;
    let wasRolling = false;
    const roll = new DexRoll(() => M);
    const fits = new Map<Held, DexFrame["fit"]>();
    const pages = { p: { w: 1, h: 1 }, l: { w: 1, h: 1 } };

    const measureFrame = () => {
      // Layout size, not the box on screen: a scaled frame (a mock phone) scales the dex with it.
      const width = root.clientWidth, height = root.clientHeight;
      const ins = live.current.insets ?? safeInsets();
      const h = live.current.heldProp ?? heldAngle(width, height, screen.orientation?.angle);
      return { width, height, ins, h };
    };

    /** Sizes the canvas, the screen's shape and the two pages for the frame as it is now. */
    const relayout = () => {
      if (!stage) return;
      const { width, height, ins, h } = measureFrame();
      if (!width || !height) return;
      stage.resize(width, height);
      for (const a of [0, 90, -90] as Held[]) fits.set(a, fitBox(width, height, a, ins));
      const portrait = fitBox(width, height, 0, ins).portrait;
      const fill = M.open.fill;
      const r = live.current.radius ?? displayRadius().radius;
      // The screen takes the safe area's shape; its corners the display's radius, as a fraction of its width.
      stage.reshape({ aspect: portrait.width / portrait.height, radius: r / (fill * portrait.width) });
      const frame = stage.frame;
      const sizeOf = (a: Held) => {
        const s = pageSize(M, { ...frame, fit: fits.get(a)! }, stage!.measure, a);
        return { w: s.width, h: s.height };
      };
      pages.p = sizeOf(0);
      pages.l = sizeOf(90);
      // The page's own corners, in its CSS px (the same radius, scaled with the screen as laid out).
      const radiusOf = (s: { w: number; h: number }) => `${(r * (Math.min(s.w, s.h) / (fill * portrait.width))).toFixed(1)}px`;
      for (const [el, s] of [[pagesRef.current.p, pages.p], [pagesRef.current.l, pages.l]] as const) {
        if (!el) continue;
        el.style.width = `${s.w}px`;
        el.style.height = `${s.h}px`;
        el.style.borderRadius = radiusOf(s);
        el.style.setProperty("--m-screen-r", radiusOf(s));
      }
      if (h !== heldNow) {
        heldNow = h;
        roll.to(h, performance.now());
        setHeld(h);
      }
      kick();
    };

    const draw = (now: number) => {
      raf = 0;
      if (!stage) return;
      const dt = last ? Math.min(64, now - last) : 0;
      last = now;
      const want = live.current.open;
      ms = want ? Math.min(LENGTH, ms + dt) : Math.max(0, ms - dt * M.close.speed);
      const angle = roll.at(now);
      const frame = { ...stage.frame, fit: fits.get(heldNow) };
      const pose = dexPose(M, ms, frame, stage.measure, heldNow, angle);
      const quad = stage.render(pose);

      const shade = shadeRef.current;
      if (shade) {
        shade.style.backgroundColor = `rgb(0 0 0 / ${pose.dim.toFixed(3)})`;
        const blur = pose.blur > 0.05 ? `blur(${pose.blur.toFixed(2)}px)` : "none";
        shade.style.backdropFilter = blur;
        shade.style.setProperty("-webkit-backdrop-filter", blur);
        shade.style.visibility = ms > 0 ? "visible" : "hidden";
      }
      const b = buttonRect(M, stage.frame, stage.measure), btn = buttonRef.current;
      if (btn) Object.assign(btn.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });

      // The page for how it's held, and while it rolls the other fading out on its own corners.
      const mix = roll.swap(now);
      const showL = heldNow !== 0, fromL = Math.abs(roll.from) > 45;
      const opL = showL ? (fromL ? 1 : mix) : fromL ? 1 - mix : 0;
      const place = (el: HTMLDivElement | null, size: { w: number; h: number }, op: number, a: Held) => {
        if (!el) return;
        el.style.opacity = String(op);
        el.style.visibility = op > 0.01 ? "visible" : "hidden";
        if (op > 0.01) el.style.transform = quadTransform(size.w, size.h, pageCorners(quad, a));
      };
      place(pagesRef.current.p, pages.p, pose.page * (1 - opL), 0);
      place(pagesRef.current.l, pages.l, pose.page * opL, showL ? heldNow : roll.from > 0 ? 90 : -90);

      const turning = mix < 1;
      if (turning !== wasRolling) {
        wasRolling = turning;
        setRolling(turning);
      }
      const done = want ? ms >= LENGTH : ms <= 0;
      setSettled(done && want);
      // The page swap ends before the roll does: run on to the roll's end.
      if (!done || now - roll.start < M.rotate.duration) raf = requestAnimationFrame(draw);
      else last = 0;
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    loop.current = { kick, relayout };

    void import("@pokehd/engine/dex")
      .then(({ createDexStage }) => createDexStage(canvas, { model: MODEL, shape: { aspect: 0.5, radius: 0 } }))
      .then((s) => {
        if (disposed) return s.dispose();
        stage = s;
        setState("ready");
        relayout();
      })
      .catch((e: unknown) => {
        console.error("[pokeHD] Pokédex stage failed", e);
        if (!disposed) setState("failed");
      });

    const ro = new ResizeObserver(() => relayout());
    ro.observe(root);
    const turned = () => relayout();
    screen.orientation?.addEventListener("change", turned);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      screen.orientation?.removeEventListener("change", turned);
      loop.current = null;
      stage?.dispose();
      canvas.remove();
    };
  }, []);

  useEffect(() => loop.current?.kick(), [open]);
  useEffect(() => loop.current?.relayout(), [insets, radius, heldProp]);

  const slots: DexSlots | null =
    state === "ready" && pageP && pageL
      ? {
          screen: held ? pageL : pageP,
          layout: held ? "landscape" : "portrait",
          also: rolling ? { screen: held ? pageP : pageL, layout: held ? "portrait" : "landscape" } : null,
        }
      : null;

  return (
    <div className={`dh-root${open ? " open" : ""}${settled ? " settled" : ""}${away ? " away" : ""}`} ref={rootRef} data-state={state}>
      <div className="dh-shade" ref={shadeRef} onClick={open ? onClose : undefined} />
      <div className="dh-page" ref={refP} />
      <div className="dh-page" ref={refL} />
      {state !== "failed" && <button type="button" className={`dh-button${alert ? " alert" : ""}`} ref={buttonRef} aria-label="Pokédex" aria-expanded={open} onClick={open ? onClose : onOpen} />}
      {state === "failed" && !open && <button type="button" className="dh-fallback" aria-label="Pokédex" onClick={onOpen} />}
      {children(state === "failed" ? null : slots)}
    </div>
  );
}
