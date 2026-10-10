// The Map tab: every outdoor map stitched together by its connections (stitchOverworld), drawn
// from the ROM's own blocks in each town's colours, under a fog that lifts only where the player
// has walked (the journal's trail). Pan by dragging, pinch or scroll to zoom. Pins for the player
// and for friends playing now. "Places" lists where the player has been.
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { globalStep, monName, overworldPalette, stitchOverworld, type MapData, type StitchedWorld, type WorldData } from "@pokehd/rom";
import { niceName, type Catalogue } from "../dex/catalogue.ts";
import { useMenu } from "./context.ts";
import { Face } from "./PeopleTab.tsx";
import { Head, MonPic, Seg } from "./parts.tsx";

/** Pixels per step on the drawn map (half the Game Boy's 16, which keeps the whole map small). */
const PX = 8;
/** Steps either side of where the player walked that the fog lifts: about what the screen showed. */
const SIGHT = 5;

const stitchedFor = new WeakMap<WorldData, StitchedWorld>();
function stitched(world: WorldData): StitchedWorld {
  let s = stitchedFor.get(world);
  if (!s) stitchedFor.set(world, (s = stitchOverworld(world)));
  return s;
}

/** One map drawn at half size in its SGB colours. */
function drawMap(world: WorldData, map: MapData): HTMLCanvasElement {
  const tileset = world.tilesets[map.tileset]!;
  const palette = world.sgbPalettes[overworldPalette(map.id, map.tileset)]!;
  const rgb = palette.map((c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255] as const);
  const w = map.widthBlocks * 32;
  const h = map.heightBlocks * 32;
  const full = new ImageData(w, h);
  for (let by = 0; by < map.heightBlocks; by++)
    for (let bx = 0; bx < map.widthBlocks; bx++) {
      const block = map.blocks[by * map.widthBlocks + bx]!;
      for (let t = 0; t < 16; t++) {
        const tile = tileset.blocks[block * 16 + t]!;
        const ox = bx * 32 + (t % 4) * 8;
        const oy = by * 32 + (t >> 2) * 8;
        for (let p = 0; p < 64; p++) {
          const [r, g, b] = rgb[tileset.tiles[tile * 64 + p]!]!;
          const i = ((oy + (p >> 3)) * w + ox + (p & 7)) * 4;
          full.data[i] = r;
          full.data[i + 1] = g;
          full.data[i + 2] = b;
          full.data[i + 3] = 255;
        }
      }
    }
  const big = document.createElement("canvas");
  big.width = w;
  big.height = h;
  big.getContext("2d")!.putImageData(full, 0, 0);
  const out = document.createElement("canvas");
  out.width = w / 2;
  out.height = h / 2;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(big, 0, 0, w / 2, h / 2);
  return out;
}
const drawn = new WeakMap<MapData, HTMLCanvasElement>();
const mapCanvas = (world: WorldData, map: MapData) => {
  let c = drawn.get(map);
  if (!c) drawn.set(map, (c = drawMap(world, map)));
  return c;
};

interface View {
  x: number;
  y: number;
  scale: number;
}

export function MapTab() {
  const { world, journal, journalVersion, catalogue, open } = useMenu();
  const [show, setShow] = useState<"map" | "places">("map");
  const s = stitched(world);
  const places = useMemo(() => {
    const seen = new Map<string, number>();
    for (const p of journal?.places() ?? []) {
      const name = catalogue.placeOf(p.map)?.name;
      if (name && !seen.has(name)) seen.set(name, p.at);
    }
    return [...seen].map(([name, at]) => ({ name, at }));
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the journal changes in place; its version says when
  }, [journal, journalVersion, catalogue]);
  return (
    <>
      <Head title="Map" pill="Kanto" />
      <div className="dm-body">
        <Seg label="Show" value={show} onChange={setShow} options={[["map", "Map"], ["places", "Places"]]} />
        {show === "map" ? (
          <MapView stitched={s} />
        ) : (
          <div className="dm-list">
            {places.length === 0 && <p className="dm-empty">Go exploring!</p>}
            {places.map((p) => (
              <button key={p.name} type="button" className="dm-c dm-row" onClick={() => open({ kind: "place", name: p.name })}>
                <span className="grow">
                  <span>{p.name}</span>
                  <span className="sub">First visited {new Date(p.at).toLocaleDateString()}</span>
                </span>
                <span className="chev">›</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/** Where the player is on the stitched map: their own spot outdoors, or the town they're in. */
function outdoorSpot(s: StitchedWorld, catalogue: Catalogue, map: number, x: number, y: number) {
  const here = globalStep(s, map, x, y);
  if (here) return here;
  const town = catalogue.placeOf(map)?.maps.find((m) => s.byId.has(m));
  const m = town !== undefined ? s.byId.get(town) : undefined;
  if (!m) return null;
  return { x: m.x * 2 + m.widthBlocks, y: m.y * 2 + m.heightBlocks };
}

function MapView({ stitched: s }: { stitched: StitchedWorld }) {
  const { world, journal, journalVersion, game, friends, catalogue } = useMenu();
  const box = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const fogRef = useRef<HTMLCanvasElement>(null);
  const [layers, setLayers] = useState({ friends: true, today: false, open: false });
  const width = s.bounds.widthBlocks * 2;
  const height = s.bounds.heightBlocks * 2;
  const me = game ? outdoorSpot(s, catalogue, game.map, game.x, game.y) : null;
  const [view, setView] = useState<View | null>(null);

  // Start centred on the player, a little zoomed in.
  useEffect(() => {
    if (view || !box.current) return;
    const { width: bw, height: bh } = box.current.getBoundingClientRect();
    const scale = 1.2;
    const c = me ?? { x: width / 2, y: height / 2 };
    setView({ scale, x: bw / 2 - c.x * PX * scale, y: bh / 2 - c.y * PX * scale });
  }, [view, me, width, height]);

  // The maps walked on, and the fog over everything else.
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- the journal changes in place; its version says when
  const walked = useMemo(() => new Set(journal?.trailMaps() ?? []), [journal, journalVersion]);
  useEffect(() => {
    const el = layer.current;
    if (!el) return;
    for (const c of [...el.querySelectorAll("canvas.map")]) c.remove();
    for (const m of s.maps) {
      if (!walked.has(m.id) && game?.map !== m.id) continue;
      const data = world.maps[m.id];
      if (!data) continue;
      const c = mapCanvas(world, data);
      const copy = document.createElement("canvas");
      copy.width = c.width;
      copy.height = c.height;
      copy.getContext("2d")!.drawImage(c, 0, 0);
      copy.className = "map";
      copy.style.left = `${m.x * 2 * PX}px`;
      copy.style.top = `${m.y * 2 * PX}px`;
      el.prepend(copy);
    }
  }, [s, world, walked, game?.map]);
  useEffect(() => {
    const fog = fogRef.current;
    if (!fog || !journal) return;
    fog.width = width;
    fog.height = height;
    const ctx = fog.getContext("2d")!;
    ctx.fillStyle = "#24361f";
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "destination-out";
    for (const id of journal.trailMaps()) {
      const m = s.byId.get(id);
      if (!m) continue;
      for (const [x, y] of journal.trail(id)) {
        ctx.beginPath();
        ctx.arc(m.x * 2 + x + 0.5, m.y * 2 + y + 0.5, SIGHT, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (layers.today) {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#e0702acc";
      for (const id of journal.trailMaps(true)) {
        const m = s.byId.get(id);
        if (m) for (const [x, y] of journal.trail(id, true)) ctx.fillRect(m.x * 2 + x + 0.3, m.y * 2 + y + 0.3, 0.4, 0.4);
      }
    }
  }, [s, journal, journalVersion, width, height, layers.today]);

  // Panning and pinching with pointers; the wheel zooms.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const zoomAt = (factor: number, cx: number, cy: number) =>
    setView((v) => {
      if (!v) return v;
      const scale = Math.min(6, Math.max(0.25, v.scale * factor));
      const f = scale / v.scale;
      return { scale, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
    });
  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
  };
  const onMove = (e: ReactPointerEvent) => {
    const ps = pointers.current;
    const last = ps.get(e.pointerId);
    if (!last) return;
    const now = local(e);
    if (ps.size === 1) setView((v) => v && { ...v, x: v.x + now.x - last.x, y: v.y + now.y - last.y });
    else if (ps.size === 2) {
      const other = [...ps].find(([id]) => id !== e.pointerId)![1];
      const before = Math.hypot(last.x - other.x, last.y - other.y);
      const after = Math.hypot(now.x - other.x, now.y - other.y);
      if (before > 0) zoomAt(after / before, (now.x + other.x) / 2, (now.y + other.y) / 2);
    }
    ps.set(e.pointerId, now);
  };
  const onUp = (e: ReactPointerEvent) => void pointers.current.delete(e.pointerId);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      zoomAt(Math.exp(-e.deltaY / 400), p.x, p.y);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const centre = () => {
    if (!me || !box.current) return;
    const { width: bw, height: bh } = box.current.getBoundingClientRect();
    setView((v) => v && { ...v, x: bw / 2 - me.x * PX * v.scale, y: bh / 2 - me.y * PX * v.scale });
  };
  const pin = (p: { x: number; y: number }) => ({ left: (p.x + 0.5) * PX, top: (p.y + 0.5) * PX });
  return (
    <div ref={box} className="dm-map" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <div ref={layer} className="dm-map-world" style={view ? { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, width: width * PX, height: height * PX } : { visibility: "hidden" }}>
        <canvas ref={fogRef} className="fog" style={{ width: width * PX, height: height * PX, left: 0, top: 0 }} />
        {me && (
          <span className="dm-map-pin me" style={pin(me)} aria-label="You">
            ★
          </span>
        )}
        {layers.friends &&
          friends.map((f) => {
            if (!f.presence) return null;
            const at = outdoorSpot(s, catalogue, f.presence.mapId, f.presence.x, f.presence.y);
            if (!at || !journal?.visited(f.presence.mapId, f.presence.x, f.presence.y)) return null;
            return (
              <span key={f.id} className="dm-map-pin friend" style={pin(at)} aria-label={f.name}>
                {f.name.slice(0, 1).toUpperCase()}
              </span>
            );
          })}
      </div>
      <div className="dm-map-tools">
        <button type="button" aria-label="Zoom in" onClick={() => zoomAt(1.4, box.current!.clientWidth / 2, box.current!.clientHeight / 2)}>
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.4, box.current!.clientWidth / 2, box.current!.clientHeight / 2)}>
          −
        </button>
        <button type="button" aria-label="Where am I?" onClick={centre}>
          ◎
        </button>
        <button type="button" aria-label="Layers" aria-expanded={layers.open} onClick={() => setLayers({ ...layers, open: !layers.open })}>
          ≡
        </button>
      </div>
      {layers.open && (
        <div className="dm-layers dm-c">
          <label className="dm-toggle">
            <input type="checkbox" checked={layers.friends} onChange={(e) => setLayers({ ...layers, friends: e.target.checked })} />
            Friends
          </label>
          <label className="dm-toggle">
            <input type="checkbox" checked={layers.today} onChange={(e) => setLayers({ ...layers, today: e.target.checked })} />
            Today's walk
          </label>
        </div>
      )}
      <div className="dm-map-hint">Drag to move. Pinch to zoom.</div>
    </div>
  );
}

export function PlacePage({ name }: { name: string }) {
  const { catalogue, game, journal, rom, open } = useMenu();
  const place = catalogue.places.find((p) => p.name === name);
  if (!place) return <Head title={name} back />;
  const wild = [...new Set([...place.grass, ...place.water])].filter((dex) => game?.seen.has(dex));
  const unseen = new Set([...place.grass, ...place.water]).size - wild.length;
  const people = (journal?.people() ?? []).filter((p) => place.maps.includes(p.map));
  return (
    <>
      <Head title={name} back />
      <div className="dm-body">
        {(wild.length > 0 || unseen > 0) && (
          <>
            <div className="dm-section">
              <span>Wild Pokémon</span>
            </div>
            <div className="dm-grid">
              {wild.map((dex) => {
                const e = catalogue.entries[dex - 1]!;
                return (
                  <button key={dex} type="button" className="dm-mon dm-c" onClick={() => open({ kind: "mon", dex })}>
                    <MonPic species={e.species} className="" />
                    <span>{niceName(monName(rom, e.species))}</span>
                  </button>
                );
              })}
              {Array.from({ length: unseen }, (_, i) => (
                <span key={`u${i}`} className="dm-mon dm-c unseen">
                  <span className="q">?</span>
                </span>
              ))}
            </div>
          </>
        )}
        {people.length > 0 && (
          <>
            <div className="dm-section">
              <span>People you met here</span>
            </div>
            <div className="dm-list">
              {people.map((m) => {
                const person = catalogue.person(m.map, m.npc);
                if (!person) return null;
                return (
                  <button key={person.key} type="button" className="dm-c dm-row" onClick={() => open({ kind: "person", key: person.key })}>
                    <Face person={person} />
                    <span className="grow">{person.name}</span>
                    <span className="chev">›</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}
