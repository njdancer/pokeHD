import { describe, expect, it } from "vitest";
import { Button } from "@pokehd/emu";
import {
  DEFAULT_KEY_BINDINGS,
  bindKey,
  keyLabel,
  keyMasks,
  loadKeyBindings,
  saveKeyBindings,
} from "./bindings.ts";
import { directionMask, dropOpposites, pressInto } from "./direction.ts";
import { gamepadMask, type PadLike } from "./gamepad.ts";
import { JoypadInput, type InputEnvironment } from "./joypad.ts";

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

function fakeEnv(pads: (PadLike | null)[] = []) {
  const target = new EventTarget();
  const frames = new Map<number, () => void>();
  let nextFrame = 1;
  const storage = new MemoryStorage();
  const env: InputEnvironment = {
    addEventListener: (t, l) => target.addEventListener(t, l),
    removeEventListener: (t, l) => target.removeEventListener(t, l),
    requestAnimationFrame: (cb) => (frames.set(nextFrame, cb), nextFrame++),
    cancelAnimationFrame: (id) => frames.delete(id),
    getGamepads: () => pads,
    storage: storage as unknown as Storage,
  };
  const key = (type: "keydown" | "keyup", code: string, extra: Partial<KeyboardEvent> = {}) => {
    const e = Object.assign(new Event(type, { cancelable: true }), { code, metaKey: false, ctrlKey: false, altKey: false, ...extra });
    target.dispatchEvent(e);
    return e;
  };
  const tick = () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const cb of pending) cb();
  };
  return { env, storage, key, tick, fire: (type: string) => target.dispatchEvent(new Event(type)), frames };
}

function setup(pads?: (PadLike | null)[]) {
  const fake = fakeEnv(pads);
  const changes: number[] = [];
  const input = new JoypadInput({ env: fake.env, onChange: (mask) => changes.push(mask) });
  return { ...fake, input, changes };
}

const pad = (pressed: number[] = [], axes: number[] = [0, 0]): PadLike => ({
  connected: true,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
  axes,
});

describe("key bindings", () => {
  it("maps the defaults to Game Boy buttons", () => {
    const masks = keyMasks(DEFAULT_KEY_BINDINGS);
    expect(masks.get("ArrowUp")).toBe(Button.Up);
    expect(masks.get("KeyZ")).toBe(Button.A);
    expect(masks.get("KeyX")).toBe(Button.B);
    expect(masks.get("Enter")).toBe(Button.Start);
    expect(masks.get("Backspace")).toBe(Button.Select);
  });

  it("rebinding replaces the button's keys and takes the key from any other button", () => {
    const next = bindKey(DEFAULT_KEY_BINDINGS, "A", "KeyX");
    expect(next.A).toEqual(["KeyX"]);
    expect(next.B).toEqual([]);
    expect(keyMasks(next).get("KeyX")).toBe(Button.A);
    expect(keyMasks(next).has("KeyZ")).toBe(false);
    expect(DEFAULT_KEY_BINDINGS.A).toEqual(["KeyZ"]);
  });

  it("round-trips through storage", () => {
    const storage = new MemoryStorage();
    const custom = bindKey(bindKey(DEFAULT_KEY_BINDINGS, "Up", "KeyW"), "Start", "Space");
    saveKeyBindings(storage, custom);
    expect(loadKeyBindings(storage)).toEqual(custom);
  });

  it("falls back to defaults for missing, malformed or duplicate entries", () => {
    const storage = new MemoryStorage();
    expect(loadKeyBindings(storage)).toBe(DEFAULT_KEY_BINDINGS);
    expect(loadKeyBindings(undefined)).toBe(DEFAULT_KEY_BINDINGS);
    storage.setItem("pokehd.input.keys.v1", "{not json");
    expect(loadKeyBindings(storage)).toBe(DEFAULT_KEY_BINDINGS);
    storage.setItem("pokehd.input.keys.v1", JSON.stringify({ Up: ["KeyW", 3, "<x>"], A: "KeyZ", B: ["KeyW"] }));
    const loaded = loadKeyBindings(storage);
    expect(loaded.Up).toEqual(["KeyW"]);
    expect(loaded.A).toEqual(["KeyZ"]); // not an array: default
    expect(loaded.B).toEqual([]); // KeyW already belongs to Up
    expect(loaded.Down).toEqual(["ArrowDown"]);
  });

  it("survives storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    };
    expect(loadKeyBindings(broken)).toBe(DEFAULT_KEY_BINDINGS);
    expect(() => saveKeyBindings(broken, DEFAULT_KEY_BINDINGS)).not.toThrow();
  });

  it("labels keys briefly", () => {
    expect(keyLabel("KeyZ")).toBe("Z");
    expect(keyLabel("ArrowLeft")).toBe("←");
    expect(keyLabel("Digit4")).toBe("4");
    expect(keyLabel("ShiftRight")).toBe("Shift (Right)");
    expect(keyLabel("Enter")).toBe("Enter");
  });
});

describe("directions", () => {
  it("lets the latest press win between opposites, like a rocking D-pad", () => {
    expect(pressInto(Button.Left, Button.Right)).toBe(Button.Right);
    expect(pressInto(Button.Up | Button.A, Button.Down)).toBe(Button.Down | Button.A);
    expect(pressInto(Button.Up, Button.Left)).toBe(Button.Up | Button.Left);
    expect(dropOpposites(Button.Up | Button.Down | Button.A)).toBe(Button.A);
  });

  it("splits a vector into 60° cardinal and 30° diagonal sectors", () => {
    expect(directionMask(0.1, 0.1, 0.25)).toBe(0);
    expect(directionMask(1, 0, 0.25)).toBe(Button.Right);
    expect(directionMask(0, -1, 0.25)).toBe(Button.Up);
    expect(directionMask(-1, 0, 0.25)).toBe(Button.Left);
    expect(directionMask(0, 1, 0.25)).toBe(Button.Down);
    const at = (deg: number) => directionMask(Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180), 0.25);
    expect(at(25)).toBe(Button.Right); // 25° below the horizontal still walks straight
    expect(at(45)).toBe(Button.Right | Button.Down);
    expect(at(-40)).toBe(Button.Right | Button.Up);
    expect(at(65)).toBe(Button.Down);
    expect(at(200)).toBe(Button.Left);
  });
});

describe("gamepad", () => {
  it("reads the standard mapping by position: right face is A, bottom face is B", () => {
    expect(gamepadMask(pad([1]))).toBe(Button.A);
    expect(gamepadMask(pad([0]))).toBe(Button.B);
    expect(gamepadMask(pad([9, 8]))).toBe(Button.Start | Button.Select);
    expect(gamepadMask(pad([12, 15]))).toBe(Button.Up | Button.Right);
    expect(gamepadMask(pad([13, 14]))).toBe(Button.Down | Button.Left);
    expect(gamepadMask(pad([2, 3, 4, 5, 6, 7, 10, 11, 16]))).toBe(0);
  });

  it("reads the left stick past half travel", () => {
    expect(gamepadMask(pad([], [0.3, -0.3]))).toBe(0);
    expect(gamepadMask(pad([], [0, -0.9]))).toBe(Button.Up);
    expect(gamepadMask(pad([], [0.7, 0.7]))).toBe(Button.Right | Button.Down);
    expect(gamepadMask({ ...pad([1]), connected: false })).toBe(0);
  });
});

describe("JoypadInput", () => {
  it("reports a held key once, however often it repeats, and its release once", () => {
    const { key, changes, input } = setup();
    const first = key("keydown", "ArrowUp");
    key("keydown", "ArrowUp", { repeat: true });
    key("keydown", "ArrowUp", { repeat: true });
    expect(first.defaultPrevented).toBe(true);
    expect(input.mask).toBe(Button.Up);
    key("keyup", "ArrowUp");
    expect(changes).toEqual([Button.Up, 0]);
  });

  it("combines keys, and the newest opposite direction wins until released", () => {
    const { key, changes } = setup();
    key("keydown", "ArrowLeft");
    key("keydown", "KeyZ");
    key("keydown", "ArrowRight");
    key("keyup", "ArrowRight");
    key("keyup", "ArrowLeft");
    key("keyup", "KeyZ");
    expect(changes).toEqual([
      Button.Left,
      Button.Left | Button.A,
      Button.Right | Button.A,
      Button.Left | Button.A,
      Button.A,
      0,
    ]);
  });

  it("ignores unbound keys and shortcuts, and lets them through to the browser", () => {
    const { key, changes } = setup();
    expect(key("keydown", "KeyQ").defaultPrevented).toBe(false);
    expect(key("keydown", "KeyZ", { metaKey: true }).defaultPrevented).toBe(false);
    expect(changes).toEqual([]);
  });

  it("releases everything on blur and when ⌘ lifts", () => {
    const { key, fire, changes } = setup();
    key("keydown", "ArrowDown");
    fire("blur");
    key("keydown", "KeyX");
    key("keyup", "MetaLeft");
    expect(changes).toEqual([Button.Down, 0, Button.B, 0]);
  });

  it("rebinds keys, saves them, and a new instance loads them", () => {
    const { key, input, env, storage } = setup();
    input.bindKey("A", "Space");
    key("keydown", "Space");
    expect(input.mask).toBe(Button.A);
    key("keyup", "Space");
    key("keydown", "KeyZ");
    expect(input.mask).toBe(0);
    expect(storage.items.size).toBe(1);
    const again = new JoypadInput({ env, onChange: () => {} });
    expect(again.keyBindings.A).toEqual(["Space"]);
    again.resetKeyBindings();
    expect(loadKeyBindings(env.storage)).toEqual(DEFAULT_KEY_BINDINGS);
  });

  it("releases a held key whose binding goes away", () => {
    const { key, input } = setup();
    key("keydown", "KeyZ");
    expect(input.mask).toBe(Button.A);
    input.bindKey("A", "KeyA");
    expect(input.mask).toBe(0);
  });

  it("captures the next key for rebinding without the game seeing it", async () => {
    const { key, input, changes } = setup();
    const captured = input.captureNextKey();
    key("keydown", "ArrowUp");
    expect(await captured).toBe("ArrowUp");
    expect(changes).toEqual([]);
    const cancelled = input.captureNextKey();
    key("keydown", "Escape");
    expect(await cancelled).toBeNull();
    const dropped = input.captureNextKey();
    input.cancelCapture();
    expect(await dropped).toBeNull();
    key("keydown", "ArrowUp");
    expect(changes).toEqual([Button.Up]);
  });

  it("polls gamepads each frame once one connects, reporting only changes", () => {
    const pads: (PadLike | null)[] = [];
    const { fire, tick, changes, frames } = setup(pads);
    expect(frames.size).toBe(0);
    pads.push(pad([12]));
    fire("gamepadconnected");
    tick();
    tick();
    pads[0] = pad([12, 1]);
    tick();
    pads[0] = null;
    tick();
    expect(changes).toEqual([Button.Up, Button.Up | Button.A, 0]);
    expect(frames.size).toBe(0); // no pads left: polling stops
  });

  it("ORs touch with the other sources and cancels opposites across them", () => {
    const { key, input, changes } = setup();
    input.setTouchMask(Button.Start);
    key("keydown", "ArrowLeft");
    input.setTouchMask(Button.Start | Button.Right);
    input.setTouchMask(0);
    expect(changes).toEqual([Button.Start, Button.Start | Button.Left, Button.Start, Button.Left]);
  });

  it("stops listening when disposed", () => {
    const { key, input, changes } = setup();
    input.dispose();
    key("keydown", "ArrowUp");
    expect(changes).toEqual([]);
  });
});
