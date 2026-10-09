// Resume points on the real game page: a new game walked a few steps, the tab hidden (which
// takes a resume point) and reloaded, comes back at the same spot without passing the title
// screen; "Go back to my last save instead" goes back to the title screen.
// Needs the ROM at rom/pokeblue.gb. POKEHD_PLAY=1 pnpm test:e2e resume
import { expect, test } from "@playwright/test";
import { hasRom, loadWorld, Player, PLAY_USE, REDS_HOUSE_1F, REDS_HOUSE_2F, sleep, type Hooked } from "./game.ts";

test.skip(!process.env["POKEHD_PLAY"], "Play-through: set POKEHD_PLAY=1 to run it");
test.skip(!hasRom, "Needs rom/pokeblue.gb");
test.use(PLAY_USE);

test("a hidden tab resumes where it was after a reload", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const world = loadWorld();
  await page.goto("/?stats&classic");
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
  const fromSave = page.getByRole("button", { name: "Go back to my last save instead" });
  await expect(fromSave).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => (window as Hooked).__pokehd?.inWorld ?? false), { timeout: 30_000 }).toBe(true);
  const after = await p.state();
  expect([after.mapId, after.player.x, after.player.y]).toEqual([before.mapId, before.player.x, before.player.y]);

  await fromSave.click();
  await sleep(3000);
  expect(await page.evaluate(() => (window as Hooked).__pokehd?.inWorld ?? false)).toBe(false);
});

test("a save after the last resume point still resumes", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const world = loadWorld();
  await page.goto("/?stats&classic");
  const p = new Player(page, world);
  await expect(page.getByTestId("stats")).toBeVisible({ timeout: 60_000 });
  await p.playIntro();
  // The game autosaves once it reaches the world; the map change downstairs prompts another,
  // which runs a minute after the first.
  await p.walkTo(REDS_HOUSE_2F, [7, 1]);
  await p.leave("ArrowRight", REDS_HOUSE_1F);
  await p.walkTo(REDS_HOUSE_1F, [3, 7]);
  await sleep(70_000);
  const before = await p.state();
  // No hidden tab this time: the browser may not get to take a point on its way out.
  await page.reload();

  await expect(page.getByRole("button", { name: "Go back to my last save instead" })).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => (window as Hooked).__pokehd?.inWorld ?? false), { timeout: 30_000 }).toBe(true);
  const after = await p.state();
  expect(after.mapId).toBe(before.mapId);
});
