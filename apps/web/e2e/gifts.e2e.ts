// Gifts (D20) in real browsers against `pnpm dev`: two players, each with a save made by the
// game itself, send each other money, an item and a Pokémon through the gift panel and the
// room, and the receiver's notices say what arrived. A reload before saving brings the gifts
// again. Needs the ROM at rom/pokeblue.gb and ADMIN_TOKEN in apps/web/.dev.vars, and plays in
// real time, so it only runs when asked: POKEHD_GIFTS=1 pnpm test:e2e gifts.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { GameBoy, GiftDesk, SafePoint } from "@pokehd/emu";
import { encodeText, POKEBLUE_SHA1, SYMBOLS } from "@pokehd/rom";
import { playIntro } from "../../../packages/emu/src/testing.ts";

const ROM_PATH = fileURLToPath(new URL("../../../rom/pokeblue.gb", import.meta.url));
const WASM_PATH = fileURLToPath(new URL("../../../packages/emu/src/generated/sameboy.wasm", import.meta.url));

function adminToken(): string | undefined {
  if (process.env.POKEHD_ADMIN_TOKEN) return process.env.POKEHD_ADMIN_TOKEN;
  try {
    return /^ADMIN_TOKEN\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"))?.[1];
  } catch {
    return undefined;
  }
}
const token = adminToken();
test.skip(!process.env.POKEHD_GIFTS || !token || !existsSync(ROM_PATH), "POKEHD_GIFTS=1, the ROM and ADMIN_TOKEN needed");

type Hooked = Window & { __pokehd?: { state: { mode: string } | null; inWorld: boolean } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const press = async (page: Page, key: string) => {
  await page.keyboard.down(key);
  await sleep(50);
  await page.keyboard.up(key);
  await sleep(250);
};
const log = (...args: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...args);

/**
 * A battery save in Red's room, made by the game: a new game, then (for the sender) two
 * Pokémon from AddPartyMon, named, and five Potions, then the game's own SaveGameData.
 */
async function makeSave(sender: boolean): Promise<Uint8Array> {
  const rom = new Uint8Array(readFileSync(ROM_PATH));
  const gb = await GameBoy.create({ rom, wasmBinary: readFileSync(WASM_PATH) });
  playIntro(gb);
  const safe = SafePoint.of(gb);
  const run = () => {
    for (let i = 0; i < 600 && safe.pending > 0; i++) gb.runFrame();
  };
  if (sender) {
    for (const [species, level] of [[0x54, 12], [0x24, 5]] as const) {
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
    new GiftDesk(gb, { rom, emit: () => {} }).give("setup", { kind: "item", item: 0x14, quantity: 5 });
    run();
    ["SPARKY", "PIDGE"].forEach((name, i) =>
      encodeText(name).forEach((b, j) => gb.write(SYMBOLS.wPartyMonNicks.address + i * 11 + j, b)),
    );
  }
  const save = SYMBOLS.SaveGameData;
  safe.enqueue({ scratch: [], steps: [{ routine: "Bankswitch", registers: () => ({ bc: save.bank << 8, hl: save.address }) }] });
  run();
  return gb.saveSram();
}

/** A browser profile signed in as a new player, with `sram` as its save, in the overworld. */
async function player(browser: Browser, name: string, sram: Uint8Array): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  // No HD view: two pages rendering it in software WebGL starve each other, and gifts don't
  // need it. The page falls back to the Game Boy screen alone.
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      return kind.startsWith("webgl") ? null : (getContext as (...a: unknown[]) => unknown).call(this, kind, ...rest);
    } as typeof getContext;
  });
  const invite = await page.request.post("/api/admin/invites", { headers: { authorization: `Bearer ${token}` }, data: {} });
  const { code } = (await invite.json()) as { code: string };
  expect((await page.request.post("/api/join", { data: { code, name } })).ok()).toBe(true);
  // Put the save in this profile's IndexedDB before the game page opens.
  await page.goto("/join");
  await page.evaluate(
    async ({ key, bytes }) => {
      const url = "/src/client/saves/save-store.ts";
      const { storeSave } = (await import(/* @vite-ignore */ url)) as typeof import("../src/client/saves/save-store.ts");
      await storeSave(key, new Uint8Array(bytes));
    },
    { key: POKEBLUE_SHA1, bytes: [...sram] },
  );
  log(name, "save stored");
  await page.goto("/?stats");
  await expect(page.getByTestId("stats")).toBeVisible({ timeout: 60_000 });
  // Title, CONTINUE, the save's summary: A until the overworld loop runs.
  for (let tick = 0; tick < 600; tick++) {
    const ready = await page.evaluate(() => {
      const p = (window as Hooked).__pokehd;
      return !!p?.inWorld && p.state?.mode === "overworld";
    });
    if (ready && tick > 0) break;
    await press(page, "z");
  }
  log(name, "in the overworld", await page.locator(".room-badge").textContent().catch(() => "no badge"));
  await expect(page.getByText(/friends? online/)).toBeVisible({ timeout: 20_000 });
  return page;
}

test("friends send each other money, an item and a Pokémon", async ({ browser }) => {
  test.setTimeout(25 * 60_000);
  const [senderSave, receiverSave] = [await makeSave(true), await makeSave(false)];
  log("saves made");
  const stamp = Date.now() % 10000;
  const sender = await player(browser, `Sam${stamp}`, senderSave);
  const receiver = await player(browser, `Alex${stamp}`, receiverSave);
  await expect(sender.getByText("1 friend online")).toBeVisible({ timeout: 20_000 });

  await sender.getByRole("button", { name: "Gift" }).click();
  const panel = sender.getByRole("dialog", { name: "Send a gift" });
  await expect(panel.getByRole("combobox")).toHaveValue(/.+/);

  await panel.getByRole("tab", { name: "Money" }).click();
  await panel.getByLabel("Amount").fill("500");
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel.getByText(/Sent ¥500 to Alex/)).toBeVisible({ timeout: 30_000 });

  await panel.getByRole("tab", { name: "Item" }).click();
  await panel.getByRole("listitem").filter({ hasText: "POTION" }).getByRole("button", { name: "Send" }).click();
  await expect(panel.getByText(/Sent POTION ×1 to Alex/)).toBeVisible({ timeout: 30_000 });

  await panel.getByRole("tab", { name: "Pokémon" }).click();
  await panel.getByRole("listitem").filter({ hasText: "SPARKY" }).getByRole("button", { name: "Send" }).click();
  await expect(panel.getByText(/Sent SPARKY \(PIKACHU, Lv 12\) to Alex/)).toBeVisible({ timeout: 30_000 });
  // The last Pokémon can't go.
  await expect(panel.getByRole("listitem").filter({ hasText: "PIDGE" }).getByRole("button", { name: "Send" })).toBeDisabled();
  await sender.screenshot({ path: "test-results/gifts-sender.png" });

  const notices = receiver.locator(".gift-notices");
  await expect(notices.getByText(/sent you ¥500/)).toBeVisible({ timeout: 30_000 });
  await expect(notices.getByText(/sent you POTION ×1/)).toBeVisible({ timeout: 30_000 });
  await expect(notices.getByText(/sent you SPARKY \(PIKACHU, Lv 12\)/)).toBeVisible({ timeout: 30_000 });
  await receiver.screenshot({ path: "test-results/gifts-receiver.png" });

  // Not saved yet, so a reload brings them again (the room still holds them).
  const received = receiver.locator(".gift-notices").getByText(/sent you ¥500/);
  await receiver.reload();
  await expect(receiver.getByTestId("stats")).toBeVisible({ timeout: 60_000 });
  for (let tick = 0; tick < 600 && !(await received.isVisible()); tick++) await press(receiver, "z");
  await expect(received).toBeVisible();
  log("re-delivered after a reload");

  // The receiver saves from the start menu (POKéMON, ITEM, name, SAVE): now they're delivered,
  // and the next reload brings nothing.
  await sleep(2000);
  await press(receiver, "Enter");
  for (let i = 0; i < 3; i++) await press(receiver, "ArrowDown");
  await press(receiver, "z"); // SAVE
  await sleep(1500);
  await press(receiver, "z"); // YES
  await sleep(4000);
  await press(receiver, "x");
  await press(receiver, "x");
  await sleep(3000);
  await receiver.screenshot({ path: "test-results/gifts-receiver-saved.png" });
  log("saved");
  await receiver.reload();
  await expect(receiver.getByTestId("stats")).toBeVisible({ timeout: 60_000 });
  for (let tick = 0; tick < 600; tick++) {
    const ready = await receiver.evaluate(() => {
      const p = (window as Hooked).__pokehd;
      return !!p?.inWorld && p.state?.mode === "overworld";
    });
    if (ready) break;
    await press(receiver, "z");
  }
  await sleep(5000);
  await expect(receiver.locator(".gift-notices").getByText(/sent you/)).toHaveCount(0);
  await expect(receiver.getByTestId("stats")).toHaveAttribute("data-mode", "overworld");
});
