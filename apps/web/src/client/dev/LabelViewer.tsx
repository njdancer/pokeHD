// Dev-only: reviews the semantic label table. Open /#labels on the dev server.
// Tiles and blocks are tinted by label; click a tile to inspect it and the blocks that use it.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  blockLabels,
  LABEL_TABLES,
  LABELS,
  parseWorld,
  seedLabels,
  tileLabels,
  type Label,
  type Tileset,
  type WorldData,
} from "@pokehd/rom";
import { fetchDevRom } from "../dev-rom.ts";
import { COLOURS } from "./label-colours.ts";
import { loadStoredRom } from "../rom-store.ts";

const SHADES = [0xe0, 0x98, 0x58, 0x18];

const TILE = 8;

/** Draws tiles (by ID) in a grid, greyscale with a label tint over each. */
function drawTiles(
  canvas: HTMLCanvasElement,
  tileset: Tileset,
  ids: number[],
  labels: (Label | undefined)[],
  cols: number,
  scale: number,
  tint: boolean,
  selected: number | null,
) {
  const rows = Math.ceil(ids.length / cols);
  canvas.width = cols * TILE * scale;
  canvas.height = rows * TILE * scale;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(cols * TILE, rows * TILE);
  ids.forEach((t, n) => {
    const ox = (n % cols) * TILE;
    const oy = Math.floor(n / cols) * TILE;
    for (let p = 0; p < 64; p++) {
      const v = SHADES[tileset.tiles[t * 64 + p]!]!;
      img.data.set([v, v, v, 255], ((oy + (p >> 3)) * cols * TILE + ox + (p & 7)) * 4);
    }
  });
  createImageBitmap(img).then((bmp) => {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    ids.forEach((t, n) => {
      const x = (n % cols) * TILE * scale;
      const y = Math.floor(n / cols) * TILE * scale;
      const label = labels[n];
      if (tint) {
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = label ? COLOURS[label] : "#ff00ff";
        ctx.fillRect(x, y, TILE * scale, TILE * scale);
        ctx.globalAlpha = 1;
      }
      if (t === selected) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 1.5, y + 1.5, TILE * scale - 3, TILE * scale - 3);
      }
    });
  });
}

function TileGrid(props: {
  tileset: Tileset;
  ids: number[];
  labels: (Label | undefined)[];
  cols: number;
  scale: number;
  tint: boolean;
  selected: number | null;
  onPick?: (index: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { tileset, ids, labels, cols, scale, tint, selected, onPick } = props;
  useEffect(() => {
    drawTiles(ref.current!, tileset, ids, labels, cols, scale, tint, selected);
  }, [tileset, ids, labels, cols, scale, tint, selected]);
  return (
    <canvas
      ref={ref}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const col = Math.floor((e.clientX - r.left) / (TILE * scale));
        const row = Math.floor((e.clientY - r.top) / (TILE * scale));
        onPick?.(row * cols + col);
      }}
    />
  );
}

const hex = (n: number) => `0x${n.toString(16).padStart(2, "0")}`;

export function LabelViewer() {
  const [world, setWorld] = useState<WorldData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tilesetId, setTilesetId] = useState(0);
  const [tint, setTint] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const rom = (await fetchDevRom()) ?? (await loadStoredRom());
      if (!rom) return setError("No ROM: load one in the app first.");
      setWorld(parseWorld(rom));
    })().catch((e: unknown) => setError(String(e)));
  }, []);

  const tileset = world?.tilesets[tilesetId];
  const derived = useMemo(() => {
    if (!tileset) return null;
    const blocks = blockLabels(tileset);
    return {
      tiles: tileLabels(tileset),
      seeds: seedLabels(tileset),
      blocks,
      blockIds: Array.from({ length: tileset.blockCount }, (_, b) => b),
    };
  }, [tileset]);

  if (error) return <div className="label-viewer">{error}</div>;
  if (!world || !tileset || !derived) return <div className="label-viewer">Parsing ROM…</div>;

  const table = LABEL_TABLES[tileset.name];
  const allTiles = Array.from({ length: 96 }, (_, t) => t);
  const usedIn =
    selected === null
      ? []
      : derived.blockIds.filter((b) => tileset.blocks.subarray(b * 16, b * 16 + 16).includes(selected));
  const maps = world.maps.filter((m) => m?.tileset === tileset.id).map((m) => m!.name);

  return (
    <div className="label-viewer">
      <header>
        <select value={tilesetId} onChange={(e) => (setTilesetId(Number(e.target.value)), setSelected(null))}>
          {world.tilesets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.id} {t.name} {LABEL_TABLES[t.name] ? "" : "(seeds only)"}
            </option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={tint} onChange={(e) => setTint(e.target.checked)} /> tint by label
        </label>
        <span>
          {derived.tiles.filter(Boolean).length}/96 tiles labelled · used by {maps.length} maps
        </span>
      </header>
      <ul className="legend">
        {LABELS.map((l) => (
          <li key={l}>
            <i style={{ background: COLOURS[l] }} /> {l}
          </li>
        ))}
        <li>
          <i style={{ background: "#ff00ff" }} /> unlabelled
        </li>
      </ul>
      <div className="panes">
        <section>
          <h2>Tiles</h2>
          <TileGrid
            tileset={tileset}
            ids={allTiles}
            labels={derived.tiles}
            cols={16}
            scale={5}
            tint={tint}
            selected={selected}
            onPick={(t) => setSelected(t < 96 ? t : null)}
          />
          {selected !== null && (
            <div className="inspect">
              <h3>
                Tile {hex(selected)}: {derived.tiles[selected] ?? "unlabelled"}
              </h3>
              <p>
                {table?.tiles[selected] ? "Hand label" : derived.seeds[selected] ? "From the ROM" : "No label"}
                {table?.tiles[selected] && derived.seeds[selected] ? ` (ROM says ${derived.seeds[selected]})` : ""}
                {tileset.semantics.walkable.includes(selected) ? " · walkable" : " · solid"}
              </p>
              <p>Used in {usedIn.length} blocks (overrides shown in place):</p>
              <div className="blocks">
                {usedIn.map((b) => (
                  <figure key={b}>
                    <TileGrid
                      tileset={tileset}
                      ids={Array.from(tileset.blocks.subarray(b * 16, b * 16 + 16))}
                      labels={derived.blocks[b]!}
                      cols={4}
                      scale={3}
                      tint={tint}
                      selected={selected}
                    />
                    <figcaption>
                      {hex(b)}
                      {table?.blocks[b] ? " *" : ""}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}
        </section>
        <section>
          <h2>Blocks</h2>
          <div className="blocks">
            {derived.blockIds.map((b) => (
              <figure key={b}>
                <TileGrid
                  tileset={tileset}
                  ids={Array.from(tileset.blocks.subarray(b * 16, b * 16 + 16))}
                  labels={derived.blocks[b]!}
                  cols={4}
                  scale={2}
                  tint={tint}
                  selected={selected}
                  onPick={(i) => setSelected(tileset.blocks[b * 16 + i]!)}
                />
                <figcaption>
                  {hex(b)}
                  {table?.blocks[b] ? " *" : ""}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
