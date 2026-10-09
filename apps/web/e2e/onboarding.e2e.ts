// Tap-first start: the page's start screen, Oak's introduction read by tapping the message box,
// names typed on the keyboard (the signed-in player's name checked, then changed, which renames
// them), and a start menu choice tapped in the world. Runs without the 3D renderer (?render=0).
import { expect, test } from "@playwright/test";

test("a new game from the start screen to the bedroom, by taps alone", async ({ page }) => {
  test.setTimeout(240_000);
  let name = "Nick";
  const renames: string[] = [];
  await page.route("**/api/me", async (route) => {
    if (route.request().method() === "PATCH") renames.push((name = JSON.parse(route.request().postData()!).name));
    await route.fulfill({ json: { player: { id: "p1", name }, email: "nick@example.com", admin: false, romAccess: true } });
  });
  await page.route("**/api/room", (route) => route.abort());
  const readOn = async (until: () => Promise<boolean>) => {
    for (let i = 0; i < 400 && !(await until()); i++) {
      const box = page.locator(".hd-box.tappable");
      if (await box.count()) await box.first().click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
  };
  const prompt = page.getByTestId("name-prompt");

  await page.goto("/?stats&render=0");
  await page.getByTestId("start-new").click();
  await readOn(() => prompt.isVisible());
  await expect(prompt).toContainText("your name is Nick");
  await page.getByRole("button", { name: "Change it" }).click();
  await page.getByTestId("name-input").fill("Nicholas");
  await expect(prompt).toContainText("7 letters at most");
  await page.getByTestId("name-input").fill("Nicky");
  await page.getByRole("button", { name: "OK" }).click();
  await expect.poll(() => renames).toEqual(["Nicky"]);

  await readOn(() => prompt.isVisible());
  await page.getByRole("button", { name: "ASH" }).click();
  await page.getByRole("button", { name: "OK" }).click();
  await readOn(() => page.evaluate(() => !!(window as { __pokehd?: { inWorld: boolean } }).__pokehd?.inWorld));

  // START opens the menu once the room has faded in.
  const choice = page.locator(".hd-choice", { hasText: "Nicky" });
  for (let i = 0; i < 10 && !(await choice.isVisible()); i++) {
    await page.waitForTimeout(1000);
    await page.keyboard.down("Enter");
    await page.waitForTimeout(150);
    await page.keyboard.up("Enter");
    await page.waitForTimeout(800);
  }
  await page.locator(".hd-choice", { hasText: "Nicky" }).click();
  // The trainer card isn't text the HD layer draws: the Game Boy screen comes up for it.
  await expect(page.getByTestId("hd-text")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId("gb-screen")).toHaveAttribute("data-layout", "dialog");
});
