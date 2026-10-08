// The ROM explorer's label database: every label in the disassembly with its kind and source
// location, and the linker's section layout. Parsed from generated/explorer-db.ts.
import { EXPLORER_DB } from "../generated/explorer-db.ts";

export type LabelKind = "code" | "data" | "text" | "audio" | "gfx2bpp" | "gfx1bpp" | "pic" | "binary" | "ram" | "unknown";

const KINDS: Record<string, LabelKind> = {
  c: "code",
  d: "data",
  t: "text",
  a: "audio",
  g: "gfx2bpp",
  "1": "gfx1bpp",
  p: "pic",
  b: "binary",
  v: "ram",
  "?": "unknown",
};

export interface Label {
  name: string;
  bank: number;
  address: number;
  kind: LabelKind;
  /** Source file in the pret disassembly and the line the label is on. */
  file?: string;
  line?: number;
  /** Local labels (`Routine.loop`) belong to the global label before them. */
  local: boolean;
}

export interface Section {
  /** rgblink's region: ROM0, ROMX, VRAM, SRAM, WRAM0, HRAM. */
  region: string;
  bank: number;
  start: number;
  /** Inclusive. */
  end: number;
  /** Empty for free space. */
  name: string;
}

export interface LabelDb {
  /** The pokered commit the labels come from, for links to the source. */
  commit: string;
  labels: Label[];
  sections: Section[];
  byName: Map<string, Label>;
  /** Labels at exactly this place: key is `bank * 0x10000 + address`. */
  at(bank: number, address: number): Label[];
  /** The nearest global (non-local) label at or before this place in the same bank. */
  before(bank: number, address: number, globalOnly?: boolean): Label | undefined;
  /** The next label after this address in the same bank (to bound data runs). */
  after(bank: number, address: number): Label | undefined;
  /** Labels of one ROM/RAM bank, sorted by address. */
  inBank(region: "rom" | "ram", bank: number): Label[];
  sectionAt(region: "rom" | "ram", bank: number, address: number): Section | undefined;
}

const key = (bank: number, address: number) => bank * 0x10000 + address;

let cached: LabelDb | undefined;

/** Parses the label database once; ~20k labels, so callers should keep the result. */
export function labelDb(): LabelDb {
  if (cached) return cached;
  const lines = EXPLORER_DB.split("\n");
  const commit = lines[0]!.slice(1);
  const files: string[] = [];
  const sections: Section[] = [];
  const labels: Label[] = [];
  let part = "";
  for (const line of lines.slice(1)) {
    if (line.startsWith("#")) {
      part = line;
      continue;
    }
    if (part === "#files") files.push(line);
    else if (part === "#sections") {
      const [region, pos, ...name] = line.split(" ");
      sections.push({
        region: region!,
        bank: parseInt(pos!.slice(0, 2), 16),
        start: parseInt(pos!.slice(2, 6), 16),
        end: parseInt(pos!.slice(6, 10), 16),
        name: name.join(" "),
      });
    } else if (part === "#labels") {
      const space = line.indexOf(" ");
      const head = line.slice(0, space);
      const name = line.slice(space + 1);
      const src = head.slice(7);
      const [file, ln] = src ? src.split(":").map((s) => parseInt(s, 36)) : [];
      labels.push({
        name,
        bank: parseInt(head.slice(0, 2), 16),
        address: parseInt(head.slice(2, 6), 16),
        kind: KINDS[head[6]!] ?? "unknown",
        file: file === undefined ? undefined : files[file],
        line: ln,
        local: name.includes("."),
      });
    }
  }
  const byName = new Map(labels.map((l) => [l.name, l]));
  const romSections = new Map<number, Section[]>();
  for (const s of sections) {
    if (!s.region.startsWith("ROM")) continue;
    (romSections.get(s.bank) ?? romSections.set(s.bank, []).get(s.bank)!).push(s);
  }
  const byPlace = new Map<number, Label[]>();
  const banks = new Map<string, Label[]>();
  for (const l of labels) {
    const k = key(l.bank, l.address);
    const list = byPlace.get(k);
    if (list) list.push(l);
    else byPlace.set(k, [l]);
    const bk = `${regionOf(l.address)}${l.bank}`;
    (banks.get(bk) ?? banks.set(bk, []).get(bk)!).push(l);
  }
  for (const list of banks.values()) list.sort((a, b) => a.address - b.address);

  const search = (list: Label[], address: number) => {
    // Index of the last label with address <= `address`.
    let lo = 0;
    let hi = list.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid]!.address <= address) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  };
  const bankList = (bank: number, address: number) => banks.get(`${regionOf(address)}${bank}`) ?? [];

  const db: LabelDb = {
    commit,
    labels,
    sections,
    byName,
    at: (bank, address) => byPlace.get(key(bank, address)) ?? [],
    before(bank, address, globalOnly = true) {
      const list = bankList(bank, address);
      // Labels don't reach across sections (code before a section doesn't own what's in it).
      const section = address < 0x8000 ? this.sectionAt("rom", address < 0x4000 ? 0 : bank, address) : undefined;
      for (let i = search(list, address); i >= 0; i--) {
        const l = list[i]!;
        if (section && l.address < section.start) return undefined;
        if (!globalOnly || !l.local) return l;
      }
      return undefined;
    },
    after(bank, address) {
      const list = bankList(bank, address);
      return list[search(list, address) + 1];
    },
    inBank: (region, bank) => banks.get(`${region}${bank}`) ?? [],
    sectionAt(region, bank, address) {
      const list = region === "rom" ? romSections.get(bank) : sections.filter((s) => !s.region.startsWith("ROM") && s.bank === bank);
      return list?.find((s) => s.start <= address && address <= s.end);
    },
  };
  cached = db;
  return db;
}

const regionOf = (address: number) => (address < 0x8000 ? "rom" : "ram");

/** A link to the label's definition in the public pret disassembly, at the commit we build. */
export function sourceUrl(db: LabelDb, label: Label): string | undefined {
  if (!label.file) return undefined;
  return `https://github.com/pret/pokered/blob/${db.commit}/${label.file}#L${label.line}`;
}
