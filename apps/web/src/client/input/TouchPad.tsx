import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@pokehd/emu";
import { directionMask } from "./direction.ts";
import "./touch-pad.css";

/** Inside this fraction of the D-pad's radius, a touch presses nothing. */
const DPAD_DEADZONE = 0.25;
export interface TouchPadProps {
  onChange: (mask: number) => void;
}

/**
 * The on-screen joypad: a D-pad on the left, B and A on the right, Select and Start between.
 * Multi-touch: each finger is tracked separately, a finger on the D-pad can roll between
 * directions (and diagonals) without lifting, and one that slides off a button keeps it held
 * until it lifts, as a thumb resting on a real button would.
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

  const dpadBits = (e: ReactPointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / (r.width / 2) - 1;
    const y = (e.clientY - r.top) / (r.height / 2) - 1;
    return directionMask(x, y, DPAD_DEADZONE);
  };

  const press = (bits: number) => (e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, bits || dpadBits(e));
    publish();
  };
  const moveOnDpad = (e: ReactPointerEvent<HTMLElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, dpadBits(e));
    publish();
  };
  const release = (e: ReactPointerEvent<HTMLElement>) => {
    if (pointers.current.delete(e.pointerId)) publish();
  };
  const handlers = { onPointerUp: release, onPointerCancel: release, onLostPointerCapture: release };

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
        className="touch-dpad"
        role="group"
        aria-label="D-pad"
        onPointerDown={press(0)}
        onPointerMove={moveOnDpad}
        {...handlers}
      >
        <span className="up" />
        <span className="down" />
        <span className="left" />
        <span className="right" />
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
