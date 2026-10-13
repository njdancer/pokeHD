// QA bug 34: the tap on A that opens a game's sheet mustn't land on the sheet as it lifts.
import { describe, expect, it } from "vitest";
import { freshTapGuard } from "./fresh-tap.ts";

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
