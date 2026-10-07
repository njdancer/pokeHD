import { expect, test, type Page } from "@playwright/test";

const held = (page: Page) => page.getByTestId("held");

test.beforeEach(async ({ page }) => {
  // A stand-in for the Gamepad API: the page's `navigator.getGamepads()` returns `window.__pads`.
  await page.addInitScript(() => {
    const w = window as unknown as { __pads: unknown[] };
    w.__pads = [];
    navigator.getGamepads = () => w.__pads as Gamepad[];
  });
  await page.goto("/dev/emu");
  await expect(page.getByRole("region", { name: "Keyboard controls" })).toBeVisible();
});

test("keyboard: held keys reach the joypad, repeats and all", async ({ page }) => {
  await page.keyboard.down("ArrowUp");
  await page.keyboard.down("z");
  await expect(held(page)).toHaveText("Up A");
  // Auto-repeat sends more keydowns; the mask must not flicker.
  await page.keyboard.down("ArrowUp");
  await expect(held(page)).toHaveText("Up A");
  await page.keyboard.down("ArrowDown");
  await expect(held(page)).toHaveText("Down A");
  await page.keyboard.up("ArrowDown");
  await expect(held(page)).toHaveText("Up A");
  await page.keyboard.up("ArrowUp");
  await page.keyboard.up("z");
  await expect(held(page)).toHaveText("none");
  await page.keyboard.down("Enter");
  await expect(held(page)).toHaveText("Start");
  await page.keyboard.up("Enter");
});

test("keyboard: rebinding applies at once and survives a reload", async ({ page }) => {
  await page.locator('button[data-button="A"]').click();
  await expect(page.locator('button[data-button="A"]')).toHaveText("Press a key…");
  await page.keyboard.press("Space");
  await expect(page.locator('button[data-button="A"]')).toHaveText("Space");
  await page.keyboard.down("Space");
  await expect(held(page)).toHaveText("A");
  await page.keyboard.up("Space");
  await page.keyboard.down("z");
  await expect(held(page)).toHaveText("none");
  await page.keyboard.up("z");

  await page.reload();
  await expect(page.locator('button[data-button="A"]')).toHaveText("Space");
  await page.keyboard.down("Space");
  await expect(held(page)).toHaveText("A");
  await page.keyboard.up("Space");

  await page.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(page.locator('button[data-button="A"]')).toHaveText("Z");
});

test("gamepad: standard mapping is polled every frame", async ({ page }) => {
  const setPad = (pressed: number[], axes = [0, 0]) =>
    page.evaluate(
      ([pressed, axes]) => {
        const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), touched: false, value: 0 }));
        (window as unknown as { __pads: unknown[] }).__pads = [
          { connected: true, mapping: "standard", index: 0, id: "fake", buttons, axes, timestamp: performance.now() },
        ];
        window.dispatchEvent(new Event("gamepadconnected"));
      },
      [pressed, axes] as const,
    );
  await setPad([12, 1]);
  await expect(held(page)).toHaveText("Up A");
  await setPad([], [-1, 0]);
  await expect(held(page)).toHaveText("Left");
  await setPad([9]);
  await expect(held(page)).toHaveText("Start");
  await setPad([]);
  await expect(held(page)).toHaveText("none");
});

test("touch pad is hidden without a touch screen", async ({ page }) => {
  await expect(page.getByTestId("touch-pad")).toHaveCount(0);
});
