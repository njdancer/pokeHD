import { describe, expect, it } from "vitest";
import { describeMessages, readiness, type LoggedLine } from "./idle.ts";
import type { Panel, ScreenRead, StateLite } from "./screen-read.ts";

const state = (s: Partial<StateLite> = {}, player: Partial<StateLite["player"]> = {}): StateLite => ({
  mode: "overworld", mapId: 0, fade: 0, npcs: [], ...s, player: { x: 5, y: 6, facing: "down", step: null, ...player },
});
const screen = (r: Partial<ScreenRead> = {}): ScreenRead => ({
  hooked: true, state: state(), inWorld: true, frames: 100, layout: "map", loading: false, held: false, visible: true, fps: 60, slow: [],
  panels: [], buttons: [], joystick: null, printing: false, input: { ready: true, on: "free" }, now: 0, ...r,
});
const message = (text: string, waiting: boolean): Panel => ({ kind: "message", text, waiting });

describe("readiness", () => {
  it("takes the page's word", () => {
    expect(readiness(screen())).toEqual({ ready: true, on: "free" });
    expect(readiness(screen({ input: { ready: true, on: "message" }, panels: [message("Hello!", true)] }))).toEqual({ ready: true, on: "message" });
    expect(readiness(screen({ input: { ready: false, why: "printing" } }))).toEqual({ ready: false, why: "a message still printing" });
    expect(readiness(screen({ input: { ready: false, why: "battle" } }))).toEqual({ ready: false, why: "the battle's animations" });
  });

  it("waits out loading, fades and steps whatever the page says", () => {
    expect(readiness(screen({ hooked: false })).ready).toBe(false);
    expect(readiness(screen({ loading: true })).ready).toBe(false);
    expect(readiness(screen({ state: state({ fade: 2 / 3 }), input: { ready: false, why: "busy" } }))).toEqual({ ready: false, why: "a screen fade" });
    expect(readiness(screen({ state: state({ fade: 2 / 3 }), input: null }))).toEqual({ ready: false, why: "a screen fade" });
    expect(readiness(screen({ state: state({}, { step: { dx: 1 } }) }))).toEqual({ ready: false, why: "a step under way" });
  });

  it("takes a dark cave's dim palette for the map's light, not a fade, once the game takes input", () => {
    expect(readiness(screen({ state: state({ fade: 2 / 3 }) }))).toEqual({ ready: true, on: "free" });
  });

  it("waits for the HD battle menu to be on screen before it's tapped", () => {
    const asking = screen({ state: state({ mode: "battle" }), input: { ready: true, on: "battle-menu" } });
    expect(readiness(asking)).toEqual({ ready: false, why: "the battle menu coming up" });
    expect(readiness({ ...asking, panels: [{ kind: "battle-menu", text: "TACKLE" }] })).toEqual({ ready: true, on: "battle-menu" });
  });

  it("lets the page's own screens take taps, and falls back to the ▼ without the page's signal", () => {
    expect(readiness(screen({ panels: [{ kind: "name", text: "Your name?" }], input: { ready: false, why: "busy" } })).ready).toBe(true);
    expect(readiness(screen({ input: null, printing: true })).ready).toBe(false);
    expect(readiness(screen({ input: null })).ready).toBe(true);
  });
});

describe("describeMessages", () => {
  const log = (...boxes: string[][]): LoggedLine[] => boxes.flatMap((lines, group) => lines.map((text, i) => ({ seq: group * 10 + i + 1, group, text })));

  it("lists every box since the last action, in order, less what's still on screen (QA bug 65)", () => {
    const lines = log(["Enemy BULBASAUR", "used GROWL!"], ["But, it failed!"], ["SQUIRTLE", "used TACKLE!"]);
    expect(describeMessages(lines, ["SQUIRTLE\nused TACKLE!"])).toBe('Since your last action the game showed, in order: "Enemy BULBASAUR used GROWL!" → "But, it failed!"');
    expect(describeMessages(lines, [])).toBe('Since your last action the game showed, in order: "Enemy BULBASAUR used GROWL!" → "But, it failed!" → "SQUIRTLE used TACKLE!"');
  });

  it("says nothing when the screen shows all of it", () => {
    expect(describeMessages(log(["Hello there!", "Welcome!"]), ["Hello there!\nWelcome! ▼"])).toBe("");
    expect(describeMessages([], [])).toBe("");
  });
});
