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

describe("decodeSnapshot's team and box", () => {
  // A blank read of every range, with the party (and box) filled in by each test.
  const blank = () => SNAPSHOT_RANGES.map(([, n]) => new Uint8Array(n));
  const CHARMELEON = 0xb2;
  const GEODUDE = 0xa9;
  const PARTY_STRUCTS = 1 + 6 + 1;
  const BOX_STRUCTS = 1 + 20 + 1;

  it("leaves out a just-caught Pokémon while the game asks for its nickname (QA bug 49)", () => {
    // _AddPartyMon has bumped wPartyCount and written wPartySpecies, then waits in AskName
    // before it writes the new party_struct: its species byte is still 0.
    const bytes = blank();
    const party = bytes[0]!;
    party.set([2, CHARMELEON, GEODUDE, 0xff]);
    party[PARTY_STRUCTS] = CHARMELEON;
    party[PARTY_STRUCTS + 33] = 27;
    expect(decodeSnapshot(bytes).team.map((m) => [m.species, m.level])).toEqual([[CHARMELEON, 27]]);
    // Named (or not), the struct is written and the Pokémon joins the team.
    party[PARTY_STRUCTS + 44] = GEODUDE;
    expect(decodeSnapshot(bytes).team.map((m) => m.species)).toEqual([CHARMELEON, GEODUDE]);
  });

  it("leaves out a half-written box entry the same way", () => {
    const bytes = blank();
    const box = bytes[5]!;
    box.set([2, GEODUDE, GEODUDE, 0xff]);
    box[BOX_STRUCTS] = GEODUDE;
    expect(decodeSnapshot(bytes).box.map((m) => m.species)).toEqual([GEODUDE]);
  });
});
