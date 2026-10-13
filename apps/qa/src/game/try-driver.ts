// Tries the game driver end to end against a running dev server (`pnpm dev`):
//   node apps/qa/src/game/try-driver.ts [appUrl] [--fresh] [--no-render] [--headed] [--stream] [--out <dir>]
// Opens the game page alone ("game" mode; --stream opens the stream page instead), starts a new game (--fresh clears the profile first),
// reads through the introduction by tapping what the outcomes offer, walks about with the
// joystick, then restarts from now and from the last save, printing every Outcome. Screenshots,
// a contact sheet and an evidence folder go to --out (default a scratch folder under the OS temp).
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { createDriver } from "./driver.ts";
import type { Outcome } from "./types.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const outIndex = args.indexOf("--out");
const out = outIndex >= 0 ? args[outIndex + 1]! : join(tmpdir(), "pokehd-try-driver");
const appUrl = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--out") ?? "http://localhost:5173";
const runDir = join(out, "run");
if (flag("--fresh")) rmSync(join(out, "profile"), { recursive: true, force: true });
mkdirSync(runDir, { recursive: true });

const driver = createDriver({
  appUrl,
  ...(flag("--stream") ? {} : { streamPath: "game" }),
  runDir,
  headless: !flag("--headed"),
  ...(flag("--no-render") ? { gameQuery: "stats&qa&render=0" } : {}),
});

let turn = 0;
const show = (what: string, o: Outcome) => console.log(`\n=== ${++turn}. ${what}\n${o.text}`);
/** Where the outcome says a button is, the way the player reads it. */
const button = (o: Outcome, label: RegExp): [number, number] | null => {
  for (const m of o.text.matchAll(/\[([^\]]+)\] at \((\d+),(\d+)\)/g)) if (label.test(m[1]!)) return [Number(m[2]), Number(m[3])];
  return null;
};

try {
  let o = await driver.start();
  show("start", o);
  // Through the start screen and Oak's introduction to the bedroom.
  for (let i = 0; i < 150 && !o.text.includes("Legend:"); i++) {
    const at =
      button(o, /^(Start my adventure|Continue|That's me!|OK)$/) ??
      button(o, /^ASH$/) ??
      button(o, /message box/) ??
      button(o, /^(YES|NEXT)$/i);
    if (!at) {
      o = await driver.wait(1000);
      if (i % 5 === 0) show("wait", o);
      continue;
    }
    driver.markTurn(turn + 1);
    o = await driver.tap(...at);
    show(`tap (${at.join(",")})`, o);
  }

  for (const [dir, n] of [["down", 2], ["left", 3], ["up", 1], ["right", 4], ["up", 3]] as const) {
    driver.markTurn(turn + 1);
    show(`joystick ${dir} ${n}`, await driver.joystick([{ direction: dir, tiles: n }]));
  }
  const walkTurn = turn;
  // The bookshelf or whatever is ahead: press A on the pad.
  const a = button(o, /^A$/);
  if (a) show("tap A", await driver.tap(...a));

  writeFileSync(join(out, "screenshot.png"), await driver.screenshot());
  writeFileSync(join(out, "contact.png"), await driver.contactSheet(walkTurn, 1, 2, 3));
  console.log("\nstatus:", await driver.status());
  console.log("glitches:", driver.takeGlitches());
  console.log("evidence:", await driver.collectEvidence(join(out, "evidence"), turn));

  // Restart from now: the same spot. Then from the save: back to the last save (or its start screen).
  show("joystick down 2 (before restarts)", await driver.joystick([{ direction: "down", tiles: 2 }]));
  show("restart (now)", await driver.restart());
  writeFileSync(join(out, "after-restart-now.png"), await driver.screenshot());
  show("restart (save)", await driver.restart({ from: "save" }));
  writeFileSync(join(out, "after-restart-save.png"), await driver.screenshot());
  console.log("\nglitches:", driver.takeGlitches());
  console.log(`\nFiles in ${out}`);
} finally {
  await driver.close();
}
