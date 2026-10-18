// Runs one Pokédex menu action on a saved emulator state, with the hooks the game page installs,
// and says what happened: whether the idle point came, why not, and the team before and after.
// For a player's report that a menu action did nothing: get their resume point (gzipped or not)
// and run `node tools/try-action.ts <state> '<action json>'`, e.g. '{"kind":"move-mon","from":2,"to":0}'.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { AutoSave, busyReason, Controls, DexGuard, GameActions, GameAsks, GameBoy, GiftDesk, JournalHooks, SafePoint, type GameAction } from "../packages/emu/src/index.ts";
import { MAP_NAMES, monName, SYMBOLS } from "../packages/rom/src/index.ts";

const [path, json] = process.argv.slice(2);
if (!path || !json) throw new Error("usage: node tools/try-action.ts <state> '<action json>'");
const rom = new Uint8Array(readFileSync(new URL("../rom/pokeblue.gb", import.meta.url)));
const raw = readFileSync(path);
const state = new Uint8Array(raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw);
const gb = await GameBoy.create({ rom, wasmBinary: readFileSync(new URL("../packages/emu/src/generated/sameboy.wasm", import.meta.url)) });
gb.loadState(state);

// As the worker sets them up for the game page, in its order.
new GiftDesk(gb, { rom, emit: () => {} });
new JournalHooks(gb, { rom, emit: () => {} });
new AutoSave(gb, { rom, skipped: () => {}, saved: () => {} });
const dex = new DexGuard(gb, { rom, onOpen: (o) => console.log("dex opened", o), onClosed: () => {}, onTalk: () => {}, onBeat: () => {} }, (m) => gb.setButtons(m));
new Controls(gb, { setButtons: (m) => dex.setButtons(m), script: { message: () => {}, end: () => {}, press: () => {} } });
const actions = new GameActions(gb, { rom });
new GameAsks(gb, { rom, busy: () => actions.pending > 0 && SafePoint.of(gb).calling, onAsk: (id, ask) => console.log("asked", id, JSON.stringify(ask)) });

const r = (name: keyof typeof SYMBOLS) => gb.read(SYMBOLS[name].address);
const team = () => Array.from({ length: r("wPartyCount") }, (_, i) => monName(rom, gb.read(SYMBOLS.wPartySpecies.address + i))).join(", ");
console.log(`map ${MAP_NAMES[r("wCurMap")]} (${r("wXCoord")}, ${r("wYCoord")}), busy: ${busyReason(gb) ?? "no"}`);
console.log(`team: ${team()}`);

let result: unknown;
actions.run(JSON.parse(json) as GameAction, (res) => (result = res));
let loops = 0;
const stop = gb.addHook("OverworldLoop", () => loops++);
for (let f = 0; f < 1800 && result === undefined; f++) {
  gb.setButtons(0);
  gb.runFrame();
  if (f % 120 === 0) console.log(`frame ${f}: pc ${gb.registers.pc.toString(16)}, overworld loops ${loops}, busy: ${busyReason(gb) ?? "no"}`);
}
stop();
console.log("result:", JSON.stringify(result) ?? "never ran in 30 s");
console.log(`team: ${team()}`);
