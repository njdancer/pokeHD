// Cloud saves across devices on the real game page (p1-saves-cloud): one player saves in the game
// on one device, signs in a second device with a device code, restores the cloud save there and
// continues from the same spot. Two browser contexts stand in for the two devices.
// Needs the ROM, and an admin token to make the invite: run the dev server with ADMIN_TOKEN in
// apps/web/.dev.vars and the same value in POKEHD_ADMIN_TOKEN.
// POKEHD_PLAY=1 POKEHD_ADMIN_TOKEN=… pnpm test:e2e cloud-save
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SYMBOLS } from "@pokehd/rom";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { hasRom, loadWorld, Player, PLAY_USE, REDS_HOUSE_2F, sleep } from "./game.ts";

const ADMIN_TOKEN = process.env["POKEHD_ADMIN_TOKEN"];
const ROM_PATH = fileURLToPath(new URL("../../../rom/pokeblue.gb", import.meta.url));

test.skip(!process.env["POKEHD_PLAY"], "Long play-through: set POKEHD_PLAY=1 to run it");
test.skip(!hasRom, "Needs rom/pokeblue.gb");
test.skip(!ADMIN_TOKEN, "Needs POKEHD_ADMIN_TOKEN (and the dev server's ADMIN_TOKEN) to make an invite");
test.use(PLAY_USE);

async function joinWith(request: APIRequestContext, code: string, name: string) {
  const res = await request.post("/api/join", { data: { code, name } });
  expect(res.ok(), await res.text()).toBe(true);
}

/**
 * The map and position in a .sav: wCurMap, wYCoord and wXCoord as the save's main data holds
 * them (sMainData is at bank 1, 0xA5A3, a copy of WRAM from wMainDataStart, 0xD2F7).
 */
function savedSpot(sav: Uint8Array): [number, number, number] {
  const at = (wram: number) => sav[0x2000 + 0x5a3 + wram - 0xd2f7]!;
  return [at(SYMBOLS.wCurMap.address), at(SYMBOLS.wXCoord.address), at(SYMBOLS.wYCoord.address)];
}

/**
 * Saves through the start menu (before the player has a Pokédex, SAVE is the fourth item),
 * pressing A through the questions until the cloud backup holds the save. The game writes it
 * at once; the backup uploads it a few seconds later.
 */
async function saveInGame(p: Player, cloud: () => Promise<Uint8Array | null>): Promise<[number, number, number]> {
  await p.tap("Enter");
  await sleep(500);
  for (let i = 0; i < 3; i++) {
    await p.tap("ArrowDown");
    await sleep(200);
  }
  const s = await p.state();
  const spot: [number, number, number] = [s.mapId, s.player.x, s.player.y];
  for (const end = Date.now() + 60_000; Date.now() < end; ) {
    await p.tap("z");
    await sleep(1000);
    const sav = await cloud();
    if (sav && savedSpot(sav).every((v, i) => v === spot[i])) {
      await p.clearDialogs("x");
      return spot;
    }
  }
  throw new Error("The save never reached the cloud");
}

test("a save made on one device continues on another", async ({ browser, baseURL }) => {
  test.setTimeout(15 * 60_000);
  const world = loadWorld();
  const key = createHash("sha1").update(readFileSync(ROM_PATH)).digest("hex");

  // Device A: a new player from an invite, a new game, a few steps, a save.
  const invite = await (await browser.newContext({ baseURL })).request.post("/api/admin/invites", {
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    data: { note: "e2e cloud save" },
  });
  expect(invite.ok(), await invite.text()).toBe(true);
  const { code } = (await invite.json()) as { code: string };

  const deviceA = await browser.newContext({ ...PLAY_USE, baseURL });
  await joinWith(deviceA.request, code, `e2e${Date.now() % 100000}`);
  const pageA = await deviceA.newPage();
  await pageA.goto("/?stats");
  await expect(pageA.getByTestId("stats")).toBeVisible({ timeout: 60_000 });
  const a = new Player(pageA, world);
  await a.playIntro();
  await a.walkTo(REDS_HOUSE_2F, [5, 4]);
  const saved = await saveInGame(a, async () => {
    const res = await deviceA.request.get(`/api/saves/${key}`);
    return res.ok() ? res.body() : null;
  });

  // Device B: signed in with a device code from A, with nothing saved in this browser.
  const deviceCode = await deviceA.request.post("/api/me/device-code");
  expect(deviceCode.ok()).toBe(true);
  const deviceB = await browser.newContext({ ...PLAY_USE, baseURL });
  await joinWith(deviceB.request, ((await deviceCode.json()) as { code: string }).code, "");
  const pageB = await deviceB.newPage();
  pageB.on("dialog", (d) => void d.accept());
  await pageB.goto("/?stats");
  await pageB.getByRole("button", { name: "Newer save in the cloud" }).click({ timeout: 60_000 });
  await pageB.getByRole("button", { name: "Restore from cloud" }).click();

  // The emulator restarts on the restored save: Continue from the title screen.
  const b = new Player(pageB, world);
  await expect(pageB.getByRole("button", { name: "Newer save in the cloud" })).toBeHidden({ timeout: 30_000 });
  const inWorld = () => pageB.evaluate(() => (window as { __pokehd?: { inWorld: boolean } }).__pokehd?.inWorld ?? false);
  for (let i = 0; i < 600 && !(await inWorld()); i++) {
    await b.tap("z", 33);
    await sleep(150);
  }
  expect(await inWorld()).toBe(true);
  const resumed = await b.clearDialogs("x");
  expect([resumed.mapId, resumed.player.x, resumed.player.y]).toEqual(saved);

  await deviceA.close();
  await deviceB.close();
});
