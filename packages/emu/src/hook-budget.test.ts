// Everything the worker can turn on at once fits in the core's native hook slots: the page's
// guards, the Pokédex menu's game hooks, the play journal and the HD map's block watch together. Skips without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AutoSave } from "./autosave.ts";
import { BlockWatch } from "./block-watch.ts";
import { Controls } from "./controls.ts";
import { GameBoy } from "./core.ts";
import { DexGuard } from "./dex-guard.ts";
import { EraseGuard } from "./erase-guard.ts";
import { GameActions } from "./game/actions.ts";
import { GameAsks } from "./game/asks.ts";
import { BattleMenus } from "./game/battle-menus.ts";
import { GiftDesk } from "./gifts/desk.ts";
import { JournalHooks } from "./journal-hooks.ts";

const ROM_PATH = new URL("../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("./generated/sameboy.wasm", import.meta.url);

describe.skipIf(!existsSync(ROM_PATH))("the hook budget (ROM)", () => {
  it("has room for every feature at once", async () => {
    const rom = new Uint8Array(readFileSync(ROM_PATH));
    const gb = await GameBoy.create({ rom, wasmBinary: new Uint8Array(readFileSync(WASM_PATH)) });
    const none = () => {};
    new GiftDesk(gb, { rom, emit: none });
    new JournalHooks(gb, { rom, emit: none });
    new AutoSave(gb, { rom, skipped: none, saved: none });
    new EraseGuard(gb, { rom, onPrompt: none, onAnswered: none });
    new DexGuard(gb, { rom, onOpen: none, onClosed: none, onTalk: none, onBeat: none });
    const controls = new Controls(gb, { setButtons: none, names: { ask: none, done: none }, script: { message: none, end: none, press: none } });
    controls.setScriptText(rom);
    const actions = new GameActions(gb, { rom });
    new GameAsks(gb, { rom, busy: () => actions.pending > 0, onAsk: none });
    new BattleMenus(gb, { rom, onAsk: none });
    new BlockWatch(gb, none);
    // 48 when written, 52 with BlockWatch; hooks added lazily (while a message or a call is under way) need room too.
    expect(gb.hookCount, "native hooks in use").toBeLessThanOrEqual(56);
  });
});
