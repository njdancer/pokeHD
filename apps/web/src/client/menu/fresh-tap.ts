// A sheet the game opens under the player's finger mustn't take that finger's tap. Pressing A on
// the touch pad makes the game ask (the battle bag, the Mart, the PC), its sheet slides up over
// the pad, and when the finger lifts the browser's click lands on whatever is under it now: a
// row of the new list (QA bug 34 went straight to the fifth item's page that way). Only a click
// whose press started inside the sheet counts; a keyboard click (detail 0) has no press and counts.
import { useState } from "react";

interface Press {
  readonly detail: number;
  preventDefault(): void;
  stopPropagation(): void;
}

/** Capture-phase handlers for a sheet's outermost element. */
export interface FreshTapGuard {
  onPointerDownCapture(): void;
  onClickCapture(e: Press): void;
}

export function freshTapGuard(): FreshTapGuard {
  let pressed = false;
  return {
    onPointerDownCapture: () => {
      pressed = true;
    },
    onClickCapture: (e) => {
      if (pressed || e.detail === 0) return;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}

/** One guard for the life of the sheet: a sheet the game opens again gets a new one. */
export function useFreshTapGuard(): FreshTapGuard {
  return useState(freshTapGuard)[0];
}

/**
 * The Pokédex the game opens by itself (a new Pokémon's page after a catch, QA bug 73) flies in
 * over the battle while the player is tapping through its messages, and a tap meant for the next
 * message lands on it: mid-flight its tab bar sweeps across the middle of the screen, so the tap
 * went to the Me tab and the caught Pokémon's page was gone. It takes no tap whose press began
 * before `quietMs` had passed since it opened (its flight and a beat more); a keyboard click (no
 * press) counts at once.
 */
export function quietTapGuard(quietMs: number, now: () => number = () => performance.now()): FreshTapGuard {
  const from = now();
  let pressed = false;
  return {
    onPointerDownCapture: () => {
      pressed = now() - from >= quietMs;
    },
    onClickCapture: (e) => {
      if (pressed || e.detail === 0) return;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
