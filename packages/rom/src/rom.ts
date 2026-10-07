/** SHA-1 of Pokémon Blue (USA, Europe) (SGB Enhanced), the only supported dump. */
export const POKEBLUE_SHA1 = "d7037c83e1ae5b39bde3c30787637ba1d4c48ce2";

export interface RomHeader {
  title: string;
  cgbFlag: number;
  sgbFlag: number;
  cartridgeType: number;
  romSizeCode: number;
  ramSizeCode: number;
  headerChecksum: number;
  globalChecksum: number;
}

export function readHeader(rom: Uint8Array): RomHeader {
  if (rom.length < 0x150) throw new Error("File is too small to be a Game Boy ROM.");
  const title = String.fromCharCode(...rom.subarray(0x134, 0x144)).replace(/\0+$/, "");
  return {
    title,
    cgbFlag: rom[0x143]!,
    sgbFlag: rom[0x146]!,
    cartridgeType: rom[0x147]!,
    romSizeCode: rom[0x148]!,
    ramSizeCode: rom[0x149]!,
    headerChecksum: rom[0x14d]!,
    globalChecksum: (rom[0x14e]! << 8) | rom[0x14f]!,
  };
}

export async function sha1Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", data as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type RomCheck =
  | { ok: true; header: RomHeader }
  | { ok: false; reason: string; header?: RomHeader };

/** Accept only the exact dump the symbol tables were generated against. */
export async function checkRom(rom: Uint8Array): Promise<RomCheck> {
  let header: RomHeader;
  try {
    header = readHeader(rom);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  const hash = await sha1Hex(rom);
  if (hash === POKEBLUE_SHA1) return { ok: true, header };
  const reason =
    header.title === "POKEMON BLUE"
      ? "This is Pokémon Blue, but a different revision or a modified dump. pokeHD needs the USA/Europe release."
      : `This ROM ("${header.title || "unknown"}") isn't supported. pokeHD needs Pokémon Blue (USA/Europe).`;
  return { ok: false, reason, header };
}
