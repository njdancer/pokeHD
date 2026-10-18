import { expect, test, type Page } from "@playwright/test";

const held = (page: Page) => page.getByTestId("held");

/** Sends raw touch events, so fingers can be held down (Playwright only offers taps). */
async function touches(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  return (type: "touchStart" | "touchMove" | "touchEnd", points: { x: number; y: number; id: number }[]) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
}

async function centre(page: Page, label: string) {
  const box = (await page.getByLabel(label, { exact: true }).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, w: box.width, h: box.height };
}

test("touch: the stick appears under the thumb, turns cleanly, holds diagonals, and fingers combine", async ({ page }) => {
  await page.goto("/dev/emu");
  await expect(page.getByTestId("touch-pad")).toBeVisible();
  const send = await touches(page);
  const zone = await centre(page, "Joystick");
  const a = await centre(page, "A");
  const width = page.viewportSize()!.width;
  for (const label of ["Joystick", "B", "A", "Select", "Start"]) {
    const c = await centre(page, label);
    expect(c.x - c.w / 2, `${label} fits on screen`).toBeGreaterThanOrEqual(0);
    expect(c.x + c.w / 2, `${label} fits on screen`).toBeLessThanOrEqual(width);
  }

  // The thumb lands anywhere in the zone; the stick centres there and presses nothing yet.
  const x = zone.x - zone.w * 0.2;
  const y = zone.y;
  const r = 50;
  await send("touchStart", [{ x, y, id: 1 }]);
  await expect(held(page)).toHaveText("none");
  await send("touchMove", [{ x, y: y - r, id: 1 }]);
  await expect(held(page)).toHaveText("Up");
  // A little off the axis keeps walking up; near the diagonal it holds both (a staircase); a clear lean turns.
  await send("touchMove", [{ x: x + r * 0.3, y: y - r, id: 1 }]);
  await expect(held(page)).toHaveText("Up");
  await send("touchMove", [{ x: x + r * 0.75, y: y - r * 0.7, id: 1 }]);
  await expect(held(page)).toHaveText("Up Right");
  await send("touchMove", [{ x: x + r, y: y - r * 0.2, id: 1 }]);
  await expect(held(page)).toHaveText("Right");
  // Sliding far past the edge drags the stick along, so coming back a little turns straight around.
  await send("touchMove", [{ x: x + r * 4, y, id: 1 }]);
  await send("touchMove", [{ x: x + r * 2, y, id: 1 }]);
  await expect(held(page)).toHaveText("Left");
  await send("touchMove", [{ x: x + r * 4, y, id: 1 }]);
  await expect(held(page)).toHaveText("Right");
  await send("touchStart", [
    { x: x + r * 4, y, id: 1 },
    { x: a.x, y: a.y, id: 2 },
  ]);
  await expect(held(page)).toHaveText("Right A");
  await send("touchEnd", [{ x: a.x, y: a.y, id: 2 }]);
  await expect(held(page)).toHaveText("Right");
  await send("touchEnd", []);
  await expect(held(page)).toHaveText("none");

  const start = await centre(page, "Start");
  await send("touchStart", [{ x: start.x, y: start.y, id: 3 }]);
  await expect(held(page)).toHaveText("Start");
  await send("touchEnd", []);
  await expect(held(page)).toHaveText("none");
});
