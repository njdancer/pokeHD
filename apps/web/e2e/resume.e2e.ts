// Resume points on the real game page: a new game walked a few steps, the tab hidden (which
// takes a resume point) and reloaded, comes back at the same spot without passing the title
// screen; "Load the save file instead" goes back to the title screen.
// Needs the ROM at rom/pokeblue.gb. POKEHD_PLAY=1 pnpm test:e2e resume
import { expect, test } from "@playwright/test";
import { hasRom, loadWorld, Player, PLAY_USE, REDS_HOUSE_2F, sleep, type Hooked } from "./game.ts";

test.skip(!process.env["POKEHD_PLAY"], "Play-through: set POKEHD_PLAY=1 to run it");
test.skip(!hasRom, "Needs rom/pokeblue.gb");
test.use(PLAY_USE);

test("a hidden tab resumes where it was after a reload", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const world = loadWorld();
  await page.goto("/?stats");
  const p = new Player(page, world);
  await expect(page.getByTestId("stats")).toBeVisible({ timeout: 60_000 });
  await p.playIntro();
  await p.walkTo(REDS_HOUSE_2F, [5, 4]);
  await sleep(500);
  const before = await p.state();

  // As when the player switches app or tab.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await sleep(2000);
  await page.reload();

  // Offered for a while after resuming.
  const fromSave = page.getByRole("button", { name: "Load the save file instead" });
  await expect(fromSave).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => (window as Hooked).__pokehd?.inWorld ?? false), { timeout: 30_000 }).toBe(true);
  const after = await p.state();
  expect([after.mapId, after.player.x, after.player.y]).toEqual([before.mapId, before.player.x, before.player.y]);

  await fromSave.click();
  await sleep(3000);
  expect(await page.evaluate(() => (window as Hooked).__pokehd?.inWorld ?? false)).toBe(false);
});
