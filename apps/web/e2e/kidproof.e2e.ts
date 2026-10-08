// Kid-proofing on the real game page (p1-kidproof, D25): a NEW GAME saved over an old one gets
// the page's big question instead of the game's; mashing A can't say yes, "Keep" keeps the old
// save, holding "erase" replaces it, and Earlier saves (behind the grown-ups check) brings the
// old adventure back. Needs the ROM at rom/pokeblue.gb.
// POKEHD_PLAY=1 pnpm test:e2e kidproof
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SYMBOLS } from "@pokehd/rom";
import { expect, test, type Page } from "@playwright/test";
import { hasRom, loadWorld, Player, PLAY_USE, sleep, type Hooked } from "./game.ts";

test.skip(!process.env["POKEHD_PLAY"], "Play-through: set POKEHD_PLAY=1 to run it");
test.skip(!hasRom, "Needs rom/pokeblue.gb");
test.use(PLAY_USE);

const ROM_PATH = fileURLToPath(new URL("../../../rom/pokeblue.gb", import.meta.url));
const ROM_KEY = createHash("sha1").update(readFileSync(ROM_PATH)).digest("hex");
/** The trainer ID's offset in the battery save (sMainData holds a copy of WRAM from wMainDataStart). */
const ID_AT = 0x2000 + SYMBOLS.sMainData.address - 0xa000 + SYMBOLS.wPlayerID.address - SYMBOLS.wMainDataStart.address;

const SRAM_AT = (name: "sGameData" | "sGameDataEnd" | "sMainDataCheckSum") => SYMBOLS[name].bank * 0x2000 + SYMBOLS[name].address - 0xa000;
/** Where the save's checksummed data starts and ends, and its checksum. */
const CHECKED = [SRAM_AT("sGameData"), SRAM_AT("sGameDataEnd"), SRAM_AT("sMainDataCheckSum")] as const;

/** The stored save's trainer ID, or null with no valid save (the game also keeps scratch data in SRAM). */
async function savedId(page: Page): Promise<number | null> {
  return page.evaluate(
    ([key, at, [start, end, sumAt]]) =>
      new Promise<number | null>((resolve, reject) => {
        const open = indexedDB.open("pokehd");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction("saves").objectStore("saves").get(key);
          get.onsuccess = () => {
            const buf = get.result as ArrayBuffer | undefined;
            open.result.close();
            if (!buf) return resolve(null);
            const sram = new Uint8Array(buf);
            let sum = 0;
            for (let i = start; i < end; i++) sum = (sum + sram[i]!) & 0xff;
            resolve((~sum & 0xff) === sram[sumAt] ? (sram[at]! << 8) | sram[at + 1]! : null);
          };
        };
      }),
    [ROM_KEY, ID_AT, CHECKED] as const,
  );
}

/**
 * Opens the start menu's SAVE (the fourth item before the Pokédex; the menu remembers its cursor,
 * so `downs` is 0 once SAVE was last used), then presses A, as a child would, until `done`.
 */
async function startSaving(p: Player, done: () => Promise<boolean>, downs = 3): Promise<void> {
  await p.tap("Enter");
  await sleep(500);
  for (let i = 0; i < downs; i++) {
    await p.tap("ArrowDown");
    await sleep(200);
  }
  for (const end = Date.now() + 60_000; Date.now() < end && !(await done()); ) {
    await p.tap("z");
    await sleep(600);
  }
}

test("a new game can't erase the old save by accident", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  const world = loadWorld();
  const p = new Player(page, world);
  await page.goto("/?stats");
  await expect(page.getByTestId("stats")).toBeVisible({ timeout: 60_000 });

  // The first adventure, saved by hand.
  await p.playIntro();
  await startSaving(p, async () => (await savedId(page)) !== null);
  const first = (await savedId(page))!;
  await p.clearDialogs();

  // Back to the title screen and NEW GAME.
  // The page resumes where the last session left off, then offers the save file once it has
  // looked for a newer resume point in the cloud (isVisible doesn't wait, so wait for it).
  await page.reload();
  await expect(page.getByTestId("stats")).toBeVisible({ timeout: 60_000 });
  const fromSave = page.getByRole("button", { name: "Go back to my last save instead" });
  if (await fromSave.waitFor({ timeout: 15_000 }).then(() => true, () => false)) await fromSave.click();
  // Through the intro and title screen to the main menu, which loads the save to preview it, so
  // the map is the saved one only once CONTINUE / NEW GAME is up. (Clicking above restarts the
  // emulator, so fixed timings don't line up.)
  for (const end = Date.now() + 60_000; ((await p.state())?.mapId ?? 0) === 0; ) {
    if (Date.now() > end) throw new Error("Never reached the main menu");
    await p.tap("z");
    await sleep(700);
  }
  await sleep(500);
  await p.tap("ArrowDown"); // CONTINUE → NEW GAME
  await sleep(300);
  await p.tap("z");
  await p.playIntro();

  // Saving it asks the page's question, and mashing A meanwhile does nothing.
  const keep = page.getByRole("button", { name: "Keep my old adventure" });
  await startSaving(p, () => keep.isVisible());
  await expect(keep).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "test-results/kidproof-erase-question.png" });
  for (let i = 0; i < 20; i++) {
    await p.tap("z");
    await sleep(150);
  }
  expect(await savedId(page)).toBe(first);
  await keep.click();
  await expect(keep).toBeHidden({ timeout: 10_000 });
  await sleep(3000);
  expect(await savedId(page)).toBe(first);
  // NO goes back to the start menu: close it.
  for (let i = 0; i < 3; i++) {
    await p.tap("x");
    await sleep(600);
  }

  // Held long enough, erase goes through and the new trainer is saved.
  const erase = page.getByRole("button", { name: /Hold to erase/ });
  await startSaving(p, () => erase.isVisible(), 0);
  await expect(erase).toBeVisible({ timeout: 30_000 });
  await erase.hover();
  await page.mouse.down();
  await sleep(2600);
  await page.mouse.up();
  await expect(erase).toBeHidden({ timeout: 10_000 });
  await expect.poll(() => savedId(page), { timeout: 30_000 }).not.toBe(first);
  await p.clearDialogs();

  // The first adventure is under Earlier saves, behind the grown-ups question.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Grown-ups…" }).click();
  const question = await page.getByText(/Grown-ups only: what is/).textContent();
  const [, a, b] = /(\d+) × (\d+)/.exec(question ?? "")!;
  await page.getByRole("textbox").fill(String(Number(a) * Number(b)));
  await page.getByRole("button", { name: "OK" }).click();
  await page.getByRole("button", { name: "Earlier saves…" }).click();
  const entry = page.locator(".earlier-saves li", { hasText: "before a new game saved over it" });
  await expect(entry).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: "test-results/kidproof-earlier-saves.png" });
  page.once("dialog", (d) => void d.accept());
  await entry.getByRole("button", { name: "Go back" }).click();
  await expect.poll(() => savedId(page), { timeout: 30_000 }).toBe(first);
  await expect.poll(() => page.evaluate(() => (window as Hooked).__pokehd !== undefined), { timeout: 30_000 }).toBe(true);
});
