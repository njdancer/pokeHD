// Friend ghosts on the real game page (D21): two players start new games side by side, and while
// one walks around Red's room the other's HD view draws them as a ghost. Records the watching
// player's frame rate with the ghost in view; on a Mac (POKEHD_PLAY_HEADED=1) it should hold
// 60 fps or better. Needs the ROM and an admin token for the invites, as cloud-save.e2e.ts does.
// POKEHD_PLAY=1 POKEHD_ADMIN_TOKEN=… pnpm test:e2e ghosts
import { writeFileSync } from "node:fs";
import { expect, test, type Browser } from "@playwright/test";
import { addFriend, signInWith } from "./friends.ts";
import { hasRom, loadWorld, Player, PLAY_USE, REDS_HOUSE_2F, sleep, type Dir } from "./game.ts";

const ADMIN_TOKEN = process.env["POKEHD_ADMIN_TOKEN"];

test.skip(!process.env["POKEHD_PLAY"], "Long play-through: set POKEHD_PLAY=1 to run it");
test.skip(!hasRom, "Needs rom/pokeblue.gb");
test.skip(!ADMIN_TOKEN, "Needs POKEHD_ADMIN_TOKEN (and the dev server's ADMIN_TOKEN) to add players");
test.use(PLAY_USE);

/** A new player, signed in with their link, on the game page with stats. */
async function newPlayer(browser: Browser, baseURL: string | undefined, name: string) {
  const context = await browser.newContext({ ...PLAY_USE, baseURL });
  await signInWith(context.request, (await addFriend(context.request, name)).link);
  const page = await context.newPage();
  await page.goto("/?stats&classic");
  await expect(page.getByTestId("stats")).toBeVisible({ timeout: 60_000 });
  return { context, page };
}

test("a friend's ghost in the HD view", async ({ browser, baseURL }) => {
  test.setTimeout(15 * 60_000);
  const world = loadWorld();
  const tag = Date.now() % 100000;
  const watcher = await newPlayer(browser, baseURL, `w${tag}`);
  const walker = await newPlayer(browser, baseURL, `g${tag}`);
  const a = new Player(watcher.page, world);
  const b = new Player(walker.page, world);
  await Promise.all([a.playIntro(), b.playIntro()]);
  await expect(watcher.page.getByText(/[1-9]\d* friends? online/)).toBeVisible({ timeout: 30_000 });

  // The walker paces back and forth in front of the watcher, who stands still.
  await a.walkTo(REDS_HOUSE_2F, [3, 6]);
  await b.walkTo(REDS_HOUSE_2F, [2, 4]);
  const stats = watcher.page.getByTestId("stats");
  const samples: { fps: number; text: string }[] = [];
  const pace: Dir[] = ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowLeft", "ArrowLeft", "ArrowLeft"];
  for (let round = 0; round < 4; round++) {
    for (const dir of pace) await b.step(dir);
    samples.push({ fps: Number(await stats.getAttribute("data-fps")), text: (await stats.textContent()) ?? "" });
    await sleep(500);
  }
  await watcher.page.screenshot({ path: test.info().outputPath("watcher.png") });

  const fps = samples.map((s) => s.fps);
  const report = {
    renderer: samples[0]?.text.split(" · ")[0],
    meanFps: +(fps.reduce((x, y) => x + y, 0) / fps.length).toFixed(1),
    minFps: Math.min(...fps),
    samples,
  };
  writeFileSync(test.info().outputPath("ghosts-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  // Without a GPU the page shows the Game Boy screen alone, so there's no HD frame rate to hold.
  if (report.renderer !== "no renderer") expect(report.minFps).toBeGreaterThanOrEqual(60);

  await watcher.context.close();
  await walker.context.close();
});
