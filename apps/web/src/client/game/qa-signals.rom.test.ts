// ROM test for what the page tells the QA harness (qa-signals.ts) over a real battle: the first
// rival battle, played by a player who acts the moment the page says it takes input, never
// waiting on a clock. Every tap and every move lands (none is dropped as too early), and the
// message log holds every line the box showed, the ones the game moved past by itself included
// (QA bug 65). Skips without the ROM.
import { existsSync, readFileSync } from "node:fs";
import { GameBoy } from "@pokehd/emu";
import { SYMBOLS } from "@pokehd/rom";
import { beforeAll, describe, expect, it } from "vitest";
import { playToRivalBattle } from "../../../../../packages/emu/src/testing.ts";
import { battlePage } from "./battle-page.testing.ts";

const ROM_PATH = new URL("../../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../../../../../packages/emu/src/generated/sameboy.wasm", import.meta.url);
/** Frames the harness lets pass after an action before it looks again (its 250 ms). */
const AFTER_ACTION = 15;
/** Frames an accepted tap may take to change what's on screen. */
const ACCEPT_WITHIN = 60;

describe.skipIf(!existsSync(ROM_PATH))("the page's input signal and message log in a battle", () => {
  let rom: Uint8Array;
  let wasm: Uint8Array;
  let start: Uint8Array;
  beforeAll(async () => {
    rom = new Uint8Array(readFileSync(ROM_PATH));
    wasm = new Uint8Array(readFileSync(WASM_PATH));
    const gb = await GameBoy.create({ rom, wasmBinary: wasm });
    playToRivalBattle(gb);
    start = gb.saveState();
  }, 240_000);

  it("takes every action made the moment it says it's ready, and logs every line (QA bug 65)", { timeout: 120_000 }, async () => {
    // The page's questions and answers cross to the worker a few frames late, as in the browser.
    const p = await battlePage(start, { rom, wasm, lag: 4 });
    const inBattle = () => p.gb.read(SYMBOLS.wIsInBattle.address) !== 0;
    const actions: { on: string; hd: string | null; result: string; accepted: boolean }[] = [];
    const seen: string[] = [];
    let frames = 0;
    const run = (n: number) => {
      for (let i = 0; i < n; i++, frames++) {
        p.step();
        const hd = p.hd();
        if (hd && seen.at(-1) !== hd) seen.push(hd);
      }
    };
    run(1);
    while (inBattle()) {
      if (frames > 20_000) throw new Error(`Stuck: ${JSON.stringify(actions.slice(-5))}`);
      const input = p.input();
      if (!input.ready) {
        run(1);
        continue;
      }
      const before = JSON.stringify([p.hd(), p.more(), p.asked()?.id]);
      let result: string;
      if (input.on === "battle-menu") {
        p.send({ fight: 0 });
        result = "fight";
      } else if (input.on === "message") {
        result = p.tapMessage();
      } else {
        throw new Error(`Unexpected input in a battle: ${input.on}`);
      }
      // Accepted: the tap read on (not "wait"), and the screen moved on soon after.
      let changed = false;
      for (let i = 0; i < ACCEPT_WITHIN && !changed && inBattle(); i++) {
        run(1);
        changed = JSON.stringify([p.hd(), p.more(), p.asked()?.id]) !== before;
      }
      actions.push({ on: input.on, hd: p.hd(), result, accepted: result !== "wait" && (changed || !inBattle()) });
      run(AFTER_ACTION);
    }
    expect(actions.filter((a) => !a.accepted)).toEqual([]);
    expect(actions.some((a) => a.on === "battle-menu")).toBe(true);
    expect(actions.filter((a) => a.on === "message").length).toBeGreaterThan(3);

    // Every line the box showed is in the log (a line still printing or half wiped, as part of one).
    const lines = p.log.since(0);
    const missing = seen.flatMap((box) => box.split(" / ").map((l) => l.replace("▼", "").trim())).filter((l) => l && !lines.some((x) => x.text.includes(l)));
    expect(missing).toEqual([]);
    // Read back a box at a time, the foe's moves are there, the ones the game moved past by itself
    // included: more boxes went by than the player tapped (QA bug 65).
    const boxes: string[] = [];
    lines.forEach((l, i) => (i && lines[i - 1]!.group === l.group ? (boxes[boxes.length - 1] += ` ${l.text}`) : boxes.push(l.text)));
    expect(boxes).toContain("Enemy BULBASAUR used GROWL!");
    expect(boxes).toContain("SQUIRTLE used TACKLE!");
    expect(boxes.at(-1)).toMatch(/for winning!$/);
    expect(boxes.length).toBeGreaterThan(actions.filter((a) => a.on === "message").length);
  });
});
