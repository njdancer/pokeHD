// Fuzzing the intro and save slots on the real page (/dev/saves, p2-slots): a seeded run of what
// a child might do (reload at any moment, switch app, resume, play another save, copy one, walk
// about, mash buttons) checking after every step that
// - the game answers: once playing, emulated frames advance and a direction turns the player;
// - no save goes backwards: each slot keeps its trainer, and its play time never drops;
// - nothing starts a new game over a save (the trainer ID never changes).
// Needs the ROM at rom/pokeblue.gb. POKEHD_PLAY=1 pnpm test:e2e saves-fuzz
// POKEHD_FUZZ_SEED picks the run (a failure prints its seed and steps), POKEHD_FUZZ_STEPS its length.
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
const SRAM_AT = (name: "sGameData" | "sGameDataEnd" | "sMainDataCheckSum") => SYMBOLS[name].bank * 0x2000 + SYMBOLS[name].address - 0xa000;
/** A save-RAM copy of a WRAM variable in sMainData. */
const MAIN_AT = (name: "wPlayerID" | "wPlayTimeHours" | "wPlayTimeMinutes") =>
  0x2000 + SYMBOLS.sMainData.address - 0xa000 + SYMBOLS[name].address - SYMBOLS.wMainDataStart.address;
const LAYOUT = {
  checked: [SRAM_AT("sGameData"), SRAM_AT("sGameDataEnd"), SRAM_AT("sMainDataCheckSum")],
  id: MAIN_AT("wPlayerID"),
  hours: MAIN_AT("wPlayTimeHours"),
  minutes: MAIN_AT("wPlayTimeMinutes"),
};

interface SaveFacts {
  key: string;
  id: number;
  minutes: number;
}

/** Every slot's stored save on the page's device: its trainer ID and play time, or none. */
function readSaves(page: Page): Promise<SaveFacts[]> {
  return page.evaluate(
    ([rom, layout]) =>
      new Promise<SaveFacts[]>((resolve, reject) => {
        const open = indexedDB.open("pokehd");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const store = open.result.transaction("saves").objectStore("saves");
          const keys = store.getAllKeys();
          const values = store.getAll();
          values.onsuccess = () => {
            open.result.close();
            const out: SaveFacts[] = [];
            keys.result.forEach((k, i) => {
              const key = String(k);
              // A slot's battery save: the ROM's SHA-1, and a slot ID for all but the main one.
              if (!new RegExp(`^${rom}(-[0-9a-z]{8})?$`).test(key)) return;
              const sram = new Uint8Array(values.result[i] as ArrayBuffer);
              const [start, end, sumAt] = layout.checked;
              let sum = 0;
              for (let j = start!; j < end!; j++) sum = (sum + sram[j]!) & 0xff;
              if ((~sum & 0xff) !== sram[sumAt!]) return;
              out.push({ key, id: (sram[layout.id]! << 8) | sram[layout.id + 1]!, minutes: sram[layout.hours]! * 60 + sram[layout.minutes]! });
            });
            resolve(out);
          };
        };
      }),
    [ROM_KEY, LAYOUT] as const,
  );
}

/** mulberry32: a small seeded generator, so a failing run can be repeated. */
function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]! };
}

const hooked = (page: Page) => page.evaluate(() => {
  const h = (window as Hooked & { __pokehd?: { frames?: number } }).__pokehd;
  return h ? { inWorld: h.inWorld, frames: h.frames ?? 0, state: h.state ? JSON.parse(JSON.stringify(h.state)) : null } : null;
});

/** As when the player switches app: the page is hidden (which takes a resume point). */
async function hide(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

test("the intro and save slots survive a child", async ({ page }) => {
  const steps = Number(process.env["POKEHD_FUZZ_STEPS"] ?? 25);
  const seed = Number(process.env["POKEHD_FUZZ_SEED"] ?? Date.now() % 1e9);
  test.setTimeout((10 + steps * 2) * 60_000);
  const rand = prng(seed);
  const log: string[] = [`seed ${seed}`];
  test.info().annotations.push({ type: "seed", description: String(seed) });
  page.on("pageerror", (e) => log.push(`page error: ${e.message}`));
  const world = loadWorld();
  const p = new Player(page, world);

  // A real adventure to start from: the new-game intro played the game's own way, into the
  // world, where it saves itself.
  await page.goto("/?stats&classic");
  await expect(page.getByTestId("stats")).toBeVisible({ timeout: 60_000 });
  await p.playIntro();
  await expect.poll(async () => (await readSaves(page)).length, { timeout: 60_000 }).toBe(1);
  const trainer = (await readSaves(page))[0]!.id;
  /** The longest play time each slot has had: a save may only move forwards. */
  const best = new Map<string, number>();

  const check = async (what: string) => {
    const saves = await readSaves(page);
    for (const s of saves) {
      log.push(`  ${s.key.slice(40) || "main"}: trainer ${s.id}, ${s.minutes} min`);
      expect(s.id, `${what}: a slot's trainer changed (a new game over a save)\n${log.join("\n")}`).toBe(trainer);
      expect(s.minutes, `${what}: a slot's play time went backwards\n${log.join("\n")}`).toBeGreaterThanOrEqual(best.get(s.key) ?? 0);
      best.set(s.key, s.minutes);
    }
    for (const key of best.keys()) {
      expect(saves.some((s) => s.key === key), `${what}: slot ${key} lost its save\n${log.join("\n")}`).toBe(true);
    }
  };

  /** The intro is up: its loading screen has gone and Resume can be pressed. */
  const atIntro = async () => {
    await expect(page.getByTestId("loading")).toHaveCount(0, { timeout: 90_000 });
    await expect(page.getByTestId("intro-resume")).toBeVisible({ timeout: 30_000 });
  };

  /** What the game and page were doing, for a failure's report. */
  const diagnose = async () => {
    const at: [string, number][] = [
      ...(["wJoyIgnore", "wStatusFlags3", "wStatusFlags4", "wStatusFlags5", "wStatusFlags6", "wIsInBattle", "wPlayerMovingDirection", "hWY"] as const).map((n) => [n, SYMBOLS[n].address] as [string, number]),
      ["hJoyPressed", 0xffb3],
      ["hJoyHeld", 0xffb4],
    ];
    const read = await page.evaluate(async (addresses: number[]) => {
      const h = (window as unknown as { __pokehd?: { read(a: number, n: number): Promise<number[]>; page: object } }).__pokehd;
      if (!h) return null;
      return { page: h.page, bytes: await Promise.all(addresses.map((a) => h.read(a, 1).then((b) => b[0]))) };
    }, at.map(([, a]) => a));
    log.push(`  page: ${JSON.stringify(read?.page)}`);
    log.push(`  focus: ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120) ?? "none")}`);
    // Whether a held key reaches the game at all.
    await page.keyboard.down("ArrowLeft");
    await sleep(500);
    const heldNow = await page.evaluate(async () => {
      const h = (window as unknown as { __pokehd?: { read(a: number, n: number): Promise<number[]> } }).__pokehd;
      return h ? (await h.read(0xffb4, 1))[0] : null;
    });
    await page.keyboard.up("ArrowLeft");
    log.push(`  hJoyHeld while Left is held = ${heldNow?.toString(16)}, facing after: ${(await hooked(page))?.state?.player.facing}`);
    at.forEach(([n], i) => log.push(`  ${n} = ${read?.bytes[i]?.toString(16)}`));
    log.push(`  state: ${JSON.stringify((await hooked(page))?.state)?.slice(0, 600)}`);
    await page.screenshot({ path: test.info().outputPath("stuck.png"), timeout: 90_000 }).catch(() => {});
  };

  /** Playing: frames advance, the player is in the world, and turning turns them. */
  const responsive = async (what: string) => {
    try {
      await answers(what);
    } catch (e) {
      await diagnose();
      throw new Error(`${(e as Error).message.split("\n")[0]}\n${log.join("\n")}`);
    }
  };
  const answers = async (what: string) => {
    await expect.poll(async () => (await hooked(page))?.inWorld ?? false, { timeout: 60_000, message: `${what}: never reached the world\n${log.join("\n")}` }).toBe(true);
    const before = (await hooked(page))!.frames;
    await sleep(1000);
    expect((await hooked(page))!.frames, `${what}: the emulator stopped\n${log.join("\n")}`).toBeGreaterThan(before + 20);
    await p.clearDialogs();
    for (const [key, facing] of [["ArrowUp", "up"], ["ArrowDown", "down"]] as const) {
      await p.tap(key, 30);
      await expect.poll(async () => (await hooked(page))?.state?.player.facing, { timeout: 5000, message: `${what}: ${key} didn't turn the player\n${log.join("\n")}` }).toBe(facing);
    }
  };

  await page.goto("/dev/saves?stats");
  await atIntro();
  await check("first intro");
  let playing = false;

  for (let i = 0; i < steps; i++) {
    const action = playing
      ? rand.pick(["reload", "reload-mid-load", "hide-reload", "walk", "mash", "wait"] as const)
      : rand.pick(["resume", "resume", "play-other", "copy", "reload", "reload-mid-load", "hide-reload", "rename"] as const);
    log.push(`step ${i}: ${action}`);
    switch (action) {
      case "resume":
        await page.getByTestId("intro-resume").click();
        playing = true;
        await responsive(`step ${i} resume`);
        break;
      case "play-other": {
        await page.getByTestId("intro-saves").click();
        const cards = page.locator(".saves-card:not(.binned) .saves-card-main");
        const n = await cards.count();
        const pick = rand.int(n);
        log.push(`  picks card ${pick} of ${n}`);
        await cards.nth(pick).click();
        await page.getByRole("button", { name: "Play", exact: true }).click();
        playing = true;
        await responsive(`step ${i} play another`);
        break;
      }
      case "copy": {
        await page.getByTestId("intro-saves").click();
        const cards = page.locator(".saves-card:not(.binned) .saves-card-main");
        await cards.nth(rand.int(await cards.count())).click();
        await page.getByRole("button", { name: "Copy", exact: true }).click();
        await expect(page.locator(".saves-list[aria-busy='false']")).toBeVisible({ timeout: 30_000 });
        await page.getByRole("button", { name: "Back", exact: true }).click();
        break;
      }
      case "rename": {
        await page.getByTestId("intro-saves").click();
        const cards = page.locator(".saves-card:not(.binned) .saves-card-main");
        await cards.nth(rand.int(await cards.count())).click();
        const field = page.getByLabel("Name");
        await field.fill(rand.pick(["", "Ash", "Second go", "Zz"]));
        await field.press("Enter");
        await page.getByRole("button", { name: "Back", exact: true }).click();
        break;
      }
      case "walk":
        for (let k = 0; k < 4 + rand.int(12); k++) await p.step(rand.pick(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const));
        break;
      case "mash":
        for (let k = 0; k < 10 + rand.int(30); k++) {
          await p.tap(rand.pick(["z", "x", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]), 20 + rand.int(60));
          await sleep(rand.int(150));
        }
        break;
      case "wait":
        await sleep(rand.int(70_000));
        break;
      case "hide-reload":
      case "reload":
        if (action === "hide-reload") {
          await hide(page);
          await sleep(rand.int(3000));
        }
        await page.reload();
        playing = false;
        await atIntro();
        break;
      case "reload-mid-load":
        await page.reload();
        await sleep(rand.int(4000));
        await page.reload();
        playing = false;
        await atIntro();
        break;
    }
    await check(`step ${i} ${action}`);
  }
  console.log(log.join("\n"));
});
