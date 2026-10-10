// One device per save (D41) on the real game page: a player plays on device A; device B, the same
// player, finds the save in use and takes it over. A stops where it was and keeps its progress,
// and B carries on from that very spot. Then B is frozen like a phone put in a pocket: A takes the
// save back once B's heartbeat has gone quiet, and B, woken, finds it has moved.
// Needs the ROM and an admin token (apps/web/.dev.vars ADMIN_TOKEN, the same in POKEHD_ADMIN_TOKEN).
// POKEHD_PLAY=1 POKEHD_ADMIN_TOKEN=… pnpm test:e2e save-lock
import { expect, test, type Page } from "@playwright/test";
import { addFriend, friendLink, signInWith } from "./friends.ts";
import { hasRom, loadWorld, Player, PLAY_USE, sleep, type Hooked } from "./game.ts";

const ADMIN_TOKEN = process.env["POKEHD_ADMIN_TOKEN"];

test.skip(!process.env["POKEHD_PLAY"], "Long play-through: set POKEHD_PLAY=1 to run it");
test.skip(!hasRom, "Needs rom/pokeblue.gb");
test.skip(!ADMIN_TOKEN, "Needs POKEHD_ADMIN_TOKEN (and the dev server's ADMIN_TOKEN) to add a player");
test.use(PLAY_USE);

const frames = (page: Page) => page.evaluate(() => (window as Hooked & { __pokehd?: { frames?: number } }).__pokehd?.frames ?? 0);
const spot = async (p: Player) => {
  const s = await p.state();
  return [s.mapId, s.player.x, s.player.y];
};

test("a save plays on one device at a time", async ({ browser, baseURL }) => {
  test.setTimeout(20 * 60_000);
  const world = loadWorld();

  const deviceA = await browser.newContext({ ...PLAY_USE, baseURL });
  const friend = await addFriend(deviceA.request, `lock${Date.now() % 100000}`);
  await signInWith(deviceA.request, friend.link);
  const pageA = await deviceA.newPage();
  await pageA.goto("/?stats&classic");
  await expect(pageA.getByTestId("stats")).toBeVisible({ timeout: 60_000 });
  const a = new Player(pageA, world);
  await a.playIntro();
  for (const key of ["ArrowLeft", "ArrowLeft", "ArrowDown"] as const) await a.step(key);
  const there = await spot(a);

  // Device B: the same player. The save is busy.
  const deviceB = await browser.newContext({ ...PLAY_USE, baseURL });
  await signInWith(deviceB.request, await friendLink(deviceB.request, friend.player.id));
  const pageB = await deviceB.newPage();
  await pageB.goto("/?stats");
  await expect(pageB.getByTestId("lock-screen")).toHaveAttribute("data-kind", "in-use", { timeout: 60_000 });

  // B takes it over: A stops, B carries on from where A was.
  await pageB.getByTestId("lock-take").click();
  await expect(pageA.getByTestId("lock-screen")).toHaveAttribute("data-kind", "lost", { timeout: 20_000 });
  const stoppedAt = await frames(pageA);
  await expect(pageB.getByTestId("lock-screen")).toHaveCount(0, { timeout: 30_000 });
  const b = new Player(pageB, world);
  await expect.poll(async () => (await b.state())?.mapId, { timeout: 90_000 }).toBe(there[0]);
  expect(await spot(b)).toEqual(there);
  await sleep(2000);
  expect(await frames(pageA), "A's game stopped").toBe(stoppedAt);

  // B in a pocket: frozen, no heartbeat. A takes the save back once B's lease lapses.
  const cdp = await deviceB.newCDPSession(pageB);
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  await pageA.getByTestId("lock-take").click();
  await expect(pageA.getByTestId("lock-screen")).toHaveCount(0, { timeout: 40_000 });
  await expect.poll(async () => (await a.state())?.mapId, { timeout: 90_000 }).toBe(there[0]);
  // B wakes: its save moved while it slept, and it stops.
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  await expect(pageB.getByTestId("lock-screen")).toBeVisible({ timeout: 20_000 });

  await deviceA.close();
  await deviceB.close();
});
