import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { SYMBOLS } from "../generated/symbols.ts";
import { labelDb } from "./db.ts";
import { bankListing, lineIndexOf, romOffset } from "./listing.ts";
import { decompressPic } from "./pic.ts";
import { decode, explain, instructionText } from "./sm83.ts";

const ROM_PATH = new URL("../../../../rom/pokeblue.gb", import.meta.url);
const VENDOR = new URL("../../../../vendor/pokered/", import.meta.url);
const bytes = (...b: number[]) => (a: number) => b[a] ?? 0;

describe("decode", () => {
  it("decodes every opcode to 1–3 bytes", () => {
    for (let op = 0; op < 256; op++) {
      const ins = decode(bytes(op, 0x12, 0x34), 0);
      expect(ins.bytes.length).toBeGreaterThanOrEqual(1);
      expect(ins.bytes.length).toBeLessThanOrEqual(3);
      expect(ins.cycles % 4).toBe(0);
      expect(explain(ins)).not.toBe("");
    }
    for (let op = 0; op < 256; op++) expect(decode(bytes(0xcb, op), 0).bytes.length).toBe(2);
  });

  it("writes rgbds syntax", () => {
    const text = (...b: number[]) => instructionText(decode((a) => b[a - 0x100] ?? 0, 0x100));
    expect(text(0x00)).toBe("nop");
    expect(text(0xc3, 0x50, 0x01)).toBe("jp $0150");
    expect(text(0x20, 0xfe)).toBe("jr nz, $0100");
    expect(text(0x2a)).toBe("ld a, [hli]");
    expect(text(0xe0, 0x40)).toBe("ldh [$ff40], a");
    expect(text(0xf8, 0xfe)).toBe("ld hl, sp - 2");
    expect(text(0xcb, 0x7c)).toBe("bit 7, h");
    expect(text(0xfe, 0x05)).toBe("cp $05");
    expect(text(0x8e)).toBe("adc a, [hl]");
    expect(text(0xd3)).toBe("db $d3");
  });

  it("gives conditional timings", () => {
    const ins = decode(bytes(0xc4, 0, 0), 0);
    expect([ins.cycles, ins.cyclesNotTaken, ins.conditional]).toEqual([24, 12, true]);
  });
});

describe("labelDb", () => {
  it("agrees with the generated symbol table", () => {
    const db = labelDb();
    expect(db.labels.length).toBeGreaterThan(20_000);
    for (const [name, sym] of Object.entries(SYMBOLS)) {
      const label = db.byName.get(name)!;
      expect([label.bank, label.address], name).toEqual([sym.bank, sym.address]);
    }
    expect(db.byName.get("OverworldLoop")?.kind).toBe("code");
    expect(db.byName.get("FontGraphics")?.kind).toBe("gfx1bpp");
    expect(db.byName.get("BulbasaurPicFront")?.kind).toBe("pic");
    expect(db.byName.get("OverworldLoop")?.file).toBe("home/overworld.asm");
    expect(db.before(0, 0x0405)?.name).toBe("OverworldLoopLessDelay");
    expect(db.sectionAt("rom", 0, 0x0150)?.name).toBe("Home");
  });
});

describe.skipIf(!existsSync(ROM_PATH))("with the ROM", () => {
  // Read lazily: a skipped describe still runs its body when collecting tests.
  let rom: Uint8Array;
  const db = labelDb();
  beforeAll(() => {
    rom = new Uint8Array(readFileSync(ROM_PATH));
  });

  it("lists bank 0 with resolved far calls", () => {
    const lines = bankListing(rom, db, 0);
    const i = lineIndexOf(lines, 0x03ff);
    expect(lines[i]).toMatchObject({ t: "label", label: { name: "OverworldLoop" } });
    const far = lines.filter((l) => l.t === "ins" && l.far);
    expect(far.length).toBeGreaterThan(50);
    // Every far call lands on a label.
    for (const l of far) if (l.t === "ins") expect(db.at(l.far!.bank, l.far!.address).length, l.address.toString(16)).toBeGreaterThan(0);
  });

  it.skipIf(!existsSync(VENDOR))("decodes code labels the way the disassembly wrote them", () => {
    // Compare the first instruction after each code label with the source line it came from.
    let checked = 0;
    for (const label of db.labels) {
      if (label.kind !== "code" || !label.file || label.address >= 0x8000) continue;
      const src = readFileSync(new URL(label.file, VENDOR), "utf8").split("\n");
      const stmt = src
        .slice(label.line! - 1)
        .map((l, i) => (i === 0 ? l.replace(/^\S+/, "") : /^\S/.test(l) && !/^(IF|ELSE|ELIF|ENDC)\b/.test(l) ? "" : l).replace(/;.*/, "").trim())
        .find(Boolean);
      if (!stmt || /^IF\b/i.test(stmt)) continue;
      const word = stmt.split(/\s+/)[0]?.toLowerCase();
      if (!word || !/^(ld|ldh|jp|jr|call|ret|push|pop|and|or|xor|cp|inc|dec|add|sub|bit|res|set|swap|srl)$/.test(word)) continue;
      const ins = decode((a) => rom[romOffset(label.bank, a)]!, label.address);
      const expected = word === "ldh" && ins.mnemonic === "ld" ? "ld" : word;
      expect(ins.mnemonic, `${label.name}: ${stmt}`).toBe(expected);
      checked++;
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it("decompresses pictures", () => {
    const pic = (name: string) => {
      const l = db.byName.get(name)!;
      return decompressPic(rom, romOffset(l.bank, l.address));
    };
    const bulbasaur = pic("BulbasaurPicFront");
    expect([bulbasaur.width, bulbasaur.height]).toEqual([5, 5]);
    // The compressed data ends right where the back picture starts.
    expect(bulbasaur.size).toBe(db.byName.get("BulbasaurPicBack")!.address - db.byName.get("BulbasaurPicFront")!.address);
    expect(pic("RedPicFront").width).toBe(7);
  });
});
