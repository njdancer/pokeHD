// Whole messages from the script: Oak's speech shows a message at a time in the HD box,
// read on by tapping it, and the game keeps up until Oak checks the name. Saves screenshots in
// test-results/.
import { expect, test } from "@playwright/test";

test("Oak's speech, a whole message at a time", async ({ page }) => {
  test.setTimeout(240_000);
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { player: { id: "p1", name: "Nick" }, email: "nick@example.com", admin: false, romAccess: true } }),
  );
  await page.route("**/api/room", (route) => route.abort());
  await page.goto("/?stats&render=0");
  const start = page.getByTestId("start-new");
  await expect(start).toBeVisible({ timeout: 60_000 });
  await start.tap();

  const box = page.locator(".hd-box.dialog");
  const prompt = page.getByTestId("name-prompt");
  const seen: string[] = [];
  for (let i = 0; i < 200 && !(await prompt.isVisible()); i++) {
    const text = (await box.count()) ? (await box.locator(".hd-line").allInnerTexts()).join(" / ") : "";
    // A box whose lines haven't drawn yet isn't tapped: it would be read on unseen.
    if (text) {
      if (seen.at(-1) !== text) {
        seen.push(text);
        if (seen.length <= 3) await page.screenshot({ path: `test-results/whole-${seen.length}.png` });
      }
      await box.first().tap({ timeout: 2000 }).catch(() => {});
    }
    await page.waitForTimeout(250);
  }
  console.log(seen.join("\n"));
  await expect(prompt).toContainText("It says here your name is Nick");
  // The welcome shows whole sentences: more than the game's two lines in one box.
  expect(seen[0]).toMatch(/^Hello there!/);
  expect(seen.some((t) => t.split(" / ").length > 2)).toBe(true);
});
