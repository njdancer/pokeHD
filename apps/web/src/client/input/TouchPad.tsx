import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@pokehd/emu";
import { stickDirection } from "./direction.ts";
import "./touch-pad.css";

/** Inside this fraction of the stick's reach, a thumb presses nothing. */
const STICK_DEADZONE = 0.3;

/** The finger working the stick: where its base sits (zone coordinates) and the direction it holds. */
interface StickTouch {
  id: number;
  baseX: number;
  baseY: number;
  held: number;
}
export interface TouchPadProps {
  onChange: (mask: number) => void;
}

/**
 * The on-screen joypad: a thumbstick on the left, B and A on the right, Select and Start between.
 * The stick floats: it appears wherever a thumb lands in the left-hand zone and follows a thumb
 * that slides past its edge, so it can't be missed. It holds one of four directions (see
 * `stickDirection`). Multi-touch: each finger is tracked separately, and one that slides off a
 * button keeps it held until it lifts, as a thumb resting on a real button would.
 */
export function TouchPad({ onChange }: TouchPadProps) {
  const pointers = useRef(new Map<number, number>());
  const mask = useRef(0);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const publish = () => {
    let next = 0;
    for (const bits of pointers.current.values()) next |= bits;
    if (next === mask.current) return;
    mask.current = next;
    onChangeRef.current(next);
  };

  const press = (bits: number) => (e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, bits);
    publish();
  };
  const release = (e: ReactPointerEvent<HTMLElement>) => {
    if (pointers.current.delete(e.pointerId)) publish();
  };
  const handlers = { onPointerUp: release, onPointerCancel: release, onLostPointerCapture: release };

  const zone = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const stick = useRef<StickTouch | null>(null);

  /** Moves the stick for a thumb at (x, y) in zone coordinates; the base trails a thumb past its reach. */
  const steer = (s: StickTouch, x: number, y: number) => {
    const reach = base.current!.offsetWidth / 2;
    let dx = x - s.baseX;
    let dy = y - s.baseY;
    const out = Math.hypot(dx, dy);
    if (out > reach) {
      s.baseX = x - (dx / out) * reach;
      s.baseY = y - (dy / out) * reach;
      dx = x - s.baseX;
      dy = y - s.baseY;
    }
    base.current!.style.left = `${s.baseX}px`;
    base.current!.style.top = `${s.baseY}px`;
    knob.current!.style.translate = `${dx}px ${dy}px`;
    s.held = stickDirection(dx / reach, dy / reach, s.held, STICK_DEADZONE);
    pointers.current.set(s.id, s.held);
    publish();
  };
  const zonePoint = (e: ReactPointerEvent<HTMLElement>) => {
    const r = zone.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const stickDown = (e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
    if (stick.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = zonePoint(e);
    stick.current = { id: e.pointerId, baseX: x, baseY: y, held: 0 };
    zone.current!.classList.add("active");
    steer(stick.current, x, y);
  };
  const stickMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (stick.current?.id !== e.pointerId) return;
    steer(stick.current, ...zonePoint(e));
  };
  const stickUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (stick.current?.id !== e.pointerId) return;
    stick.current = null;
    zone.current!.classList.remove("active");
    base.current!.style.left = base.current!.style.top = knob.current!.style.translate = "";
    release(e);
  };

  // Lifting the whole pad (unmount) releases everything it held.
  useEffect(
    () => () => {
      if (mask.current) onChangeRef.current(0);
    },
    [],
  );

  const button = (bit: number, label: string, className: string) => (
    <button type="button" className={className} aria-label={label} onPointerDown={press(bit)} {...handlers}>
      {label}
    </button>
  );

  return (
    <div className="touch-pad" onContextMenu={(e) => e.preventDefault()} data-testid="touch-pad">
      <div
        ref={zone}
        className="touch-stick"
        role="group"
        aria-label="Joystick"
        onPointerDown={stickDown}
        onPointerMove={stickMove}
        onPointerUp={stickUp}
        onPointerCancel={stickUp}
        onLostPointerCapture={stickUp}
      >
        <div ref={base} className="touch-stick-base">
          <div ref={knob} className="touch-stick-knob" />
        </div>
      </div>
      <div className="touch-menu">
        {button(Button.Select, "Select", "touch-small")}
        {button(Button.Start, "Start", "touch-small")}
      </div>
      <div className="touch-face">
        {button(Button.B, "B", "touch-round b")}
        {button(Button.A, "A", "touch-round a")}
      </div>
    </div>
  );
}
