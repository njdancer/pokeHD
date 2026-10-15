// Which way the card is turned, from the phone's gyro when it's allowed, else the pointer over
// the card (a mouse, or a finger dragging), else a slow sway so the foil still shows off. Gives
// x (turned right, to 1) and y (turned up, to 1), sprung so it eases rather than jitters.
//
// iOS only hands out device orientation after a tap asks for it (DeviceOrientationEvent.
// requestPermission); `askGyro` must run inside a tap handler. Elsewhere it simply listens.

export type TiltMode = "gyro" | "pointer" | "sway";

interface OrientationPermission {
  requestPermission?: () => Promise<"granted" | "denied">;
}

/** Whether this browser makes a tap ask before it gives the gyro (iOS Safari). */
export const gyroNeedsAsking = () => typeof DeviceOrientationEvent !== "undefined" && typeof (DeviceOrientationEvent as OrientationPermission).requestPermission === "function";

/** Degrees of phone tilt that turn the card all the way. */
const GYRO_RANGE = 22;
/** Seconds for "level" to follow how the phone is held, so any comfortable grip is neutral. */
const SETTLE = 3.5;

function screenAngle(): number {
  const o = screen.orientation?.angle;
  if (typeof o === "number") return o;
  const w = (window as { orientation?: number }).orientation;
  return typeof w === "number" ? w : 0;
}

export class Tilt {
  x = 0;
  y = 0;
  mode: TiltMode = "sway";
  private target = { x: 0, y: 0 };
  private vel = { x: 0, y: 0 };
  private pointer: { x: number; y: number; at: number } | null = null;
  private gyro: { beta: number; gamma: number; at: number } | null = null;
  private level: { beta: number; gamma: number } | null = null;
  private time = 0;
  private listening = false;

  private el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    el.addEventListener("pointermove", this.onPointer);
    el.addEventListener("pointerdown", this.onPointer);
    el.addEventListener("pointerleave", this.onLeave);
    el.addEventListener("pointercancel", this.onLeave);
    // Android and desktop give orientation without asking; iOS needs a tap (askGyro) first.
    if (!gyroNeedsAsking()) this.listen();
  }

  /** Asks for the gyro (in a tap handler on iOS). Resolves whether it's on. */
  async askGyro(): Promise<boolean> {
    if (this.listening && this.gyro) return true;
    const ask = (DeviceOrientationEvent as OrientationPermission | undefined)?.requestPermission;
    if (ask) {
      try {
        if ((await ask()) !== "granted") return false;
      } catch {
        return false;
      }
    }
    this.listen();
    return true;
  }

  /** A flick, as if the card were tapped at (x, y) in −1…1 across it. */
  nudge(x: number, y: number) {
    this.vel.x += x * 7;
    this.vel.y += -y * 7;
  }

  get hasGyro() {
    return !!this.gyro;
  }

  private listen() {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener("deviceorientation", this.onOrientation);
  }

  private onOrientation = (e: DeviceOrientationEvent) => {
    if (e.beta == null || e.gamma == null) return;
    this.gyro = { beta: e.beta, gamma: e.gamma, at: this.time };
    this.level ??= { beta: e.beta, gamma: e.gamma };
  };

  private onPointer = (e: PointerEvent) => {
    const r = this.el.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1;
    const y = ((e.clientY - r.top) / r.height) * 2 - 1;
    // Under a finger the card turns toward it, the way you'd press on its corner.
    this.pointer = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, -y)), at: this.time };
  };

  private onLeave = () => {
    this.pointer = null;
  };

  /** Advances by `dt` seconds; returns whether the card moved enough to draw again. */
  step(dt: number): boolean {
    this.time += dt;
    const fresh = (at: number) => this.time - at < 1.5;
    if (this.gyro && fresh(this.gyro.at)) {
      this.mode = "gyro";
      const g = this.gyro, lv = this.level!;
      // Level slowly follows the grip; quick tilts still read in full.
      const k = 1 - Math.exp(-dt / SETTLE);
      lv.beta += (g.beta - lv.beta) * k;
      lv.gamma += (g.gamma - lv.gamma) * k;
      // In the phone's own frame: tipped right turns the card right; top away turns it up.
      const dx = (g.gamma - lv.gamma) / GYRO_RANGE;
      const dy = -(g.beta - lv.beta) / GYRO_RANGE;
      const a = (screenAngle() * Math.PI) / 180;
      this.target.x = Math.cos(a) * dx - Math.sin(a) * dy;
      this.target.y = Math.sin(a) * dx + Math.cos(a) * dy;
    } else if (this.pointer) {
      this.mode = "pointer";
      this.target.x = this.pointer.x;
      this.target.y = this.pointer.y;
    } else {
      this.mode = "sway";
      this.target.x = Math.sin(this.time * 0.7) * 0.55;
      this.target.y = Math.sin(this.time * 0.47 + 1.3) * 0.4;
    }
    this.target.x = Math.max(-1.2, Math.min(1.2, this.target.x));
    this.target.y = Math.max(-1.2, Math.min(1.2, this.target.y));
    // A spring, a touch under critically damped: eases in, settles with the faintest give.
    const stiff = this.mode === "sway" ? 30 : 140, damp = this.mode === "sway" ? 10 : 20;
    const px = this.x, py = this.y;
    for (const axis of ["x", "y"] as const) {
      const acc = (this.target[axis] - this[axis]) * stiff - this.vel[axis] * damp;
      this.vel[axis] += acc * dt;
      this[axis] += this.vel[axis] * dt;
    }
    return Math.abs(this.x - px) + Math.abs(this.y - py) > 1e-5;
  }

  dispose() {
    this.el.removeEventListener("pointermove", this.onPointer);
    this.el.removeEventListener("pointerdown", this.onPointer);
    this.el.removeEventListener("pointerleave", this.onLeave);
    this.el.removeEventListener("pointercancel", this.onLeave);
    window.removeEventListener("deviceorientation", this.onOrientation);
  }
}
