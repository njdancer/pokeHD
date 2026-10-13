// The Pokédex in the snapshot: StarterDex's temporary owned flags (Oak's lab) are never counted
// as caught. The ROM test runs the real StarterDex and skips without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { SYMBOLS } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { GameBoy } from "../core.ts";
import { DexGuard } from "../dex-guard.ts";
import { SafePoint } from "../gifts/safepoint.ts";
import { playIntro } from "../testing.ts";
import { decodeSnapshot, dexProgress, SNAPSHOT_RANGES, type GameSnapshot } from "./snapshot.ts";

const ROM_PATH = new URL("../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../generated/sameboy.wasm", import.meta.url);

const flagBytes = (...dex: number[]) => {
  const out = new Uint8Array(19);
  for (const n of dex) out[(n - 1) >> 3]! |= 1 << ((n - 1) & 7);
  return out;
};

describe("dexProgress", () => {
  it("counts what the player has seen and owns", () => {
    const p = dexProgress(flagBytes(7, 16), flagBytes(7, 16, 19, 151));
    expect([...p.owned]).toEqual([7, 16]);
    expect([...p.seen]).toEqual([7, 16, 19, 151]);
    expect(p.onShow.size).toBe(0);
  });

  it("doesn't count StarterDex's starters as caught", () => {
    // StarterDex: ld a, %01001011 (001, 002, 004, 007); ld [wPokedexOwned], a. Nothing seen yet.
    const p = dexProgress(flagBytes(1, 2, 4, 7), new Uint8Array(19));
    expect(p.owned.size).toBe(0);
    expect(p.seen.size).toBe(0);
    expect([...p.onShow]).toEqual([1, 2, 4, 7]);
  });
});

describe.skipIf(!existsSync(ROM_PATH))("Snapshot during StarterDex", () => {
  it("shows the starter's page in full without owning anything", async () => {
    const rom = new Uint8Array(readFileSync(ROM_PATH));
    const gb = await GameBoy.create({ rom, wasmBinary: readFileSync(WASM_PATH) });
    playIntro(gb);
    // Bulbasaur's internal index is $99, as Oak's lab sets it before StarterDex.
    gb.write(SYMBOLS.wPokedexNum.address, 0x99);
    const read = () => decodeSnapshot(SNAPSHOT_RANGES.map(([a, n]) => gb.readBytes(a, n)));
    let during: GameSnapshot | undefined;
    let closed = false;
    const guard = new DexGuard(gb, {
      rom,
      onOpen: () => {
        during = read();
        guard.close();
      },
      onClosed: () => (closed = true),
    });
    const safe = SafePoint.of(gb);
    const { bank, address } = SYMBOLS.StarterDex;
    safe.enqueue({ scratch: [], steps: [{ routine: "Bankswitch", registers: () => ({ bc: bank << 8, hl: address }) }] });
    for (let frame = 0; frame < 3000 && !closed; frame++) {
      guard.frame();
      gb.runFrame();
    }
    for (let i = 0; i < 600 && safe.pending > 0; i++) gb.runFrame();
    expect(closed).toBe(true);
    expect(during?.owned.size).toBe(0);
    expect([...(during?.onShow ?? [])]).toEqual([1, 2, 4, 7]);
    // StarterDex has put wPokedexOwned back.
    const after = read();
    expect(after.owned.size).toBe(0);
    expect(after.onShow.size).toBe(0);
  }, 60_000);
});
