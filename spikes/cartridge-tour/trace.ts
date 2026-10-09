// Ground-truth trace of Pallet Town loading and a short walk, for checking the tour's model.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Button, GameBoy } from "../packages/emu/src/core.ts";
import { playIntro } from "../packages/emu/src/testing.ts";
import { MAP_NAMES, SYMBOLS } from "../packages/rom/src/index.ts";

const OUT = process.argv[2]!;
mkdirSync(OUT, { recursive: true });
const ROM = readFileSync(new URL("../rom/pokeblue.gb", import.meta.url));
const syms: Record<string, string> = JSON.parse(readFileSync(process.argv[3]!, "utf8"));
const at = (n: string) => { const [b, a] = syms[n]!.split(":"); return { bank: parseInt(b!, 16), address: parseInt(a!, 16) }; };
const gb = await GameBoy.create({ rom: ROM, wasmBinary: readFileSync(new URL("../packages/emu/src/generated/sameboy.wasm", import.meta.url)) });
const map = (name: string) => MAP_NAMES.indexOf(name);
const read = (name: keyof typeof SYMBOLS) => gb.read(SYMBOLS[name].address);
const where = () => [read("wCurMap"), read("wXCoord"), read("wYCoord")] as [number, number, number];
let frameNo = 0;
const frame = (b = 0) => { gb.setButtons(b); gb.runFrame(); frameNo++; };
function walk(button: number, done: (m: number, x: number, y: number) => boolean): void {
  for (let i = 0; !(done(...where()) && read("wWalkCounter") === 0); i++) { if (i > 1200) throw new Error(`Stuck ${where()}`); frame(button); }
  frame(); frame();
}
playIntro(gb);
for (let i = 0; i < 30; i++) frame();
walk(Button.Right, (_, x) => x === 5);
walk(Button.Up, (_, __, y) => y === 1);
walk(Button.Right, (m) => m === map("REDS_HOUSE_1F"));
walk(Button.Down, (_, __, y) => y === 7);
walk(Button.Left, (_, x) => x === 3);
writeFileSync(`${OUT}/before-exit.state`, gb.saveState());
// Hooks: record a full memory snapshot at each routine entry while Pallet loads.
const snap = () => {
  const r = gb.registers;
  return { frame: frameNo, ly: gb.read(0xff44), lcdc: gb.read(0xff40), bank: gb.read(0xffb8), pc: r.pc, sp: r.sp,
    mem: Buffer.from(gb.readBytes(0x8000, 0x8000)).toString("base64") };
};
const events: any[] = [];
const names = ["LoadMapData", "DisableLCD", "LoadTextBoxTilePatterns", "LoadMapHeader", "InitMapSprites", "LoadTileBlockMap",
  "LoadNorthSouthConnectionsTileMap", "LoadTilesetTilePatternData", "LoadCurrentMapView", "EnableLCD", "LoadPlayerSpriteGraphics",
  "LoadDestinationWarpPosition", "RunPaletteCommand", "EnterMap", "OverworldLoop", "RedrawRowOrColumn", "ScheduleNorthRowRedraw",
  "ScheduleSouthRowRedraw", "ScheduleEastColumnRedraw", "ScheduleWestColumnRedraw", "PrepareOAMData", "AdvancePlayerSprite", "CollisionCheckOnLand", "PlayerStepOutFromDoor", "LoadGBPal", "UpdateSprites", "VBlank", "JoypadOverworld", "DelayFrame"];
let recording = false;
const removers = names.filter((n) => syms[n]).map((n) => gb.addHook(at(n), () => {
  if (!recording) return;
  const e: any = { name: n, frame: frameNo, ly: gb.read(0xff44), bank: gb.read(0xffb8), map: read("wCurMap"), scx: gb.read(0xff43), scy: gb.read(0xff42), hscx: gb.read(0xffae), hscy: gb.read(0xffaf) };
  if (!["PrepareOAMData", "RedrawRowOrColumn", "AdvancePlayerSprite", "OverworldLoop", "LoadGBPal", "UpdateSprites", "VBlank", "JoypadOverworld", "DelayFrame"].includes(n)) Object.assign(e, snap());
  events.push(e);
}));
recording = true;
const frames: any[] = [];
const perFrame = (label: string) => {
  frames.push({ label, frame: frameNo, map: read("wCurMap"), x: read("wXCoord"), y: read("wYCoord"), scx: gb.read(0xff43), scy: gb.read(0xff42),
    hscx: gb.read(0xffae), hscy: gb.read(0xffaf), lcdc: gb.read(0xff40), bgp: gb.read(0xff47), obp0: gb.read(0xff48),
    walk: read("wWalkCounter"), mem: Buffer.from(gb.readBytes(0x8000, 0x8000)).toString("base64"),
    pixels: Buffer.from(gb.frame).toString("base64") });
};
// Exit and keep recording frames until free.
for (let i = 0; where()[0] !== map("PALLET_TOWN") || i < 200; i++) { frame(i < 60 ? Button.Down : 0); perFrame("exit"); if (i > 600) break; }
const step = (button: number, n: number, label: string) => {
  for (let k = 0; k < n; k++) {
    const [, x0, y0] = where();
    let i = 0;
    for (; i < 60; i++) { frame(button); perFrame(label); const [, x, y] = where(); if ((x !== x0 || y !== y0) && read("wWalkCounter") === 0) break; }
    for (let j = 0; j < 4; j++) { frame(); perFrame(label + "-idle"); }
  }
};
step(Button.Right, 3, "right");
step(Button.Up, 3, "up");
recording = false;
removers.forEach((r) => r());
writeFileSync(`${OUT}/events.json`, JSON.stringify(events));
writeFileSync(`${OUT}/frames.json`, JSON.stringify(frames));
console.log("events", events.length, events.filter(e=>e.mem).map((e) => `${e.name}@f${e.frame} ly${e.ly} bank${e.bank} map${e.map}`).join("\n"));
console.log("final", where(), "frames", frames.length);
