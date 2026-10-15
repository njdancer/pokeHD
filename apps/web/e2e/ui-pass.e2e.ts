// A scripted pass over the HD UI, through the game's own paths: the late-game states that
// tools/record-ui-states.ts records (rom/fixtures/ui-*.state), and in each one what a player
// does there (the Mart's buy and sell, the PC, the nurse, every Pokédex tab and team member's
// verbs, field moves, a wild and a trainer battle's menus). After every step the HD UI is counted
// (ui-census.ts) and screenshotted into ui-runs/ui-pass/<scene>/; a step whose button never
// shows, more than one panel, or any Game Boy screen is logged as a finding. Plays in real time:
//   POKEHD_UI_PASS=1 [POKEHD_PASS_SCENES=mart,pc] [POKEHD_PASS_SCREEN=phone|desktop] pnpm exec playwright test ui-pass --project desktop
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, type Locator } from "@playwright/test";
import { census, redFlags } from "./ui-census.ts";

const FIXTURES = fileURLToPath(new URL("../../../rom/fixtures/", import.meta.url));
const OUT = fileURLToPath(new URL("../ui-runs/ui-pass/", import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Hooked = Window & { __pokehd?: { inWorld: boolean; input: { ready: true; on: string } | { ready: false; why: string } | null } };

test.skip(!process.env.POKEHD_UI_PASS || !existsSync(`${FIXTURES}ui-town.state`), "POKEHD_UI_PASS=1 and the ui-*.state fixtures (node tools/record-ui-states.ts) needed");
test.describe.configure({ mode: "parallel" });

const SCREEN = process.env.POKEHD_PASS_SCREEN === "desktop" ? { width: 1440, height: 900, touch: false } : { width: 390, height: 844, touch: true };

/** One thing a player does. Strings and regexes name a button (its accessible name). */
type Step =
  | { a: true }
  | { b: true }
  | { tap: string | RegExp; optional?: boolean; nth?: number }
  | { dex: true }
  | { tab: "Pokémon" | "People" | "Inventory" | "Map" | "Me" }
  | { face: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" }
  | { until: "free" | "battle-menu" | "sheet" | "menu" | "message"; ms?: number }
  | { wait: number }
  | { note: string };

interface Scene { name: string; fixture: string; steps: Step[] }

/** Each team member's screen and verbs, from the Inventory tab. */
const TEAM = ["BLASTOISE", "SKY", "VENUSAUR", "CHANSEY", "DUGTRIO", "SPOONS"].flatMap((m): Step[] => [{ tab: "Inventory" }, { tap: new RegExp(m, "i") }, { wait: 600 }]);

const SCENES: Scene[] = [
  {
    name: "dex-tabs",
    fixture: "ui-town",
    steps: [{ dex: true }, { tab: "Pokémon" }, { tap: /Caught/ }, { tap: /001/ }, { tab: "People" }, { tab: "Inventory" }, { tab: "Map" }, { tap: "Places", optional: true }, { tab: "Me" }, { tab: "Inventory" }],
  },
  { name: "team-verbs", fixture: "ui-town", steps: [{ dex: true }, ...TEAM] },
  {
    name: "bag-items",
    fixture: "ui-town",
    steps: [
      { dex: true },
      { tab: "Inventory" },
      ...["Potion", "Poké Ball", "Escape Rope", "Repel", "Bicycle", "Old Rod", "Itemfinder", "Poké Flute", "Town Map", "X Attack", "Rare Candy", "Fire Stone", "TM01", "HM03", "Coin Case"].flatMap((item): Step[] => [{ tab: "Inventory" }, { tap: new RegExp(`^${item}`, "i"), optional: true }, { wait: 400 }]),
    ],
  },
  { name: "bike", fixture: "ui-town", steps: [{ dex: true }, { tab: "Inventory" }, { tap: /^Bicycle/i }, { tap: /Ride it/ }, { until: "free" }, { dex: true }, { tab: "Inventory" }, { tap: /^Bicycle/i }, { tap: /Get off/ }, { until: "free" }] },
  { name: "cut", fixture: "ui-tree", steps: [{ dex: true }, { tab: "Inventory" }, { tap: /VENUSAUR/i }, { tap: /Use CUT/ }, { until: "free", ms: 20_000 }, { wait: 1500 }] },
  { name: "surf", fixture: "ui-water", steps: [{ dex: true }, { tab: "Inventory" }, { tap: /BLASTOISE/i }, { tap: /Use SURF/ }, { until: "free", ms: 20_000 }, { wait: 1500 }] },
  { name: "fish", fixture: "ui-water", steps: [{ dex: true }, { tab: "Inventory" }, { tap: /^Super Rod/i }, { tap: /^Fish/ }, { until: "free", ms: 20_000 }, { a: true }, { wait: 1500 }] },
  { name: "fly", fixture: "ui-town", steps: [{ dex: true }, { tab: "Inventory" }, { tap: /SKY/i }, { tap: /Fly somewhere/ }, { tap: /Cerulean/i }, { until: "free", ms: 30_000 }, { wait: 2000 }] },
  { name: "flash-dig", fixture: "ui-cave", steps: [{ dex: true }, { tab: "Inventory" }, { tap: /VENUSAUR/i }, { tap: /Use FLASH/ }, { until: "free", ms: 20_000 }, { dex: true }, { tab: "Inventory" }, { tap: /DUGTRIO/i }, { tap: /Use DIG/ }, { until: "free", ms: 30_000 }, { wait: 2000 }] },
  { name: "softboiled", fixture: "ui-town", steps: [{ dex: true }, { tab: "Inventory" }, { tap: /CHANSEY/i }, { tap: /SOFTBOILED/ }, { tap: /SKY/i }, { tap: /Give SKY/i }, { until: "free", ms: 20_000 }, { wait: 1000 }] },
  {
    name: "mart",
    fixture: "ui-mart",
    steps: [
      { a: true },
      { until: "menu" },
      { tap: "BUY" },
      { until: "sheet" },
      { tap: /^Potion/i },
      { tap: "More" },
      { tap: "More" },
      { tap: /^Buy 3/ },
      { wait: 2500 },
      { tap: /Back to the game|Cancel/, optional: true },
      { until: "menu" },
      { tap: "SELL" },
      { until: "sheet" },
      { tap: /^Antidote/i },
      { tap: /Sell some/ },
      { tap: /^Sell 1/ },
      { wait: 2500 },
      { tap: /Back to the game|Cancel/, optional: true },
      { until: "menu" },
      { tap: "QUIT" },
      { until: "free" },
    ],
  },
  { name: "nurse", fixture: "ui-nurse", steps: [{ a: true }, { until: "sheet" }, { tap: /^Heal/ }, { until: "free", ms: 30_000 }] },
  {
    name: "pc",
    fixture: "ui-pc",
    steps: [
      { a: true },
      { until: "menu" },
      { tap: /BILL's PC|SOMEONE's PC/i },
      { until: "menu" },
      { tap: /DEPOSIT/i },
      { until: "sheet" },
      { tap: /SPOONS/i },
      { tap: /Put it in the PC/ },
      { until: "menu", ms: 20_000 },
      { tap: /WITHDRAW/i },
      { until: "sheet" },
      { tap: /^Take/ },
      { until: "menu", ms: 20_000 },
      { tap: /SEE YA|LOG OFF|CANCEL/ },
      { until: "menu", ms: 10_000 },
      { tap: /LOG OFF/, optional: true },
      { until: "free", ms: 20_000 },
    ],
  },
  {
    name: "wild-battle",
    fixture: "ui-wild-battle",
    steps: [
      { until: "battle-menu", ms: 30_000 },
      { tap: /PKMN|Pokémon|Team/i },
      { wait: 1500 },
      { b: true },
      { until: "battle-menu", ms: 20_000 },
      { tap: /BAG|Bag/ },
      { wait: 1500 },
      { b: true },
      { until: "battle-menu", ms: 20_000 },
      { tap: /FIGHT|Fight/ },
      { wait: 1000 },
      { tap: /HYDRO PUMP|Hydro Pump/i },
      { until: "free", ms: 60_000 },
    ],
  },
  {
    name: "trainer-battle",
    fixture: "ui-trainer-battle",
    steps: [
      { until: "battle-menu", ms: 40_000 },
      { tap: /RUN|Run/ },
      { wait: 2500 },
      { tap: /FIGHT|Fight/ },
      { wait: 1000 },
      { tap: /SURF|Surf/i },
      { until: "battle-menu", ms: 60_000 },
      { tap: /BAG|Bag/ },
      { wait: 1500 },
      { tap: /^Potion/i, optional: true },
      { wait: 1500 },
    ],
  },
];
const only = process.env.POKEHD_PASS_SCENES?.split(",");

for (const scene of SCENES.filter((s) => !only || only.includes(s.name)))
  test(`HD UI pass: ${scene.name}`, async ({ browser }) => {
    test.setTimeout(15 * 60_000);
    const context = await browser.newContext({ viewport: { width: SCREEN.width, height: SCREEN.height }, hasTouch: SCREEN.touch, isMobile: SCREEN.touch, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const dir = `${OUT}${scene.name}/`;
    mkdirSync(dir, { recursive: true });
    const log = (o: object) => appendFileSync(`${dir}log.jsonl`, JSON.stringify(o) + "\n");
    await page.addInitScript(() => {
      localStorage.setItem("pokehd.screen.pip.v1", "off");
      // The ?stats readout sits over the Pokédex button: let taps through it.
      addEventListener("DOMContentLoaded", () => document.head.append(Object.assign(document.createElement("style"), { textContent: ".game-stats { pointer-events: none !important; }" })));
    });
    await page.goto(`/?fixture=${scene.fixture}&stats`);
    for (let i = 0; i < 240; i++) {
      if (await page.evaluate(() => !!(window as Hooked).__pokehd?.inWorld && !document.querySelector("[data-testid=loading]"))) break;
      await sleep(500);
    }
    await sleep(2000);
    const input = () => page.evaluate(() => { const i = (window as Hooked).__pokehd?.input; return i ? (i.ready ? i.on : `busy:${i.why}`) : "none"; });
    const press = async (k: string) => {
      const pad = page.locator(`.touch-face button[aria-label="${k === "z" ? "A" : "B"}"]`);
      if (SCREEN.touch && (await pad.isVisible())) return pad.tap();
      await page.keyboard.down(k);
      await sleep(60);
      await page.keyboard.up(k);
    };
    // A button pressed as the page's own click: in a headless browser the 3D dex can hold the main
    // thread long enough that Playwright's pointer events time out after the press has landed.
    // A busy page (shaders compiling, a big town's first frames) gets two more tries.
    const hit = async (target: Locator) => {
      for (let tries = 3; ; tries--) {
        try {
          await target.waitFor({ state: "visible", timeout: 15_000 });
          await target.evaluate((el) => (el as HTMLElement).click(), undefined, { timeout: 15_000 });
          return;
        } catch (e) {
          if (tries <= 1) throw e;
          await sleep(3000);
        }
      }
    };
    for (const [n, step] of scene.steps.entries()) {
      let did = JSON.stringify(step, (_, v) => (v instanceof RegExp ? String(v) : v));
      let missing = false;
      try {
        if ("a" in step) await press("z");
        else if ("b" in step) await press("x");
        else if ("dex" in step) await hit(page.locator(".dh-button, .dh-fallback").first());
        else if ("tab" in step) await hit(page.getByRole("navigation", { name: "Pokédex" }).getByRole("button", { name: step.tab }).first());
        else if ("face" in step) {
          await page.keyboard.down(step.face);
          await sleep(80);
          await page.keyboard.up(step.face);
        } else if ("tap" in step) {
          const target = page.getByRole("button", { name: step.tap }).or(page.getByRole("radio", { name: step.tap })).filter({ visible: true }).nth(step.nth ?? 0);
          try {
            await hit(target);
          } catch {
            missing = !step.optional;
            did += step.optional ? " (not there, optional)" : " NOT FOUND";
          }
        } else if ("until" in step) {
          const end = Date.now() + (step.ms ?? 12_000);
          let now = "";
          // A message on the way is read on, as a player would (A once it has stopped typing).
          let lastA = Date.now();
          while (Date.now() < end && (now = await input()) !== step.until) {
            if (now === "message" && step.until !== "message" && Date.now() - lastA > 1500) {
              await press("z");
              lastA = Date.now();
            }
            await sleep(250);
          }
          if (now !== step.until) {
            missing = true;
            did += ` NEVER (still ${now})`;
          }
        } else if ("wait" in step) await sleep(step.wait);
      } catch (e) {
        missing = true;
        did += ` FAILED: ${(e as Error).message.split("\n")[0]}`;
      }
      await sleep(700);
      // A page that stops answering (a battle at a frame a second) ends the scene rather than the run.
      const c = await Promise.race([census(page), sleep(60_000).then(() => null)]);
      if (!c) {
        log({ step: n, did, hung: true, errors: errors.splice(0) });
        break;
      }
      const inWorld = await page.evaluate(() => !!(window as Hooked).__pokehd?.inWorld);
      const flags = redFlags(c, { inWorld });
      if (missing) flags.unshift(`step didn't happen: ${did}`);
      const file = `${String(n).padStart(2, "0")}.png`;
      await page.screenshot({ path: `${dir}${file}` });
      log({ step: n, did, input: await input(), panels: c.panels.map((p) => `${p.kind}: ${p.label}`), toasts: c.toasts.map((t) => t.label), gameBoy: +c.gameBoy.toFixed(3), flags, shot: file, errors: errors.splice(0) });
    }
    await context.close();
  });
