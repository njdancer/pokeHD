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

test("touch: D-pad rolls between directions, and fingers combine", async ({ page }) => {
  await page.goto("/dev/emu");
  await expect(page.getByTestId("touch-pad")).toBeVisible();
  const send = await touches(page);
  const dpad = await centre(page, "D-pad");
  const a = await centre(page, "A");
  const width = page.viewportSize()!.width;
  for (const label of ["D-pad", "B", "A", "Select", "Start"]) {
    const c = await centre(page, label);
    expect(c.x - c.w / 2, `${label} fits on screen`).toBeGreaterThanOrEqual(0);
    expect(c.x + c.w / 2, `${label} fits on screen`).toBeLessThanOrEqual(width);
  }

  await send("touchStart", [{ x: dpad.x, y: dpad.y - dpad.h * 0.4, id: 1 }]);
  await expect(held(page)).toHaveText("Up");
  await send("touchMove", [{ x: dpad.x + dpad.w * 0.4, y: dpad.y, id: 1 }]);
  await expect(held(page)).toHaveText("Right");
  await send("touchStart", [
    { x: dpad.x + dpad.w * 0.4, y: dpad.y, id: 1 },
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
