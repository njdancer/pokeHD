// Shared helpers for the explorer's panels: hex formatting, naming addresses, kinds and routes.
import { IO_REGISTERS, type Label, type LabelDb, type LabelKind, type Namer } from "@pokehd/rom/explore";

export const hex = (n: number, width = 2) => n.toString(16).toUpperCase().padStart(width, "0");
export const place = (bank: number, address: number) => `${hex(bank)}:${hex(address, 4)}`;

export const KIND_INFO: Record<LabelKind | "free", { name: string; colour: string }> = {
  code: { name: "Code", colour: "#5b8def" },
  data: { name: "Data tables", colour: "#8a94a6" },
  text: { name: "Text", colour: "#4fbf7f" },
  audio: { name: "Music & sound", colour: "#b07de8" },
  gfx2bpp: { name: "Graphics (2bpp)", colour: "#f0a04b" },
  gfx1bpp: { name: "Graphics (1bpp)", colour: "#e8c547" },
  pic: { name: "Compressed pictures", colour: "#e86f9a" },
  binary: { name: "Maps & block sets", colour: "#a5764f" },
  ram: { name: "RAM variable", colour: "#5fb3b3" },
  unknown: { name: "Unclassified", colour: "#56606e" },
  free: { name: "Free space", colour: "#1c232d" },
};

/** The best label for an address: a global one if there is one, else the first. */
export function bestLabel(labels: Label[]): Label | undefined {
  return labels.find((l) => !l.local) ?? labels[0];
}

/** Labels for a CPU address, given the ROM bank switched in (for $4000–$7FFF). */
export function labelsFor(db: LabelDb, bank: number, address: number): Label[] {
  if (address < 0x4000) return db.at(0, address);
  if (address < 0x8000) return db.at(bank, address);
  if (address >= 0xa000 && address < 0xc000) {
    for (let b = 0; b < 4; b++) {
      const found = db.at(b, address);
      if (found.length) return found;
    }
    return [];
  }
  return db.at(0, address);
}

/** Shortens `Routine.local` to `.local` inside Routine. */
export function shortName(label: Label, scope?: string): string {
  if (scope && label.local && label.name.startsWith(scope + ".")) return label.name.slice(scope.length);
  return label.name;
}

/** Names operands in a listing: labels for pointers and jump targets, hardware names for I/O. */
export function namer(db: LabelDb, bank: number, scope?: string): Namer {
  return (address, operand) => {
    if (operand.t === "high" && IO_REGISTERS[address]) return IO_REGISTERS[address].name;
    // Small 16-bit immediates are usually counts, not pointers.
    if (operand.t === "n16" && address < 0x100) return undefined;
    const label = bestLabel(labelsFor(db, bank, address));
    return label ? shortName(label, scope) : undefined;
  };
}

export type Route =
  | { view: "layout" }
  | { view: "code"; bank: number; address: number }
  | { view: "memory"; address: number }
  | { view: "tiles"; bank: number; address: number; format?: "2bpp" | "1bpp" }
  | { view: "pics"; name?: string }
  | { view: "vram" }
  | { view: "text"; name?: string };

export function parseRoute(hash: string): Route {
  const [view = "layout", arg = ""] = hash.replace(/^#\/?/, "").split("/");
  const [b, a] = arg.split(":").map((s) => parseInt(s, 16));
  const bank = Number.isFinite(b) ? b! : 0;
  const address = Number.isFinite(a) ? a! : bank === 0 ? 0x100 : 0x4000;
  switch (view) {
    case "code":
      return { view, bank, address };
    case "tiles":
      return { view, bank, address, format: hash.includes("1bpp") ? "1bpp" : "2bpp" };
    case "memory":
      return { view, address: Number.isFinite(b) ? b! : 0xc000 };
    case "pics":
    case "text":
      return { view, name: arg ? decodeURIComponent(arg) : undefined };
    case "vram":
      return { view };
    default:
      return { view: "layout" };
  }
}

export function routeHash(route: Route): string {
  switch (route.view) {
    case "code":
      return `#/code/${place(route.bank, route.address)}`;
    case "tiles":
      return `#/tiles/${place(route.bank, route.address)}${route.format === "1bpp" ? "/1bpp" : ""}`;
    case "memory":
      return `#/memory/${hex(route.address, 4)}`;
    case "pics":
    case "text":
      return `#/${route.view}${route.name ? `/${encodeURIComponent(route.name)}` : ""}`;
    default:
      return `#/${route.view}`;
  }
}

/** Where to open a label: tiles for graphics, the picture viewer for pics, else the listing. */
export function routeForLabel(label: Label): Route {
  if (label.kind === "gfx2bpp" || label.kind === "gfx1bpp") {
    return { view: "tiles", bank: label.bank, address: label.address, format: label.kind === "gfx1bpp" ? "1bpp" : "2bpp" };
  }
  if (label.kind === "pic") return { view: "pics", name: label.name };
  if (label.kind === "ram") return { view: "memory", address: label.address };
  return { view: "code", bank: label.bank, address: label.address };
}

/** The four DMG greys, lightest first, as RGBA. */
export const GREYS = [
  [0xe8, 0xe8, 0xe8],
  [0xa0, 0xa0, 0xa0],
  [0x58, 0x58, 0x58],
  [0x10, 0x10, 0x10],
] as const;
