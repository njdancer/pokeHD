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

/** The stored save's trainer ID, or null with no save. */
async function savedId(page: Page): Promise<number | null> {
  return page.evaluate(
    ([key, at]) =>
      new Promise<number | null>((resolve, reject) => {
        const open = indexedDB.open("pokehd");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction("saves").objectStore("saves").get(key);
          get.onsuccess = () => {
            const buf = get.result as ArrayBuffer | undefined;
            open.result.close();
            resolve(buf ? (new Uint8Array(buf)[at]! << 8) | new Uint8Array(buf)[at + 1]! : null);
          };
        };
      }),
    [ROM_KEY, ID_AT] as const,
  );
}

/** Opens the start menu's SAVE (the fourth item before the Pokédex) and says YES. */
async function startSaving(p: Player): Promise<void> {
  await p.tap("Enter");
  await sleep(500);
  for (let i = 0; i < 3; i++) {
    await p.tap("ArrowDown");
    await sleep(200);
  }
  await p.tap("z"); // SAVE
  await sleep(1500);
  await p.tap("z"); // "Would you like to save the game?" YES
}

test("a new game can't erase the old save by accident", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  const world = loadWorld();
  const p = new Player(page, world);
  await page.goto("/?stats");
  await expect(page.getByTestId("stats")).toBeVisible({ timeout: 60_000 });

  // The first adventure, saved by hand.
  await p.playIntro();
  await startSaving(p);
  await expect.poll(() => savedId(page), { timeout: 30_000 }).not.toBeNull();
  const first = (await savedId(page))!;
  await p.clearDialogs();

  // Back to the title screen and NEW GAME.
  await page.reload();
  const fromSave = page.getByRole("button", { name: "Load the save file instead" });
  if (await fromSave.isVisible({ timeout: 15_000 }).catch(() => false)) await fromSave.click();
  await sleep(4000);
  for (let i = 0; i < 6; i++) {
    await p.tap("z"); // title screen, then the copyright and intro
    await sleep(700);
  }
  await p.tap("ArrowDown"); // CONTINUE → NEW GAME
  await sleep(300);
  await p.tap("z");
  await p.playIntro();

  // Saving it asks the page's question, and mashing A meanwhile does nothing.
  await startSaving(p);
  const keep = page.getByRole("button", { name: "Keep my old adventure" });
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
  await p.clearDialogs();

  // Held long enough, erase goes through and the new trainer is saved.
  await startSaving(p);
  const erase = page.getByRole("button", { name: /Hold to erase/ });
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
