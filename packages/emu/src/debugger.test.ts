import { existsSync, readFileSync } from "node:fs";
import { SYMBOLS } from "@pokehd/rom";
import { beforeAll, describe, expect, it } from "vitest";
import { GameBoy } from "./core.ts";
import { Debugger, placeKey } from "./debugger.ts";
import { playIntro } from "./testing.ts";

const ROM_PATH = new URL("../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("./generated/sameboy.wasm", import.meta.url);

describe.skipIf(!existsSync(ROM_PATH))("Debugger", () => {
  let dbg: Debugger;

  beforeAll(async () => {
    const rom = new Uint8Array(readFileSync(ROM_PATH));
    const gb = await GameBoy.create({ rom, wasmBinary: readFileSync(WASM_PATH) });
    playIntro(gb);
    dbg = new Debugger(gb, rom);
  }, 60_000);

  it("steps one instruction at a time", () => {
    // Step until PC is somewhere with a plain 1-byte instruction, then check PC moved by one.
    for (let i = 0; i < 100_000; i++) {
      const pc = dbg.gb.registers.pc;
      const op = dbg.gb.read(pc);
      // ld r, r' (not halt): always 1 byte and never branches.
      if (op >= 0x40 && op < 0x80 && op !== 0x76) {
        dbg.step();
        expect(dbg.gb.registers.pc).toBe(pc + 1);
        return;
      }
      dbg.step();
    }
    throw new Error("no ld r, r' found");
  });

  it("runs whole frames and records coverage", () => {
    const frames = dbg.frames;
    for (let i = 0; i < 10; i++) expect(dbg.run()).toBe("frame");
    expect(dbg.frames).toBe(frames + 10);
    expect(dbg.coverage[SYMBOLS.DelayFrame.address]).toBeGreaterThan(0);
  });

  it("stops at breakpoints with a call stack", () => {
    dbg.breakpoints.add(placeKey(0, SYMBOLS.DelayFrame.address));
    let reason = "";
    for (let i = 0; i < 10 && reason !== "breakpoint"; i++) reason = dbg.run();
    dbg.breakpoints.clear();
    expect(reason).toBe("breakpoint");
    expect(dbg.gb.registers.pc).toBe(SYMBOLS.DelayFrame.address);
    const top = dbg.stack.at(-1)!;
    expect(top.to.pc).toBe(SYMBOLS.DelayFrame.address);
    // Stepping out returns to just after the call.
    expect(dbg.stepOut()).toBe("returned");
    expect(dbg.gb.registers.pc).toBe(top.from.pc + 3);
    expect(dbg.stack.at(-1)).not.toBe(top);
  });

  it("knows the switched-in bank", () => {
    for (let i = 0; i < 200_000; i++) {
      dbg.step();
      const { pc } = dbg.gb.registers;
      if (pc >= 0x4000 && pc < 0x8000) break;
    }
    const { bank, pc } = dbg.place;
    expect(bank).toBeGreaterThan(0);
    expect(dbg.gb.read(pc)).toBe(dbg.rom[bank * 0x4000 + pc - 0x4000]);
  });
});
