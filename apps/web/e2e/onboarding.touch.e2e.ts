// Tap-first start on a phone: the start screen and Oak's name check stay on screen and tappable
// upright and on its side, Oak goes straight to the invited name, long sentences show at once,
// and everything else sits behind the one menu button. Saves screenshots in test-results/.
import { expect, test, type Locator, type Page } from "@playwright/test";

const inView = async (page: Page, target: Locator) => {
  const box = (await target.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height);
};

test("a new game on a phone, upright and on its side", async ({ page }) => {
  test.setTimeout(240_000);
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { player: { id: "p1", name: "Nick" }, email: "nick@example.com", admin: false, romAccess: true } }),
  );
  await page.route("**/api/room", (route) => route.abort());
  const prompt = page.getByTestId("name-prompt");
  const shots = "test-results/phone";
  let joined = false;
  const readOn = async (until: () => Promise<boolean>) => {
    for (let i = 0; i < 400 && !(await until()); i++) {
      // A sentence longer than the game's two lines shows in one box.
      if (!joined && (await page.locator(".hd-box.dialog .hd-line").count()) >= 3) {
        joined = true;
        await page.screenshot({ path: `${shots}-joined.png` });
      }
      const box = page.locator(".hd-box.tappable");
      if (await box.count()) await box.first().tap({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
  };

  await page.goto("/?stats&render=0");
  const start = page.getByTestId("start-new");
  await expect(start).toBeVisible({ timeout: 60_000 });
  await inView(page, start);
  await page.screenshot({ path: `${shots}-start.png` });
  await start.tap();

  await readOn(() => prompt.isVisible());
  expect(joined).toBe(true);
  await expect(prompt).toContainText("It says here your name is Nick");
  // Oak doesn't ask first: the game's "what is your name?" never shows.
  await expect(page.getByText(/what is your name/i)).toHaveCount(0);
  await inView(page, page.getByRole("button", { name: "That's me!" }));
  await page.screenshot({ path: `${shots}-name.png` });

  const { width, height } = page.viewportSize()!;
  await page.setViewportSize({ width: height, height: width });
  await page.waitForTimeout(500);
  await inView(page, page.getByRole("button", { name: "That's me!" }));
  await inView(page, page.getByRole("button", { name: "Change it" }));
  await page.screenshot({ path: `${shots}-name-side.png` });
  await page.setViewportSize({ width, height });

  await page.getByRole("button", { name: "That's me!" }).tap();
  await readOn(() => prompt.isVisible());
  await page.getByRole("button", { name: "ASH" }).tap();
  await page.getByRole("button", { name: "OK" }).tap();

  await page.getByRole("button", { name: "Menu" }).tap();
  await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
  await page.screenshot({ path: `${shots}-menu.png` });
});
