// Layout fuzzing for the HD UI: the real game page from the late-game states that
// tools/record-ui-states.ts records (rom/fixtures/ui-*.state), driven by seeded random taps,
// keys, joystick walks, the Pokédex and turns of the phone, on phone, tablet and desktop sizes.
// After every action the page's HD UI is counted (ui-census.ts); more than one panel at once, any
// Game Boy screen showing, a toast over a panel, and anything cut off are red flags, screenshotted
// with what led to them into ui-runs/ui-fuzz/. Plays in real time, so only when asked:
//   POKEHD_UI_FUZZ=1 [POKEHD_FUZZ_SEED=1] [POKEHD_FUZZ_STEPS=40] [POKEHD_FUZZ_FIXTURES=ui-town,ui-mart]
//   pnpm exec playwright test ui-fuzz --project desktop
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, type Browser, type Page } from "@playwright/test";
import { census, redFlags } from "./ui-census.ts";

const FIXTURES = fileURLToPath(new URL("../../../rom/fixtures/", import.meta.url));
const OUT = fileURLToPath(new URL("../ui-runs/ui-fuzz/", import.meta.url));
const ALL = ["ui-town", "ui-tree", "ui-water", "ui-cave", "ui-mart", "ui-nurse", "ui-pc", "ui-leader", "ui-trainer-battle", "ui-wild-battle"];
const fixtures = (process.env.POKEHD_FUZZ_FIXTURES?.split(",") ?? ALL).filter((f) => existsSync(`${FIXTURES}${f}.state`));
const STEPS = Number(process.env.POKEHD_FUZZ_STEPS ?? 40);
const SEED = Number(process.env.POKEHD_FUZZ_SEED ?? 1);

test.describe.configure({ mode: "parallel" });
test.skip(!process.env.POKEHD_UI_FUZZ || !fixtures.length, "POKEHD_UI_FUZZ=1 and the ui-*.state fixtures (node tools/record-ui-states.ts) needed");

interface Screen { name: string; width: number; height: number; touch: boolean }
const SCREENS: Screen[] = [
  { name: "phone", width: 390, height: 844, touch: true },
  { name: "phone-landscape", width: 844, height: 390, touch: true },
  { name: "tablet", width: 820, height: 1180, touch: true },
  { name: "desktop", width: 1440, height: 900, touch: false },
];
const screens = process.env.POKEHD_FUZZ_SCREENS ? SCREENS.filter((s) => process.env.POKEHD_FUZZ_SCREENS!.split(",").includes(s.name)) : SCREENS;

/** Buttons the fuzzer never presses: they leave the game, lose progress or need a grown-up anyway. */
const NEVER = /erase|delete|sign ?out|forget|new game|new adventure|start over|reload|load it|last save|restore|reset|log ?out|cartridge|invite|copy link|toss|throw away|release/i;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 2 ** 32;
  };
}

/** What the page exposes with ?stats (Game.tsx), as far as the fuzzer reads it. */
type Hooked = Window & { __pokehd?: { inWorld: boolean; input: { ready: true; on: string } | { ready: false; why: string } | null } };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function intoTheWorld(page: Page): Promise<void> {
  for (let i = 0; i < 240; i++) {
    const ready = await page.evaluate(() => !!(window as Hooked).__pokehd?.inWorld && !document.querySelector("[data-testid=loading]"));
    if (ready) return;
    await sleep(500);
  }
  throw new Error("never reached the world");
}

/** The page's input readiness (qa-signals.ts), as a short word for the log. */
const readiness = (page: Page) =>
  page.evaluate(() => {
    const i = (window as Hooked).__pokehd?.input;
    return i ? (i.ready ? i.on : `busy:${i.why}`) : "none";
  });

async function run(browser: Browser, fixture: string, screen: Screen, seed: number) {
  const context = await browser.newContext({ viewport: { width: screen.width, height: screen.height }, hasTouch: screen.touch, isMobile: screen.touch, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const random = rng(seed * 7919 + fixture.length * 31 + screen.width);
  const pick = <T>(xs: T[]) => xs[Math.floor(random() * xs.length)]!;
  const dir = `${OUT}${fixture}/${screen.name}-s${seed}/`;
  mkdirSync(dir, { recursive: true });
  const log = (o: object) => appendFileSync(`${dir}log.jsonl`, JSON.stringify(o) + "\n");
  const seenFlags = new Set<string>();
  let shot = 0;
  let { width, height } = screen;

  // The Game Boy screen in the corner off, as for the QA player: any of it showing is then a fault.
  await page.addInitScript(() => {
    localStorage.setItem("pokehd.screen.pip.v1", "off");
    // The ?stats readout sits over the Pokédex button: let taps through it.
    addEventListener("DOMContentLoaded", () => document.head.append(Object.assign(document.createElement("style"), { textContent: ".game-stats { pointer-events: none !important; }" })));
  });
  await page.goto(`/?fixture=${fixture}&stats`);
  await intoTheWorld(page);
  await sleep(1500);

  const tapAt = async (x: number, y: number) => (screen.touch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
  const key = async (k: string, ms = 60) => {
    await page.keyboard.down(k);
    await sleep(ms);
    await page.keyboard.up(k);
  };
  const actions: { weight: number; name: string; go: () => Promise<string> }[] = [
    {
      weight: 40,
      name: "control",
      go: async () => {
        const controls = await page.evaluate((never) => {
          const out: { x: number; y: number; label: string }[] = [];
          for (const el of document.querySelectorAll<HTMLElement>("button, [role=button], [role=radio], [role=tab], [role=option], select, input[type=checkbox]")) {
            if ((el as HTMLButtonElement).disabled || el.closest(".touch-pad, .game-stats")) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 4 || r.height < 4 || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
            const label = (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 50);
            if (new RegExp(never, "i").test(label)) continue;
            const x = r.left + r.width / 2;
            const y = r.top + r.height / 2;
            // Only what's on top where it would be tapped.
            const top = document.elementFromPoint(x, y);
            if (!top || !(el === top || el.contains(top))) continue;
            out.push({ x, y, label });
          }
          return out;
        }, NEVER.source);
        if (!controls.length) return "control: none";
        const c = pick(controls);
        await tapAt(c.x, c.y);
        return `tap "${c.label}"`;
      },
    },
    { weight: 15, name: "A", go: async () => (screen.touch ? tapPad("A") : key("z").then(() => "key A")) },
    { weight: 7, name: "B", go: async () => (screen.touch ? tapPad("B") : key("x").then(() => "key B")) },
    {
      weight: 12,
      name: "walk",
      go: async () => {
        const k = pick(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
        if (!screen.touch) {
          await key(k, 150 + Math.floor(random() * 600));
          return `walk ${k}`;
        }
        const base = page.locator(".touch-stick-base");
        const stick = (await base.isVisible()) ? await base.boundingBox({ timeout: 2000 }).catch(() => null) : null;
        if (!stick) return "walk: no stick";
        const cx = stick.x + stick.width / 2;
        const cy = stick.y + stick.height / 2;
        const [dx, dy] = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[k]!;
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(cx + dx! * 40, cy + dy! * 40, { steps: 3 });
        await sleep(200 + Math.floor(random() * 600));
        await page.mouse.up();
        return `stick ${k}`;
      },
    },
    {
      weight: 8,
      name: "dex",
      go: async () => {
        const b = page.locator(".dh-button, .dh-fallback").first();
        if (!(await b.isVisible().catch(() => false))) return "dex: no button";
        await b.click({ timeout: 2000 }).catch(() => {});
        return "Pokédex button";
      },
    },
    {
      weight: 8,
      name: "tap anywhere",
      go: async () => {
        const x = Math.floor(random() * width);
        const y = Math.floor(random() * height);
        await tapAt(x, y);
        return `tap (${x}, ${y})`;
      },
    },
    {
      weight: screen.touch ? 4 : 1,
      name: "turn",
      go: async () => {
        [width, height] = [height, width];
        await page.setViewportSize({ width, height });
        return `screen to ${width}×${height}`;
      },
    },
  ];
  async function tapPad(name: "A" | "B"): Promise<string> {
    const b = page.locator(`.touch-face button[aria-label="${name}"]`);
    if (await b.isVisible().catch(() => false)) {
      await b.tap({ timeout: 2000 }).catch(() => {});
      return `pad ${name}`;
    }
    // No pad (a menu or message is up): the keyboard's button instead.
    await key(name === "A" ? "z" : "x");
    return `key ${name} (no pad)`;
  }
  const total = actions.reduce((a, b) => a + b.weight, 0);
  for (let step = 0; step < STEPS; step++) {
    let r = random() * total;
    const action = actions.find((a) => (r -= a.weight) < 0) ?? actions[0]!;
    let did: string;
    try {
      did = await Promise.race([action.go(), sleep(20_000).then(() => { throw new Error("no answer in 20 s"); })]);
    } catch (e) {
      did = `${action.name} failed: ${(e as Error).message.split("\n")[0]}`;
    }
    await sleep(700);
    const looked = await Promise.race([Promise.all([census(page), page.evaluate(() => !!(window as Hooked).__pokehd?.inWorld)]), sleep(30_000).then(() => null)]);
    if (!looked) {
      log({ step, did, hung: true, errors: errors.splice(0) });
      await page.screenshot({ path: `${dir}hung-${step}.png`, timeout: 10_000 }).catch(() => {});
      break;
    }
    const [c, inWorld] = looked;
    const flags = redFlags(c, { inWorld });
    const input = await readiness(page);
    const entry = { step, did, input, panels: c.panels.map((p) => `${p.kind}: ${p.label}`), toasts: c.toasts.map((t) => t.label), gameBoy: +c.gameBoy.toFixed(3), flags, viewport: `${width}×${height}`, errors: errors.splice(0) };
    // Screenshot each new kind of flag (what's flagged, not the words in it).
    const signature = flags.map((f) => f.replace(/\d+/g, "#").replace(/".*?"/g, '"…"')).sort().join(" | ");
    if (flags.length && !seenFlags.has(signature) && shot < 25) {
      seenFlags.add(signature);
      const file = `step-${String(step).padStart(3, "0")}.png`;
      await page.screenshot({ path: `${dir}${file}` });
      Object.assign(entry, { shot: file });
      shot++;
    }
    log(entry);
  }
  await context.close();
}

for (const fixture of fixtures)
  for (const screen of screens)
    test(`${fixture} on ${screen.name}`, async ({ browser }) => {
      test.setTimeout(30 * 60_000);
      await run(browser, fixture, screen, SEED);
    });
