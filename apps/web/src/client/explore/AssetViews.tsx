// Asset explorers: raw tiles at any ROM address, the compressed pictures, live video RAM, and
// the game's text. All decoded here from the player's own ROM or the running emulator.
import { useEffect, useMemo, useRef, useState } from "react";
import { decode2bpp } from "@pokehd/rom";
import { decodeTextScript, decompressPic, romOffset, sourceUrl, type Label, type Pic } from "@pokehd/rom/explore";
import { useEmuVersion, useExplorer } from "./context.ts";
import { GREYS, hex, KIND_INFO, place } from "./format.ts";

/** Colour numbers (0–3, 64 per tile) for tiles in 2bpp or 1bpp format. */
function decodeTiles(bytes: Uint8Array, format: "2bpp" | "1bpp"): Uint8Array {
  if (format === "2bpp") return decode2bpp(bytes);
  const out = new Uint8Array(bytes.length * 8);
  for (let i = 0; i < bytes.length; i++) for (let b = 0; b < 8; b++) out[i * 8 + b] = (bytes[i]! >> (7 - b)) & 1 ? 3 : 0;
  return out;
}

/** Draws 8×8 tiles (64 colour numbers each) in a grid, through a palette of 4 grey indices. */
function drawTiles(canvas: HTMLCanvasElement, pixels: Uint8Array, columns: number, palette = [0, 1, 2, 3], grid = false, scale = 1) {
  const count = Math.ceil(pixels.length / 64);
  const rows = Math.max(1, Math.ceil(count / columns));
  const gap = grid ? 1 : 0;
  const w = columns * (8 + gap);
  const h = rows * (8 + gap);
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${w * scale}px`;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  img.data.fill(0);
  for (let t = 0; t < count; t++) {
    const ox = (t % columns) * (8 + gap);
    const oy = Math.floor(t / columns) * (8 + gap);
    for (let p = 0; p < 64; p++) {
      const c = GREYS[palette[pixels[t * 64 + p] ?? 0]!]!;
      const i = ((oy + (p >> 3)) * w + ox + (p & 7)) * 4;
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Draws a picture's pixels (row-major colour numbers). */
function drawPic(canvas: HTMLCanvasElement, pic: Pic, scale?: number) {
  const w = pic.width * 8;
  const h = pic.height * 8;
  canvas.width = w;
  canvas.height = h;
  if (scale) canvas.style.width = `${w * scale}px`;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const c = GREYS[pic.pixels[i]!]!;
    img.data.set([c[0], c[1], c[2], 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
}

function SourceLink({ label }: { label: Label }) {
  const { db } = useExplorer();
  const url = sourceUrl(db, label);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      {label.file} ↗
    </a>
  ) : null;
}

// ─── Tiles ──────────────────────────────────────────────────────────────────────────────────────

export function TilesView({ bank, address, format = "2bpp" }: { bank: number; address: number; format?: "2bpp" | "1bpp" }) {
  const { rom, db, go } = useExplorer();
  const [count, setCount] = useState(0);
  const [columns, setColumns] = useState(16);
  const [zoom, setZoom] = useState(3);
  const [grid, setGrid] = useState(true);
  const [filter, setFilter] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);

  const gfx = useMemo(() => db.labels.filter((l) => l.kind === "gfx2bpp" || l.kind === "gfx1bpp"), [db]);
  const here = db.before(bank, address, false);
  const label = here && here.address === address ? here : undefined;
  // By default, show up to the next label (the whole graphic).
  const next = db.after(bank, address);
  const tileBytes = format === "2bpp" ? 16 : 8;
  const end = bank === 0 ? 0x4000 : 0x8000;
  const natural = Math.max(1, Math.min(256, Math.ceil(((next?.address ?? end) - address) / tileBytes)));
  const tiles = count || natural;

  useEffect(() => {
    const off = romOffset(bank, address);
    const bytes = rom.slice(off, Math.min(rom.length, off + tiles * tileBytes));
    drawTiles(canvas.current!, decodeTiles(bytes, format), Math.min(columns, tiles), undefined, grid, zoom);
  }, [rom, bank, address, format, tiles, columns, grid, tileBytes, zoom]);

  const move = (delta: number) => {
    let a = address + delta;
    let b = bank;
    if (a < (b === 0 ? 0 : 0x4000)) a = b === 0 ? 0 : 0x4000;
    if (a >= end) a = end - 1;
    if (b === 0 && a >= 0x4000) b = 1;
    go({ view: "tiles", bank: b, address: a, format });
  };
  const shown = filter ? gfx.filter((l) => l.name.toLowerCase().includes(filter.toLowerCase())) : gfx;

  return (
    <div className="asset-view">
      <nav className="asset-list">
        <input placeholder={`Filter ${gfx.length} graphics`} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <ul>
          {shown.map((l) => (
            <li key={l.name}>
              <button
                className={`label-link ${l === label ? "current" : ""}`}
                onClick={() => {
                  setCount(0);
                  go({ view: "tiles", bank: l.bank, address: l.address, format: l.kind === "gfx1bpp" ? "1bpp" : "2bpp" });
                }}
              >
                <i style={{ background: KIND_INFO[l.kind].colour }} />
                {l.name}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="asset-main">
        <h2>
          {label ? label.name : `Tiles at ${place(bank, address)}`}{" "}
          <span className="muted">
            {place(bank, address)} · file offset {hex(romOffset(bank, address), 5)}
          </span>
        </h2>
        <p className="muted">
          Game Boy graphics are 8×8 tiles. In <strong>2bpp</strong> each row of 8 pixels is 2 bytes: one holds bit 0 of each
          pixel's colour number, the other bit 1, so a tile is 16 bytes and has 4 colours. <strong>1bpp</strong> tiles (the font)
          are 8 bytes, 2 colours, and get expanded when they're copied to video RAM. Point this at any address: code and data
          look like noise, real graphics jump out. Nudge by one byte to see what misalignment does.
        </p>
        <div className="toolbar">
          <label>
            Format{" "}
            <select value={format} onChange={(e) => go({ view: "tiles", bank, address, format: e.target.value as "2bpp" | "1bpp" })}>
              <option value="2bpp">2bpp</option>
              <option value="1bpp">1bpp</option>
            </select>
          </label>
          <label>
            Tiles <input type="number" min={1} max={1024} value={tiles} onChange={(e) => setCount(Number(e.target.value))} />
          </label>
          <label>
            Per row <input type="number" min={1} max={64} value={columns} onChange={(e) => setColumns(Number(e.target.value))} />
          </label>
          <label>
            Zoom <input type="range" min={1} max={8} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          </label>
          <label>
            <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> grid
          </label>
          <span className="spacer" />
          <button onClick={() => move(-tileBytes)}>− tile</button>
          <button onClick={() => move(-1)}>− byte</button>
          <button onClick={() => move(1)}>+ byte</button>
          <button onClick={() => move(tileBytes)}>+ tile</button>
          <button onClick={() => move(tiles * tileBytes)}>next ›</button>
        </div>
        <div className="tiles-canvas">
          <canvas ref={canvas} className="pixelated" />
        </div>
        {label && (
          <p className="muted">
            {tiles} tiles, {(tiles * tileBytes).toLocaleString()} bytes · <SourceLink label={label} /> ·{" "}
            <button className="link" onClick={() => go({ view: "code", bank, address })}>
              see the bytes in the listing
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Pictures ───────────────────────────────────────────────────────────────────────────────────

export function PicsView({ name }: { name?: string }) {
  const { rom, db, go } = useExplorer();
  const [filter, setFilter] = useState("");
  const pics = useMemo(() => db.labels.filter((l) => l.kind === "pic"), [db]);
  const selected = name ? db.byName.get(name) : undefined;
  const shown = filter ? pics.filter((l) => l.name.toLowerCase().includes(filter.toLowerCase())) : pics;
  return (
    <div className="asset-view pics">
      <div className="asset-main">
        {selected && <PicDetail label={selected} />}
        <div className="toolbar">
          <h2>Compressed pictures</h2>
          <input placeholder={`Filter ${pics.length} pictures`} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <p className="muted">
          Pokémon and trainer pictures are stored compressed, which is how 151 Pokémon fit in the cartridge. The game
          unpacks one into save RAM ($A000) whenever it needs it, with UncompressSpriteData.
        </p>
        <div className="pic-grid">
          {shown.map((l) => (
            <button key={l.name} className={`pic-cell ${l === selected ? "current" : ""}`} onClick={() => go({ view: "pics", name: l.name })}>
              <PicCanvas rom={rom} label={l} />
              <span>{l.name.replace(/Pic(Front|Back)$/, " $1").replace(/Pic$/, "")}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PicCanvas({ rom, label, zoom }: { rom: Uint8Array; label: Label; zoom?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    try {
      drawPic(ref.current!, decompressPic(rom, romOffset(label.bank, label.address)), zoom);
    } catch {
      // Not every label tagged as a picture starts with one (a few are aliases).
    }
  }, [rom, label, zoom]);
  return <canvas ref={ref} className="pixelated" />;
}

function PicDetail({ label }: { label: Label }) {
  const { rom, go } = useExplorer();
  let pic: Pic | undefined;
  try {
    pic = decompressPic(rom, romOffset(label.bank, label.address));
  } catch {
    pic = undefined;
  }
  return (
    <div className="pic-detail">
      <PicCanvas rom={rom} label={label} zoom={4} />
      <div>
        <h2>{label.name}</h2>
        {pic ? (
          <p>
            {pic.width}×{pic.height} tiles ({pic.width * 8}×{pic.height * 8} pixels). Stored in {pic.size} bytes; unpacked it's{" "}
            {pic.width * pic.height * 16} bytes, so it's {Math.round((1 - pic.size / (pic.width * pic.height * 16)) * 100)}%
            smaller.
          </p>
        ) : (
          <p className="muted">This label doesn't start a picture.</p>
        )}
        <p className="muted">
          {place(label.bank, label.address)} · <SourceLink label={label} /> ·{" "}
          <button className="link" onClick={() => go({ view: "code", bank: label.bank, address: label.address })}>
            see the bytes
          </button>
        </p>
        <p className="muted">
          How it's packed: two 1-bit planes, each run-length coded (runs of zeros) and delta coded along rows (a 1 means "the
          colour changes here"); the second plane may be stored XORed with the first.
        </p>
      </div>
    </div>
  );
}

// ─── Video RAM ──────────────────────────────────────────────────────────────────────────────────

const LCDC_BITS = [
  "Background on",
  "Sprites on",
  "Sprites are 8×16",
  "Background map at $9C00 (else $9800)",
  "Tiles from $8000 (else $8800–$97FF, signed)",
  "Window on",
  "Window map at $9C00 (else $9800)",
  "Screen on",
];

export function VramView() {
  const { session } = useExplorer();
  useEmuVersion(session);
  const tilesRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const [choice, setChoice] = useState<"auto" | "9800" | "9c00">("auto");
  const gb = session?.gb;

  const lcdc = gb?.read(0xff40) ?? 0;
  const bgp = gb?.read(0xff47) ?? 0xe4;
  const palette = [bgp & 3, (bgp >> 2) & 3, (bgp >> 4) & 3, (bgp >> 6) & 3];
  const scx = gb?.read(0xff43) ?? 0;
  const scy = gb?.read(0xff42) ?? 0;
  const map = choice === "auto" ? (lcdc & 0x08 ? 0x9c00 : 0x9800) : choice === "9800" ? 0x9800 : 0x9c00;

  useEffect(() => {
    if (!gb) return;
    const vram = gb.readBytes(0x8000, 0x1800);
    drawTiles(tilesRef.current!, decode2bpp(vram), 16, palette, true, 2);
    // The background map: 32×32 tile numbers, looked up the way LCDC bit 4 says.
    const tiles = decode2bpp(vram);
    const ids = gb.readBytes(map, 0x400);
    const pixels = new Uint8Array(1024 * 64);
    for (let i = 0; i < 1024; i++) {
      const id = ids[i]!;
      const index = lcdc & 0x10 ? id : 256 + ((id << 24) >> 24);
      pixels.set(tiles.subarray(index * 64, index * 64 + 64), i * 64);
    }
    const canvas = mapRef.current!;
    drawTiles(canvas, pixels, 32, palette, false, 2);
    // The 160×144 viewport, wrapping around the 256×256 map.
    const ctx = canvas.getContext("2d")!;
    ctx.strokeStyle = "#ff5a5a";
    ctx.lineWidth = 1;
    for (const dx of [0, -256]) for (const dy of [0, -256]) ctx.strokeRect(scx + dx + 0.5, scy + dy + 0.5, 159, 143);
  });

  if (!gb) return <p className="empty">Boot the emulator (on the right) to look inside video RAM as the game runs.</p>;
  const oam = gb.readBytes(0xfe00, 160);
  const sprites = Array.from({ length: 40 }, (_, i) => ({ y: oam[i * 4]! - 16, x: oam[i * 4 + 1]! - 8, tile: oam[i * 4 + 2]!, flags: oam[i * 4 + 3]! })).filter(
    (s) => s.y > -16 && s.y < 144 && s.x > -8 && s.x < 160,
  );
  return (
    <div className="vram-view">
      <section>
        <h2>Tile data · $8000–$97FF</h2>
        <p className="muted">
          384 tiles the game has copied in from the ROM. Rows 0–7 are $8000 (sprites), 8–15 $8800, 16–23 $9000. Shown with
          the background palette (BGP ${hex(bgp)}).
        </p>
        <canvas ref={tilesRef} className="pixelated" />
      </section>
      <section>
        <h2>
          Background map ·{" "}
          <select value={choice} onChange={(e) => setChoice(e.target.value as "auto" | "9800" | "9c00")}>
            <option value="auto">${hex(map, 4)}, the one LCDC uses</option>
            <option value="9800">$9800</option>
            <option value="9c00">$9C00</option>
          </select>
        </h2>
        <p className="muted">
          32×32 tile numbers (256×256 pixels). The red box is what's on screen: scroll X {scx}, Y {scy}. The game draws a whole
          screen in WRAM (wTileMap) and copies it here during VBlank.
        </p>
        <canvas ref={mapRef} className="pixelated" />
      </section>
      <section>
        <h2>LCD control · LCDC ${hex(lcdc)}</h2>
        <ul className="bits">
          {LCDC_BITS.map((b, i) => (
            <li key={i} className={lcdc & (1 << i) ? "" : "muted"}>
              bit {i}: {b} {lcdc & (1 << i) ? "✓" : ""}
            </li>
          ))}
        </ul>
        <h2>Sprites on screen · OAM</h2>
        <p className="muted">{sprites.length} of 40 hardware sprites are on screen. Each is 4 bytes: Y, X, tile, flags.</p>
        <table className="oam">
          <thead>
            <tr>
              <th>X</th>
              <th>Y</th>
              <th>Tile</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {sprites.map((s, i) => (
              <tr key={i}>
                <td>{s.x}</td>
                <td>{s.y}</td>
                <td>${hex(s.tile)}</td>
                <td>
                  {s.flags & 0x20 ? "flip-x " : ""}
                  {s.flags & 0x40 ? "flip-y " : ""}
                  {s.flags & 0x80 ? "behind " : ""}
                  {s.flags & 0x10 ? "OBP1" : "OBP0"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// ─── Text ───────────────────────────────────────────────────────────────────────────────────────

export function TextView({ name }: { name?: string }) {
  const { rom, db, go } = useExplorer();
  const [filter, setFilter] = useState("");
  const texts = useMemo(() => db.labels.filter((l) => l.kind === "text" && !l.local && l.address < 0x8000), [db]);
  const decoded = useMemo(
    () =>
      texts.map((l) => ({
        label: l,
        parts: decodeTextScript(rom, romOffset(l.bank, l.address), !l.name.endsWith("Text")),
      })),
    [rom, texts],
  );
  const flat = (parts: ReturnType<typeof decodeTextScript>) =>
    parts.map((p) => (p.t === "text" ? p.text : "")).join(" ");
  const q = filter.toLowerCase();
  const shown = q ? decoded.filter((d) => d.label.name.toLowerCase().includes(q) || flat(d.parts).toLowerCase().includes(q)) : decoded;
  const focus = name ? decoded.find((d) => d.label.name === name) : undefined;
  return (
    <div className="text-view">
      <div className="toolbar">
        <h2>Text</h2>
        <input placeholder={`Search ${texts.length} texts`} value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
      </div>
      <p className="muted">
        Text uses the game's own character set ($80 = "A"), with control codes for new lines, paragraphs and the player's and
        rival's names. Most dialogue lives in the "Text" banks and is reached with text_far from the map scripts.
      </p>
      {(focus ? [focus, ...shown.filter((d) => d !== focus)] : shown).slice(0, 300).map(({ label, parts }) => (
        <article key={label.name} className={label === focus?.label ? "current" : ""}>
          <header>
            <button className="link" onClick={() => go({ view: "code", bank: label.bank, address: label.address })}>
              {label.name}
            </button>{" "}
            <span className="muted">{place(label.bank, label.address)}</span>
          </header>
          {parts.map((p, i) =>
            p.t === "text" ? (
              <pre key={i}>{p.text}</pre>
            ) : p.t === "far" ? (
              <div key={i}>
                <FarText bank={p.bank} address={p.address} />
              </div>
            ) : (
              <p key={i} className="muted">
                ‹{p.t === "command" ? p.name : "then runs code"}›
              </p>
            ),
          )}
        </article>
      ))}
    </div>
  );
}

function FarText({ bank, address }: { bank: number; address: number }) {
  const { rom, db, go } = useExplorer();
  const label = db.at(bank, address)[0];
  const parts = decodeTextScript(rom, romOffset(bank, address));
  return (
    <>
      <button className="link small" onClick={() => go({ view: "code", bank, address })}>
        text_far {label?.name ?? place(bank, address)}
      </button>
      {parts.map((p, i) => (p.t === "text" ? <pre key={i}>{p.text}</pre> : null))}
    </>
  );
}
