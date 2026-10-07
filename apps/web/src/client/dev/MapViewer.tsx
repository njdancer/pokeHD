// Dev-only: draws any map flat in 2D from extracted WorldData, to check the parser by eye.
// Open /#maps on the dev server. Greyscale DMG shades; colour comes later from palette data.
import { useEffect, useMemo, useRef, useState } from "react";
import { blockLabels, parseWorld, type MapData, type WorldData } from "@pokehd/rom";
import { fetchDevRom } from "../dev-rom.ts";
import { loadStoredRom } from "../rom-store.ts";
import { COLOURS } from "./label-colours.ts";

const SHADES = [
  [0xe0, 0xf8, 0xd0],
  [0x88, 0xc0, 0x70],
  [0x34, 0x68, 0x56],
  [0x08, 0x18, 0x20],
] as const;
const SCALE = 2;
const STEP = 16;

function drawMap(ctx: CanvasRenderingContext2D, world: WorldData, map: MapData, overlay: boolean, tint: boolean) {
  const tileset = world.tilesets[map.tileset]!;
  const { blocks, tiles } = tileset;
  const w = map.widthBlocks * 32;
  const h = map.heightBlocks * 32;
  const img = ctx.createImageData(w, h);
  for (let by = 0; by < map.heightBlocks; by++) {
    for (let bx = 0; bx < map.widthBlocks; bx++) {
      const block = map.blocks[by * map.widthBlocks + bx]!;
      for (let t = 0; t < 16; t++) {
        const tile = blocks[block * 16 + t]!;
        const ox = bx * 32 + (t % 4) * 8;
        const oy = by * 32 + Math.floor(t / 4) * 8;
        for (let p = 0; p < 64; p++) {
          const shade = SHADES[tiles[tile * 64 + p]!]!;
          const i = ((oy + (p >> 3)) * w + ox + (p & 7)) * 4;
          img.data.set(shade, i);
          img.data[i + 3] = 255;
        }
      }
    }
  }
  ctx.canvas.width = w * SCALE;
  ctx.canvas.height = h * SCALE;
  ctx.imageSmoothingEnabled = false;
  createImageBitmap(img).then((bmp) => {
    ctx.drawImage(bmp, 0, 0, w * SCALE, h * SCALE);
    if (tint) {
      const labels = blockLabels(tileset);
      const size = 8 * SCALE;
      ctx.globalAlpha = 0.45;
      map.blocks.forEach((block, n) => {
        labels[block]!.forEach((label, i) => {
          ctx.fillStyle = label ? COLOURS[label] : "#ff00ff";
          const x = (n % map.widthBlocks) * 4 + (i % 4);
          const y = Math.floor(n / map.widthBlocks) * 4 + Math.floor(i / 4);
          ctx.fillRect(x * size, y * size, size, size);
        });
      });
      ctx.globalAlpha = 1;
    }
    if (!overlay) return;
    const mark = (x: number, y: number, colour: string) => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2;
      ctx.strokeRect(x * STEP * SCALE + 2, y * STEP * SCALE + 2, STEP * SCALE - 4, STEP * SCALE - 4);
    };
    for (const warp of map.warps) mark(warp.x, warp.y, "#ff3b6b");
    for (const sign of map.signs) mark(sign.x, sign.y, "#ffb000");
    for (const npc of map.npcs) mark(npc.x, npc.y, "#3b8bff");
  });
}

export function MapViewer() {
  const [world, setWorld] = useState<WorldData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapId, setMapId] = useState(0);
  const [overlay, setOverlay] = useState(true);
  const [tint, setTint] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    (async () => {
      const rom = (await fetchDevRom()) ?? (await loadStoredRom());
      if (!rom) return setError("No ROM: load one in the app first.");
      setWorld(parseWorld(rom));
    })().catch((e: unknown) => setError(String(e)));
  }, []);

  const map = world?.maps[mapId] ?? null;
  useEffect(() => {
    if (world && map) drawMap(canvasRef.current!.getContext("2d")!, world, map, overlay, tint);
  }, [world, map, overlay, tint]);

  const options = useMemo(() => world?.maps.filter((m): m is MapData => m !== null) ?? [], [world]);

  if (error) return <div className="map-viewer">{error}</div>;
  if (!world) return <div className="map-viewer">Parsing ROM…</div>;
  return (
    <div className="map-viewer">
      <header>
        <select value={mapId} onChange={(e) => setMapId(Number(e.target.value))}>
          {options.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id.toString(16).padStart(2, "0")} {m.name}
            </option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} /> warps (red),
          signs (amber), NPCs (blue)
        </label>
        <label>
          <input type="checkbox" checked={tint} onChange={(e) => setTint(e.target.checked)} /> tint by label (
          <a href="#labels" onClick={() => setTimeout(() => location.reload())}>
            label table
          </a>
          )
        </label>
        {map && (
          <span>
            {world.tilesets[map.tileset]!.name} · {map.widthBlocks}×{map.heightBlocks} blocks ·{" "}
            {map.connections.map((c) => `${c.direction} ${world.maps[c.map]?.name} (${c.offsetBlocks})`).join(", ") ||
              "no connections"}
          </span>
        )}
      </header>
      <canvas ref={canvasRef} />
    </div>
  );
}
