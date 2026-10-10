// The Pokédex menu (p2-dex-menu) in a real browser against `pnpm dev`, at /dev/menu: a save made
// by the game itself (two Pokémon, one hurt, and some items), then each tab, a Potion used from
// the Inventory through the game's own item routine, and the team reordered by dragging.
// Screenshots land in test-results/menu-*.png. Plays in real time, so it only runs when asked:
// POKEHD_MENU=1 pnpm test:e2e menu.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { GameBoy, GiftDesk, SafePoint } from "@pokehd/emu";
import { encodeText, POKEBLUE_SHA1, SYMBOLS } from "@pokehd/rom";
import { playIntro } from "../../../packages/emu/src/testing.ts";
import { loadWorld, PALLET_TOWN, Player, REDS_HOUSE_1F, REDS_HOUSE_2F } from "./game.ts";

const ROM_PATH = fileURLToPath(new URL("../../../rom/pokeblue.gb", import.meta.url));
const WASM_PATH = fileURLToPath(new URL("../../../packages/emu/src/generated/sameboy.wasm", import.meta.url));

test.skip(!process.env.POKEHD_MENU || !existsSync(ROM_PATH), "POKEHD_MENU=1 and the ROM needed");

type Hooked = Window & { __pokehd?: { state: { mode: string } | null; inWorld: boolean } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PARTYMON = 44;

/** A battery save in Red's room, made by the game: two Pokémon, the second hurt, and items. */
async function makeSave(): Promise<Uint8Array> {
  const rom = new Uint8Array(readFileSync(ROM_PATH));
  const gb = await GameBoy.create({ rom, wasmBinary: readFileSync(WASM_PATH) });
  playIntro(gb);
  const safe = SafePoint.of(gb);
  const run = () => {
    for (let i = 0; i < 900 && safe.pending > 0; i++) gb.runFrame();
  };
  for (const [species, level] of [[0xb1, 12], [0x54, 10]] as const) {
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
  desk.give("potions", { kind: "item", item: 0x14, quantity: 5 });
  desk.give("balls", { kind: "item", item: 0x04, quantity: 3 });
  desk.give("antidote", { kind: "item", item: 0x0b, quantity: 1 });
  run();
  ["SHELLY", "PIKACHU"].forEach((name, i) => encodeText(name).forEach((b, j) => gb.write(SYMBOLS.wPartyMonNicks.address + i * 11 + j, b)));
  // Pikachu down to 6 HP, for the Potion.
  gb.write(SYMBOLS.wPartyMons.address + PARTYMON + 1, 0);
  gb.write(SYMBOLS.wPartyMons.address + PARTYMON + 2, 6);
  // Seen and caught a few (Squirtle 7 and Pikachu 25 caught; Pidgey 16 and Rattata 19 seen).
  const flag = (base: number, dex: number) => gb.write(base + ((dex - 1) >> 3), gb.read(base + ((dex - 1) >> 3)) | (1 << ((dex - 1) & 7)));
  for (const dex of [7, 25]) flag(SYMBOLS.wPokedexOwned.address, dex);
  for (const dex of [7, 16, 19, 25]) flag(SYMBOLS.wPokedexSeen.address, dex);
  const save = SYMBOLS.SaveGameData;
  safe.enqueue({ scratch: [], steps: [{ routine: "Bankswitch", registers: () => ({ bc: save.bank << 8, hl: save.address }) }] });
  run();
  return gb.saveSram();
}

async function intoTheWorld(page: Page) {
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

test("the Pokédex menu shows the game and works it through its routines", async ({ page }) => {
  test.setTimeout(10 * 60_000);
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
  // Out into Pallet Town, so the map has a trail to show.
  const p = new Player(page, loadWorld());
  await p.walkTo(REDS_HOUSE_2F, [5, 1]);
  await p.leave("ArrowRight", REDS_HOUSE_1F);
  await p.walkTo(REDS_HOUSE_1F, [3, 7]);
  await p.leave("ArrowDown", PALLET_TOWN);
  await p.walkTo(PALLET_TOWN, [8, 8]);

  await page.getByRole("button", { name: "Pokédex", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "Pokédex" });
  const tab = (name: string) => menu.getByRole("navigation").getByRole("button", { name });
  await expect(menu.getByText("Kanto")).toBeVisible({ timeout: 10_000 });
  await sleep(600);
  await page.screenshot({ path: "test-results/menu-pokemon.png" });

  await tab("Inventory").click();
  await expect(menu.getByText("Your team")).toBeVisible();
  await expect(menu.getByRole("meter", { name: "HP" }).nth(1)).toHaveAttribute("aria-valuenow", "6");
  await sleep(600);
  await page.screenshot({ path: "test-results/menu-inventory.png" });
  // A Potion for Pikachu, through the game's own UseItem.
  await menu.getByRole("button", { name: /^Potion/i }).first().click();
  await menu.getByRole("button", { name: /Use it on/ }).click();
  await menu.getByRole("button", { name: /Pikachu/i }).first().click();
  await menu.getByRole("button", { name: /Use Potion on Pikachu/i }).click();
  await expect(page.getByRole("status")).toContainText(/recovered by 20/i, { timeout: 20_000 });
  await page.screenshot({ path: "test-results/menu-potion.png" });
  await tab("Inventory").click();
  await expect(menu.getByRole("meter", { name: "HP" }).nth(1)).toHaveAttribute("aria-valuenow", "26", { timeout: 5_000 });

  // Pikachu to the front, by dragging its handle above Squirtle.
  const handles = menu.getByLabel("Drag to move");
  const first = await handles.nth(0).boundingBox();
  const second = await handles.nth(1).boundingBox();
  await page.mouse.move(second!.x + 5, second!.y + 5);
  await page.mouse.down();
  await page.mouse.move(first!.x + 5, first!.y - 10, { steps: 8 });
  await page.mouse.up();
  await expect(menu.getByRole("meter", { name: "HP" }).first()).toHaveAttribute("aria-valuenow", "26", { timeout: 10_000 });

  for (const name of ["People", "Map", "Me"]) {
    await tab(name).click();
    await sleep(800);
    await page.screenshot({ path: `test-results/menu-${name.toLowerCase()}.png` });
  }
  await menu.getByRole("button", { name: "Close the Pokédex" }).click();
  // Back to playing: the player walks.
  await expect(menu).toBeHidden();
});
