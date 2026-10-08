// Generates packages/rom/src/generated/explorer-db.ts for the ROM explorer: every label in the
// pret disassembly's pokeblue.sym, what kind of thing it points at (code, data, text, graphics…),
// where it's defined in the disassembly's source, and the linker's section layout from
// pokeblue.map. Only names, addresses, layout and our own classification: no ROM bytes.
// Usage: pnpm rom:symbols, or `node tools/gen-explorer.ts --check`.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const VENDOR = new URL("../vendor/pokered/", import.meta.url).pathname;
export const SYM_PATH = join(VENDOR, "pokeblue.sym");
export const MAP_PATH = join(VENDOR, "pokeblue.map");
export const OUT_PATH = new URL("../packages/rom/src/generated/explorer-db.ts", import.meta.url);

/**
 * Label kinds, one character each in the generated table:
 * c code, d data, t text, a audio script, g 2bpp graphics, 1 1bpp graphics, p compressed picture,
 * b other binary (block sets, tilemaps), v RAM variable, ? not found in the source.
 */
type Kind = "c" | "d" | "t" | "a" | "g" | "1" | "p" | "b" | "v" | "?";

const MNEMONICS = new Set(
  ("ld ldh ldi ldd push pop add adc sub sbc and or xor cp inc dec daa cpl ccf scf nop halt stop " +
    "di ei jp jr call ret reti rst rlca rla rrca rra rlc rl rrc rr sla sra srl swap bit set res").split(" "),
);
const DATA_DIRECTIVES = new Set(["db", "dw", "dl", "ds"]);
const CONTROL = /^(if|elif|else|endc|rept|for|endr|def|redef|assert|static_assert|charmap|newcharmap|setcharmap|pushc|popc|opt|pusho|popo|export|purge|shift|load|endl|union|nextu|endu|align|warn|fail|println|print)\b/i;

function asmFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name === "tools") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) asmFiles(path, out);
    else if (name.endsWith(".asm")) out.push(path);
  }
  return out;
}

/** Strips comments and string contents' semicolons aside; good enough for pokered's style. */
function code(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inString = !inString;
    else if (ch === ";" && !inString) return line.slice(0, i).trim();
  }
  return line.trim();
}

interface Macro {
  file: string;
  body: string[];
}

/** Classifies one statement: a kind, or null for lines that say nothing (control, blank). */
function classify(stmt: string, macros: Map<string, Macro>, seen = new Set<string>()): Kind | null {
  if (!stmt || CONTROL.test(stmt)) return null;
  const word = (/^[\w.]+/.exec(stmt)?.[0] ?? "").toLowerCase();
  if (MNEMONICS.has(word)) return "c";
  if (word === "incbin") {
    const ext = /\.(\w+)"/.exec(stmt)?.[1];
    return ext === "2bpp" ? "g" : ext === "1bpp" ? "1" : ext === "pic" ? "p" : "b";
  }
  if (DATA_DIRECTIVES.has(word)) return word === "db" && /^db\s+"/i.test(stmt) ? "t" : "d";
  const macro = macros.get(word);
  if (!macro || seen.has(word)) return word ? "d" : null;
  if (macro.file.endsWith("macros/scripts/text.asm")) return "t";
  if (macro.file.endsWith("macros/scripts/audio.asm")) return "a";
  if (word === "li" || word === "dname") return "t";
  seen.add(word);
  for (const line of macro.body) {
    const kind = classify(code(line), macros, seen);
    if (kind) return kind;
  }
  return "d";
}

const LABEL = /^(\.?[A-Za-z_][\w.]*|[A-Za-z_][\w]*\.[\w]+)(::?)?(?=\s|$)/;

interface Source {
  kind: Kind;
  file: number;
  line: number;
}

/** Finds every label in the disassembly's source and the kind of the statement that follows it. */
export function scanSources(): { files: string[]; labels: Map<string, Source> } {
  const files = asmFiles(VENDOR).map((p) => relative(VENDOR, p)).sort();
  const texts = files.map((f) => readFileSync(join(VENDOR, f), "utf8").split(/\r?\n/));
  const macros = new Map<string, Macro>();
  texts.forEach((lines, fi) => {
    for (let i = 0; i < lines.length; i++) {
      const m = /^\s*MACRO\??\s+(\w+)/.exec(lines[i]!);
      if (!m) continue;
      const body: string[] = [];
      for (i++; i < lines.length && !/^\s*ENDM\b/.test(lines[i]!); i++) body.push(lines[i]!);
      macros.set(m[1]!.toLowerCase(), { file: files[fi]!, body });
    }
  });
  const labels = new Map<string, Source>();
  texts.forEach((lines, fi) => {
    let scope = "";
    let pending: { name: string; line: number }[] = [];
    let inMacro = false;
    const settle = (kind: Kind) => {
      for (const p of pending) if (!labels.has(p.name)) labels.set(p.name, { kind, file: fi, line: p.line });
      pending = [];
    };
    lines.forEach((raw, li) => {
      if (/^\s*MACRO\b/.test(raw)) inMacro = true;
      if (inMacro) {
        if (/^\s*ENDM\b/.test(raw)) inMacro = false;
        return;
      }
      if (/^\s*SECTION\b/.test(raw)) return settle("?");
      let stmt = code(raw);
      // Labels start in column 0; instructions are indented.
      const m = /^\S/.test(raw) ? LABEL.exec(stmt) : null;
      if (m && (m[2] || m[1]!.startsWith(".") || !MNEMONICS.has(m[1]!.toLowerCase()))) {
        const name = m[1]!;
        if (/^(DEF|REDEF|MACRO|ENDM|INCLUDE|SECTION|IF|ELSE|ELIF|ENDC|REPT|FOR|ENDR|ASSERT|EXPORT|CHARMAP|LOAD|ENDL|UNION|NEXTU|ENDU)$/i.test(name)) {
          // Directives that happen to start in column 0.
        } else if (stmt.slice(name.length).trim().startsWith("EQU") || /^\s*(=|EQUS|EQU|RB|RW)\b/.test(stmt.slice(name.length))) {
          return;
        } else {
          const full = name.startsWith(".") ? scope + name : name;
          if (!name.startsWith(".") && !name.includes(".")) scope = name;
          pending.push({ name: full, line: li + 1 });
          stmt = stmt.slice(m[0].length).trim();
        }
      }
      const kind = classify(stmt, macros);
      if (kind) settle(kind);
    });
    settle("?");
  });
  return { files, labels };
}

interface Section {
  region: string;
  bank: number;
  start: number;
  end: number;
  name: string;
}

/** Sections (and free space, named "") from rgblink's map file. */
export function parseMap(text: string): Section[] {
  const out: Section[] = [];
  let region = "";
  let bank = 0;
  for (const line of text.split(/\r?\n/)) {
    const head = /^(\w+) bank #(\d+):/.exec(line);
    if (head) {
      region = head[1]!;
      bank = Number(head[2]);
      continue;
    }
    const sec = /^\s+(SECTION|EMPTY): \$([0-9a-f]{4})(?:-\$([0-9a-f]{4}))? \(\$([0-9a-f]+) bytes?\)(?: \["(.*)"\])?/i.exec(line);
    if (!sec || parseInt(sec[4]!, 16) === 0) continue;
    out.push({
      region,
      bank,
      start: parseInt(sec[2]!, 16),
      end: parseInt(sec[3] ?? sec[2]!, 16),
      name: sec[1] === "EMPTY" ? "" : sec[5]!,
    });
  }
  return out;
}

const h = (n: number, w: number) => n.toString(16).padStart(w, "0");

export function renderExplorerDb(symText: string, mapText: string): string {
  const { files, labels } = scanSources();
  const rows: string[] = [];
  const seen = new Set<string>();
  const counts: Record<string, number> = {};
  for (const line of symText.split(/\r?\n/)) {
    const m = /^([0-9a-f]+):([0-9a-f]{4}) (\S+)$/i.exec(line.trim());
    if (!m || seen.has(m[3]!)) continue;
    seen.add(m[3]!);
    const [bank, address, name] = [parseInt(m[1]!, 16), parseInt(m[2]!, 16), m[3]!];
    const src = labels.get(name);
    let kind: Kind = src?.kind ?? "?";
    if (address >= 0x8000) kind = "v";
    counts[kind] = (counts[kind] ?? 0) + 1;
    rows.push(`${h(bank, 2)}${h(address, 4)}${kind}${src ? `${src.file.toString(36)}:${src.line.toString(36)}` : ""} ${name}`);
  }
  const sections = parseMap(mapText).map((s) => `${s.region} ${h(s.bank, 2)}${h(s.start, 4)}${h(s.end, 4)} ${s.name}`);
  const commit = execFileSync("git", ["-C", VENDOR, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (process.env.EXPLORER_STATS) console.log(counts);
  const blob = [`@${commit}`, "#files", ...files, "#sections", ...sections, "#labels", ...rows].join("\n");
  return [
    "// Generated by tools/gen-explorer.ts from vendor/pokered (pokeblue.sym, pokeblue.map and the .asm",
    "// sources). Labels, layout and classification only: no ROM data. Do not edit by hand.",
    "// Parsed by explore/db.ts. Lines after #labels are `BBAAAAK[file:line] Name` (hex bank and",
    "// address, a kind letter, base-36 source file index and line).",
    `export const EXPLORER_DB = ${JSON.stringify(blob)};`,
    "",
  ].join("\n");
}

if (import.meta.main) {
  if (!existsSync(SYM_PATH) || !existsSync(MAP_PATH)) {
    console.error("vendor/pokered/pokeblue.sym or .map is missing; run `pnpm rom:build-disasm` first.");
    process.exit(1);
  }
  const next = renderExplorerDb(readFileSync(SYM_PATH, "utf8"), readFileSync(MAP_PATH, "utf8"));
  const current = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, "utf8") : "";
  if (next === current) console.log("explorer-db.ts is up to date.");
  else if (process.argv.includes("--check")) {
    console.error("packages/rom/src/generated/explorer-db.ts is stale; run `pnpm rom:symbols`.");
    process.exit(1);
  } else {
    writeFileSync(OUT_PATH, next);
    console.log(`Wrote explorer-db.ts (${(next.length / 1024).toFixed(0)} KB).`);
  }
}
