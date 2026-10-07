import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkRom } from "./rom.ts";

const ROM_PATH = new URL("../../../rom/pokeblue.gb", import.meta.url);

describe.skipIf(!existsSync(ROM_PATH))("checkRom", () => {
  it("accepts the reference ROM", async () => {
    const result = await checkRom(new Uint8Array(readFileSync(ROM_PATH)));
    expect(result.ok).toBe(true);
    expect(result.header?.title).toBe("POKEMON BLUE");
  });

  it("rejects a modified ROM", async () => {
    const rom = new Uint8Array(readFileSync(ROM_PATH));
    rom[0x200] = rom[0x200]! ^ 0xff;
    const result = await checkRom(rom);
    expect(result.ok).toBe(false);
  });
});
