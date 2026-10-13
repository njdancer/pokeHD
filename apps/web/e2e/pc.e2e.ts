// Bill's PC and the player's own PC, in a real browser against `pnpm dev`, the way a player gets
// there: a save made by the game in the Viridian City Pokémon Center, facing the PC, with three
// Pokémon and a few Poké Balls. Deposits a Pokémon and an item through the dex menu's sheets.
// Screenshots land in test-results/pc-*.png. Plays in real time: POKEHD_MENU=1 pnpm test:e2e pc.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { Button, GameBoy, GiftDesk, SafePoint } from "@pokehd/emu";
import { encodeText, POKEBLUE_SHA1, SYMBOLS } from "@pokehd/rom";
import { playIntro } from "../../../packages/emu/src/testing.ts";
import { loadWorld, Player, VIRIDIAN_CITY, type Hooked } from "./game.ts";

const ROM_PATH = fileURLToPath(new URL("../../../rom/pokeblue.gb", import.meta.url));
const WASM_PATH = fileURLToPath(new URL("../../../packages/emu/src/generated/sameboy.wasm", import.meta.url));

test.use({ actionTimeout: 10_000 });
test.skip(!process.env.POKEHD_MENU || !existsSync(ROM_PATH), "POKEHD_MENU=1 and the ROM needed");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const VIRIDIAN_POKECENTER = 0x29;
const POKE_BALL = 0x04;
// WRAM the generated symbols leave out (pokeblue.sym).
const W_DESTINATION_MAP = 0xd71a;
const W_STATUS_FLAGS_6 = 0xd732;
const BIT_FLY_WARP = 3;

/** A battery save in the Viridian Pokémon Center, one step below the PC, with three Pokémon. */
export async function makeSave(): Promise<Uint8Array> {
  const rom = new Uint8Array(readFileSync(ROM_PATH));
  const gb = await GameBoy.create({ rom, wasmBinary: readFileSync(WASM_PATH) });
  playIntro(gb);
  const safe = SafePoint.of(gb);
  const run = () => {
    for (let i = 0; i < 900 && safe.pending > 0; i++) gb.runFrame();
  };
  for (const [species, level] of [[0xb1, 12], [0x54, 10], [0x24, 5]] as const) {
    safe.enqueue({
      scratch: [],
      steps: [
        {
          routine: "AddPartyMon",
          before: (g) => {
            g.write(SYMBOLS.wCurPartySpecies.address, species);
            g.write(SYMBOLS.wCurEnemyLevel.address, level);
            g.write(SYMBOLS.wMonDataLocation.address, 0x10);
          },
        },
      ],
    });
  }
  const desk = new GiftDesk(gb, { rom, emit: () => {} });
  desk.give("balls", { kind: "item", item: POKE_BALL, quantity: 5 });
  desk.give("potions", { kind: "item", item: 0x14, quantity: 2 });
  run();
  ["SHELLY", "PIKACHU", "PIDGEY"].forEach((name, i) => encodeText(name).forEach((b, j) => gb.write(SYMBOLS.wPartyMonNicks.address + i * 11 + j, b)));
  // Flies to Viridian City as the game's own Fly does, and walks in at the Pokémon Center's door.
  gb.write(W_DESTINATION_MAP, VIRIDIAN_CITY);
  gb.write(W_STATUS_FLAGS_6, gb.read(W_STATUS_FLAGS_6) | (1 << BIT_FLY_WARP));
  for (let i = 0; i < 600; i++) gb.runFrame();
  for (let i = 0; i < 300 && gb.read(SYMBOLS.wCurMap.address) !== VIRIDIAN_POKECENTER; i++) {
    gb.setButtons(Button.Up);
    gb.runFrame();
  }
  gb.setButtons(0);
  for (let i = 0; i < 200; i++) gb.runFrame();
  const save = SYMBOLS.SaveGameData;
  safe.enqueue({ scratch: [], steps: [{ routine: "Bankswitch", registers: () => ({ bc: save.bank << 8, hl: save.address }) }] });
  run();
  return gb.saveSram();
}

export async function intoTheWorld(page: Page) {
  for (let tick = 0; tick < 600; tick++) {
    const ready = await page.evaluate(() => {
      const p = (window as Hooked).__pokehd;
      return !!p?.inWorld && p.state?.mode === "overworld";
    });
    if (ready && tick > 0) return;
    await page.keyboard.down("z");
    await sleep(50);
    await page.keyboard.up("z");
    await sleep(250);
  }
  throw new Error("never reached the overworld");
}

test("deposits a Pokémon and a Poké Ball at the PC, by tapping", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const sram = await makeSave();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.evaluate(
    async ({ key, bytes }) => {
      const url = "/src/client/saves/save-store.ts";
      const { storeSave } = (await import(/* @vite-ignore */ url)) as typeof import("../src/client/saves/save-store.ts");
      await storeSave(key, new Uint8Array(bytes));
    },
    { key: POKEBLUE_SHA1, bytes: [...sram] },
  );
  await page.goto("/dev/menu/live?stats&classic");
  await expect(page.getByTestId("stats")).toBeVisible({ timeout: 60_000 });
  await intoTheWorld(page);
  const p = new Player(page, loadWorld());
  await p.walkTo(VIRIDIAN_POKECENTER, [13, 4]);
  await page.screenshot({ path: "test-results/pc-0-start.png" });
  await page.keyboard.down("ArrowUp");
  await sleep(60);
  await page.keyboard.up("ArrowUp");
  await sleep(300);
  await page.keyboard.down("z");
  await sleep(60);
  await page.keyboard.up("z");
  // Everything from here is by tapping, as on a phone.
  const message = page.locator(".hd-box.dialog");
  /** Taps the message box until `then` shows (the game reads on with each tap). */
  const readOn = async (then: ReturnType<Page["getByRole"]>) => {
    for (let i = 0; i < 20 && !(await then.isVisible()); i++) {
      if (await message.isVisible()) await message.click({ position: { x: 20, y: 20 } }).catch(() => {});
      await sleep(500);
    }
    await expect(then).toBeVisible();
  };
  const choice = (name: string | RegExp) => page.locator(".hd-choice").filter({ hasText: name });
  await readOn(choice(/SOMEONE's PC/));
  await choice(/SOMEONE's PC/).click();
  // "Accessed someone's PC." waits under the PC's menu, which still shows its ▶: the tap must
  // read on, and the menu must not take it.
  await expect(page.locator(".hd-box.dialog.tappable")).toBeVisible({ timeout: 5_000 });
  await readOn(choice("DEPOSIT PKMN"));
  await page.screenshot({ path: "test-results/pc-1-bills-pc.png" });
  await choice("DEPOSIT PKMN").click();
  const sheet = page.getByRole("dialog", { name: "The game asks" });
  await expect(sheet.getByText("Put which Pokémon in the PC?")).toBeVisible({ timeout: 10_000 });
  await sheet.getByRole("button", { name: /Pikachu/i }).click();
  await sheet.getByRole("button", { name: "Put it in the PC" }).click();
  await expect(message).toContainText("stored in Box", { timeout: 10_000 });
  await readOn(choice("SEE YA!"));
  type Reads = Window & { __pokehd?: { read(address: number, length: number): Promise<number[]> } };
  const box = await page.evaluate((address) => (window as Reads).__pokehd!.read(address, 1), SYMBOLS.wBoxCount.address);
  expect(box[0], "Pokémon in the box").toBe(1);
  await choice("SEE YA!").click();

  // The player's own PC: a Poké Ball into storage.
  await readOn(choice(/'s PC$/).nth(1));
  await choice(/'s PC$/).nth(1).click();
  await readOn(choice("DEPOSIT ITEM"));
  await choice("DEPOSIT ITEM").click();
  const bag = page.getByRole("dialog", { name: "Bag" });
  await expect(bag.getByText("What do you want to deposit?")).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: "test-results/pc-2-deposit-item.png" });
  await bag.getByRole("button", { name: /Poké Ball/ }).click();
  const many = page.getByRole("dialog", { name: "How many?" });
  await many.getByRole("button", { name: "More" }).click();
  await many.getByRole("button", { name: "OK", exact: true }).click();
  await expect(message).toContainText("via PC", { timeout: 10_000 });
  await readOn(bag);
  await expect(bag.getByRole("button", { name: /Poké Ball/ })).toContainText("×3");
  expect(errors).toEqual([]);
});
