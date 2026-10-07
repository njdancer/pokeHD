// A scripted play-through of the real game page: a new game from Red's room, through Oak's lab
// (starter and rival battle), up Route 1 to Viridian City, reading the decoded state the page
// exposes with ?stats. It records the frame rate per map and screenshots each map.
// Needs the ROM at rom/pokeblue.gb (the dev server serves it). Takes several minutes of real
// time, so it only runs when asked: POKEHD_PLAY=1 pnpm test:e2e play.
// POKEHD_PLAY_HEADED=1 shows the browser (use it on a Mac for a WebGPU frame rate).
// POKEHD_PLAY_VIDEO=1 records it. The report (log, frame rate per map, errors), screenshots
// and video land in test-results/.
import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  BALL_SLOTS, hasRom, loadWorld, MAP_NAMES, OAKS_LAB, PALLET_TOWN, Player, PLAY_USE, REDS_HOUSE_1F, REDS_HOUSE_2F,
  ROUTE_1, sleep, VIRIDIAN_CITY, type State,
} from "./game.ts";

test.skip(!process.env["POKEHD_PLAY"], "Long play-through: set POKEHD_PLAY=1 to run it");
test.skip(!hasRom, "Needs rom/pokeblue.gb");
test.use(PLAY_USE);

test("a new game from Red's room to Viridian City", async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const world = loadWorld();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  // A fresh browser profile: no save, so Continue isn't offered and the intro starts a new game.
  await page.goto("/?stats");
  const p = new Player(page, world);
  await expect(page.getByTestId("stats")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("gb-screen")).toHaveAttribute("data-layout", "full");

  await p.playIntro();
  // On the overworld the HD view takes over (unless there's no renderer at all).
  const hd = !(await page.getByTestId("stats").textContent())?.startsWith("no renderer");
  if (hd) await expect(page.getByTestId("gb-screen")).not.toHaveAttribute("data-layout", "full");

  // Red's room, downstairs, out of the front door.
  await p.walkTo(REDS_HOUSE_2F, [5, 1]);
  await p.leave("ArrowRight", REDS_HOUSE_1F);
  await p.walkTo(REDS_HOUSE_1F, [3, 7]);
  await p.leave("ArrowDown", PALLET_TOWN);

  // North toward the grass: Oak stops the player and leads them to his lab.
  await p.walkTo(PALLET_TOWN, [10, 1]);
  for (let s = await p.state(); s.mapId !== OAKS_LAB; s = await p.state()) {
    if (s.mode === "overworld" && s.mapId === PALLET_TOWN && s.player.y > 0) await p.step("ArrowUp");
    else await p.tap("x");
    await sleep(80);
  }
  let s = await p.clearDialogs("x", 2500);
  await p.observe(s);

  // Pick the middle ball (Squirtle in Blue), say yes, decline a nickname.
  const hasStarter = (st: State) => st.npcs.some((n) => BALL_SLOTS.includes(n.slot!) && n.visible === false);
  while (!hasStarter(s)) {
    await p.walkTo(OAKS_LAB, [7, 4]);
    await p.step("ArrowUp"); // faces the table
    await p.tap("z");
    for (let i = 0; i < 400; i++) {
      s = await p.state();
      if (hasStarter(s) && s.mode === "overworld") break;
      // A for "yes", Start to finish a naming screen if one opens.
      await p.tap(i % 12 === 11 ? "Enter" : i < 30 ? "z" : "x");
      await sleep(100);
    }
    s = await p.clearDialogs("x", 2500);
  }

  // Out of the lab (the rival battles on the way), north through Pallet Town and Route 1.
  await p.walkTo(OAKS_LAB, [5, 11]).catch(async (e: unknown) => {
    // The rival battle can leave the player anywhere along the way; carry on from there.
    if ((await p.state()).mapId !== OAKS_LAB) throw e;
    return p.walkTo(OAKS_LAB, [5, 11]);
  });
  await p.leave("ArrowDown", PALLET_TOWN);
  await p.walkTo(PALLET_TOWN, [10, 1]);
  await p.leave("ArrowUp", ROUTE_1);
  await p.walkTo(ROUTE_1, [10, 0]);
  await p.leave("ArrowUp", VIRIDIAN_CITY);
  s = await p.walkTo(VIRIDIAN_CITY, [20, 28]);
  expect(s.mapId).toBe(VIRIDIAN_CITY);
  await page.screenshot({ path: test.info().outputPath("viridian.png") });

  // Frame rate per map, on the overworld.
  const byMap = new Map<number, typeof p.samples>();
  for (const sample of p.samples) byMap.set(sample.map, [...(byMap.get(sample.map) ?? []), sample]);
  const summary = [...byMap].map(([map, xs]) => ({
    map: MAP_NAMES[map] ?? map,
    samples: xs.length,
    meanFps: +(xs.reduce((a, x) => a + x.fps, 0) / xs.length).toFixed(1),
    minFps: Math.min(...xs.map((x) => x.fps)),
    worstFrameMs: Math.max(...xs.map((x) => x.worstMs)),
    meanCpuMs: +(xs.reduce((a, x) => a + x.cpuMs, 0) / xs.length).toFixed(2),
  }));
  // Display frames over 50 ms, with what the page was doing at the time.
  const slow = await page.evaluate(() => (window as { __pokehd?: { slow: unknown[] } }).__pokehd?.slow ?? []);
  const report = { log: p.log, summary, errors, slow };
  writeFileSync(test.info().outputPath("play-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  // Expected noise: no renderer in a GPU-less browser, and /api/me's 401 when not signed in.
  expect(errors.filter((e) => !/renderer failed|status of 401/.test(e))).toEqual([]);
});
