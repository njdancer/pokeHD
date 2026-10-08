// The ROM at a glance: all 64 banks as strips coloured by what's in them, the CPU's memory map,
// and the cartridge header.
import { useEffect, useMemo, useRef, useState } from "react";
import { readHeader } from "@pokehd/rom";
import { decode, instructionText, MEMORY_MAP, type LabelDb, type LabelKind } from "@pokehd/rom/explore";
import { useEmuVersion, useExplorer } from "./context.ts";
import { hex, KIND_INFO, place, routeForLabel } from "./format.ts";

const KIND_ORDER: (LabelKind | "free")[] = ["code", "data", "text", "audio", "gfx2bpp", "gfx1bpp", "pic", "binary", "unknown", "free"];
const BYTES_PER_PX = 16;
const STRIP = 1024; // 16 KB / 16
const ROW_H = 12;

/** What kind of thing each ROM byte belongs to, as an index into KIND_ORDER. */
function kindMap(rom: Uint8Array, db: LabelDb): Uint8Array {
  const kinds = new Uint8Array(rom.length).fill(KIND_ORDER.indexOf("unknown"));
  const banks = rom.length / 0x4000;
  for (let bank = 0; bank < banks; bank++) {
    const base = bank * 0x4000;
    const start = bank === 0 ? 0 : 0x4000;
    const labels = db.inBank("rom", bank).filter((l) => l.address >= start && l.address < start + 0x4000);
    let kind = KIND_ORDER.indexOf("unknown");
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i]!;
      if (!l.local || l.kind !== "unknown") kind = KIND_ORDER.indexOf(l.kind);
      const end = labels[i + 1]?.address ?? start + 0x4000;
      kinds.fill(kind, base + l.address - start, base + end - start);
    }
  }
  const free = KIND_ORDER.indexOf("free");
  // Banks the game doesn't use at all: the linker lists nothing in them.
  for (let bank = 1; bank < banks; bank++) {
    if (!db.sections.some((s) => s.bank === bank && s.region === "ROMX")) kinds.fill(free, bank * 0x4000, (bank + 1) * 0x4000);
  }
  for (const s of db.sections) {
    if (s.name || !s.region.startsWith("ROM")) continue;
    const off = s.bank * 0x4000 + (s.bank === 0 ? s.start : s.start - 0x4000);
    kinds.fill(free, off, off + s.end - s.start + 1);
  }
  return kinds;
}

export function LayoutView() {
  const { rom, db, session, go } = useExplorer();
  const version = useEmuVersion(session);
  const kinds = useMemo(() => kindMap(rom, db), [rom, db]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ bank: number; address: number } | null>(null);
  const [showRan, setShowRan] = useState(true);
  const banks = rom.length / 0x4000;

  const totals = useMemo(() => {
    const t = new Array<number>(KIND_ORDER.length).fill(0);
    for (const k of kinds) t[k]!++;
    return t;
  }, [kinds]);

  useEffect(() => {
    const ctx = canvas.current!.getContext("2d")!;
    const img = ctx.createImageData(STRIP, banks * ROW_H);
    const colours = KIND_ORDER.map((k) => KIND_INFO[k].colour.match(/\w\w/g)!.map((h) => parseInt(h, 16)));
    const coverage = showRan ? session?.dbg.coverage : undefined;
    for (let bank = 0; bank < banks; bank++) {
      for (let x = 0; x < STRIP; x++) {
        const off = bank * 0x4000 + x * BYTES_PER_PX;
        // The most common kind in this pixel's 16 bytes.
        const counts = new Map<number, number>();
        let ran = false;
        for (let i = 0; i < BYTES_PER_PX; i++) {
          counts.set(kinds[off + i]!, (counts.get(kinds[off + i]!) ?? 0) + 1);
          if (coverage?.[off + i]) ran = true;
        }
        const kind = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
        const c = colours[kind]!;
        for (let y = 1; y < ROW_H - 1; y++) {
          const p = ((bank * ROW_H + y) * STRIP + x) * 4;
          const lit = ran && (y === 1 || y === 2);
          img.data[p] = lit ? 255 : c[0]!;
          img.data[p + 1] = lit ? 255 : c[1]!;
          img.data[p + 2] = lit ? 255 : c[2]!;
          img.data[p + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [kinds, banks, session, showRan, version]);

  const at = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * STRIP);
    const bank = Math.floor(((e.clientY - r.top) / r.height) * banks);
    if (bank < 0 || bank >= banks || x < 0 || x >= STRIP) return null;
    return { bank, address: (bank === 0 ? 0 : 0x4000) + x * BYTES_PER_PX };
  };
  const hoverLabel = hover ? db.before(hover.bank, hover.address) : undefined;
  const hoverSection = hover ? db.sectionAt("rom", hover.bank, hover.address) : undefined;
  const header = readHeader(rom);

  return (
    <div className="layout-view">
      <section>
        <h2>The cartridge, bank by bank</h2>
        <p className="muted">
          The ROM is 1 MB, cut into 64 banks of 16 KB. The CPU can only see two at once: bank 0 at $0000–$3FFF, always, and
          one other at $4000–$7FFF, swapped by writing to the cartridge's MBC3 chip. Each strip is one bank, coloured by what
          the disassembly says is there. Click anywhere to open it.
        </p>
        <div className="legend">
          {KIND_ORDER.map((k, i) => (
            <span key={k}>
              <i style={{ background: KIND_INFO[k].colour }} /> {KIND_INFO[k].name}{" "}
              <span className="muted">{((totals[i]! / rom.length) * 100).toFixed(1)}%</span>
            </span>
          ))}
          {session && (
            <label>
              <input type="checkbox" checked={showRan} onChange={(e) => setShowRan(e.target.checked)} /> mark code that has run
              (white)
            </label>
          )}
        </div>
        <div className="banks">
          <div className="bank-numbers" style={{ height: banks * ROW_H }}>
            {Array.from({ length: banks }, (_, b) => (
              <span key={b} style={{ height: ROW_H }}>
                {hex(b)}
              </span>
            ))}
          </div>
          <canvas
            ref={canvas}
            width={STRIP}
            height={banks * ROW_H}
            className="bank-strips"
            onMouseMove={(e) => setHover(at(e))}
            onMouseLeave={() => setHover(null)}
            onClick={(e) => {
              const p = at(e);
              if (!p) return;
              const label = db.before(p.bank, p.address);
              go(label ? routeForLabel(label) : { view: "code", ...p });
            }}
          />
        </div>
        <p className="hover-line">
          {hover ? (
            <>
              <code>{place(hover.bank, hover.address)}</code> {hoverSection ? `section "${hoverSection.name}"` : "free space"}
              {hoverLabel && (
                <>
                  {" · "}
                  <strong style={{ color: KIND_INFO[hoverLabel.kind].colour }}>{hoverLabel.name}</strong>
                </>
              )}
            </>
          ) : (
            <span className="muted">Hover a strip to see what's there.</span>
          )}
        </p>
      </section>

      <div className="two-col">
        <section>
          <h2>What the CPU sees</h2>
          <p className="muted">The SM83 CPU has a 16-bit address bus: 64 KB of addresses, shared by the cartridge, RAM and hardware.</p>
          <div className="memmap">
            {MEMORY_MAP.map((r) => (
              <button
                key={r.start}
                className="region"
                onClick={() => go(r.start < 0x8000 ? { view: "code", bank: r.start < 0x4000 ? 0 : 1, address: r.start } : { view: "memory", address: r.start })}
              >
                <code>
                  {hex(r.start, 4)}–{hex(r.end, 4)}
                </code>
                <strong>{r.name}</strong>
                <span>{r.about}</span>
              </button>
            ))}
          </div>
        </section>
        <section>
          <h2>The header</h2>
          <p className="muted">Every cartridge has a header at $0100–$014F that the Game Boy checks at power-on.</p>
          <dl className="header">
            <dt>$0100</dt>
            <dd>
              Entry point: <code>{instructionText(decode((a) => rom[a] ?? 0, 0x100))}</code>,{" "}
              <code>{instructionText(decode((a) => rom[a] ?? 0, 0x101))}</code>. The boot ROM jumps here after the logo.
            </dd>
            <dt>$0104</dt>
            <dd>
              The logo, which the boot ROM compares with its own copy before it lets the game run:
              <Logo rom={rom} />
            </dd>
            <dt>$0134</dt>
            <dd>
              Title: <code>{header.title}</code>
            </dd>
            <dt>$0146</dt>
            <dd>Super Game Boy features: {header.sgbFlag === 3 ? "yes (it sets colour palettes and a border on the SGB)" : "no"}</dd>
            <dt>$0147</dt>
            <dd>Cartridge type ${hex(header.cartridgeType)}: {header.cartridgeType === 0x13 ? "MBC3 + RAM + battery" : "other"}</dd>
            <dt>$0148</dt>
            <dd>ROM size: {32 << header.romSizeCode} KB ({2 << header.romSizeCode} banks)</dd>
            <dt>$0149</dt>
            <dd>Cartridge RAM: {header.ramSizeCode === 3 ? "32 KB, 4 banks of 8 KB (the save file)" : `code ${header.ramSizeCode}`}</dd>
            <dt>$014D</dt>
            <dd>Header checksum ${hex(header.headerChecksum)}: the boot ROM refuses to start if it's wrong.</dd>
            <dt>$014E</dt>
            <dd>Global checksum ${hex(header.globalChecksum, 4)}: nothing checks it.</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}

/** The 48×8 logo from the header: 1bpp, stored as 4×4-pixel nybbles in two rows of 12 tiles. */
function Logo({ rom }: { rom: Uint8Array }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current!.getContext("2d")!;
    const img = ctx.createImageData(48, 8);
    for (let i = 0; i < 48; i++) {
      const byte = rom[0x104 + i]!;
      // Each byte is two 4-pixel rows of one 4×4 block; blocks run down then across.
      const tx = Math.floor(i / 2) % 12;
      const ty = Math.floor(i / 24);
      for (let half = 0; half < 2; half++) {
        const nyb = (byte >> (half ? 0 : 4)) & 0xf;
        const y = ty * 4 + (i % 2) * 2 + half;
        for (let b = 0; b < 4; b++) {
          const p = (y * 48 + tx * 4 + b) * 4;
          const on = (nyb >> (3 - b)) & 1;
          img.data.set(on ? [16, 16, 16, 255] : [232, 232, 232, 255], p);
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [rom]);
  return <canvas ref={ref} width={48} height={8} className="logo" />;
}
