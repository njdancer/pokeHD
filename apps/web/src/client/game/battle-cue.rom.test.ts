// ROM test for the HD message box's ▼ in a battle (QA bug 56). The game prints each message once,
// but keeps some up by itself: "RED defeated BLUE!" while the trainer slides back in, "SQUIRTLE
// used TACKLE!" through the move's animation. A tap on those then does nothing, and before the ▼
// showed only when a tap would read on, the same message seemed to come back on every tap. In the
// first rival battle, won in one hit: the ▼ is up exactly when a tap reads on a whole message, and
// a player who waits for it reads every message once, in order, with no tap wasted. Skips without
// the ROM.
import { existsSync, readFileSync } from "node:fs";
import { GameBoy } from "@pokehd/emu";
import { SYMBOLS } from "@pokehd/rom";
import { beforeAll, describe, expect, it } from "vitest";
import { playToRivalBattle } from "../../../../../packages/emu/src/testing.ts";
import { battlePage } from "./battle-page.testing.ts";

const ROM_PATH = new URL("../../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../../../../../packages/emu/src/generated/sameboy.wasm", import.meta.url);

describe.skipIf(!existsSync(ROM_PATH))("the HD message box's ▼ in a battle", () => {
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

  /** To the battle menu, the rival's BULBASAUR down to 1 HP, then TACKLE and on to the end. */
  async function win(cue: boolean) {
    const p = await battlePage(start, { rom, wasm });
    p.play(() => p.asked() !== null, { cue });
    p.gb.write(SYMBOLS.wEnemyMonHP.address, 0);
    p.gb.write(SYMBOLS.wEnemyMonHP.address + 1, 1);
    return p.answer({ fight: 0 }, () => p.gb.read(SYMBOLS.wIsInBattle.address) === 0, { cue });
  }

  it("is up exactly when a tap reads on a whole message (QA bug 56)", { timeout: 120_000 }, async () => {
    // A player tapping every so often, whatever the box shows.
    const { taps } = await win(false);
    const whole = taps.filter((t) => t.tap !== "none");
    expect(whole.some((t) => t.hd.includes("defeated"))).toBe(true);
    for (const t of whole) expect({ hd: t.hd, more: t.more }).toEqual({ hd: t.hd, more: t.tap === "next" || t.tap === "close" });
  });

  it("lets a player who waits for it read each message once, in order (QA bug 56)", { timeout: 120_000 }, async () => {
    const { taps, hd } = await win(true);
    // A tap on the ▼ always reads on: a whole message's next box or its end, or the game's own
    // text's wait (the tap goes to the game). Each whole message took one.
    const cued = taps.filter((t) => t.more);
    expect(cued.filter((t) => (t.message === null ? t.tap !== "none" : t.tap !== "next" && t.tap !== "close"))).toEqual([]);
    const messages = cued.filter((t) => t.message !== null).map((t) => t.message);
    expect(new Set(messages).size).toBe(messages.length);
    const defeated = hd.filter((h) => h.includes("defeated"));
    expect(defeated).toHaveLength(1);
    expect(hd.at(-1)).toMatch(/for winning!$/);
  });
});
