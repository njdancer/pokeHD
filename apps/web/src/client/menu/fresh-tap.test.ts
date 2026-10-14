// QA bug 34: the tap on A that opens a game's sheet mustn't land on the sheet as it lifts.
import { describe, expect, it } from "vitest";
import { freshTapGuard, quietTapGuard } from "./fresh-tap.ts";

const click = (detail = 1) => {
  const e = { detail, stopped: false, prevented: false, preventDefault: () => void (e.prevented = true), stopPropagation: () => void (e.stopped = true) };
  return e;
};

describe("freshTapGuard", () => {
  it("drops a click whose press began before the sheet was there", () => {
    const guard = freshTapGuard();
    const e = click();
    guard.onClickCapture(e);
    expect(e).toMatchObject({ stopped: true, prevented: true });
  });

  it("lets a tap that started on the sheet through, and every one after", () => {
    const guard = freshTapGuard();
    guard.onPointerDownCapture();
    const first = click();
    guard.onClickCapture(first);
    const second = click();
    guard.onClickCapture(second);
    expect([first.stopped, second.stopped]).toEqual([false, false]);
  });

  it("lets a keyboard click through (no press)", () => {
    const e = click(0);
    freshTapGuard().onClickCapture(e);
    expect(e.stopped).toBe(false);
  });

  it("starts each sheet afresh", () => {
    freshTapGuard().onPointerDownCapture();
    const e = click();
    freshTapGuard().onClickCapture(e);
    expect(e.stopped).toBe(true);
  });
});

// QA bug 73: the Pokédex the game opens after a catch flies in under a player tapping through
// messages; a tap meant for the next message switched it to the Me tab.
describe("quietTapGuard", () => {
  const clock = () => {
    const c = { t: 1000, now: () => c.t };
    return c;
  };

  it("drops a tap pressed while it's still flying in, and one pressed before it opened", () => {
    const c = clock();
    const guard = quietTapGuard(1240, c.now);
    const before = click();
    guard.onClickCapture(before);
    c.t += 600;
    guard.onPointerDownCapture();
    const flying = click();
    guard.onClickCapture(flying);
    expect([before.stopped, flying.stopped]).toEqual([true, true]);
  });

  it("takes taps pressed once it has settled", () => {
    const c = clock();
    const guard = quietTapGuard(1240, c.now);
    c.t += 600;
    guard.onPointerDownCapture();
    c.t += 700;
    // Released after the quiet time, but pressed during it: still dropped.
    const late = click();
    guard.onClickCapture(late);
    guard.onPointerDownCapture();
    const settled = click();
    guard.onClickCapture(settled);
    expect([late.stopped, settled.stopped]).toEqual([true, false]);
  });

  it("lets a keyboard click through at once", () => {
    const e = click(0);
    quietTapGuard(1240, clock().now).onClickCapture(e);
    expect(e.stopped).toBe(false);
  });
});
