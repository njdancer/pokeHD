// The Map tab: Kanto from the ROM (world-map.ts) under a fog that lifts where you've been. Drag
// to move, pinch or + − to zoom, ◎ to find yourself. Layers add what the journal remembers:
// Pokémon met, items found, your trail, checkpoints, friends, wild areas. Tap anything for a card.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { MAP_NAMES } from "@pokehd/rom";
import { monPic, niceMon, spritePic, useEnv } from "../env.tsx";
import { useNav } from "../nav.tsx";
import { buildWorldMap, paintFog, type Pin, type PinKind, type WorldMap } from "../world-map.ts";
import { Avatar } from "./People.tsx";
import { Page, Pixel, Row, Seg } from "../ui.tsx";
import { SPRITE_NAMES } from "@pokehd/rom";

const mapId = (name: string) => MAP_NAMES.indexOf(name);

/** Journal samples for the layers: where things happened, in steps on a map. */
const ENCOUNTERS: { dex: number; map: string; x: number; y: number; how: "caught" | "seen" | "battled"; text: string; today?: boolean }[] = [
  { dex: 7, map: "PALLET_TOWN", x: 12, y: 12, how: "caught", text: "Your first partner, from PROF. OAK" },
  { dex: 16, map: "ROUTE_1", x: 10, y: 24, how: "caught", text: "Caught at level 3" },
  { dex: 19, map: "ROUTE_1", x: 6, y: 12, how: "caught", text: "Caught at level 4" },
  { dex: 32, map: "ROUTE_22", x: 14, y: 8, how: "caught", text: "Caught at level 4" },
  { dex: 13, map: "ROUTE_2", x: 4, y: 50, how: "seen", text: "Seen near Viridian Forest" },
  { dex: 95, map: "PEWTER_CITY", x: 16, y: 18, how: "battled", text: "BROCK's ONIX. Beaten" },
  { dex: 21, map: "ROUTE_3", x: 20, y: 6, how: "seen", text: "Seen 6 times" },
  { dex: 39, map: "ROUTE_3", x: 40, y: 10, how: "seen", text: "Seen twice" },
  { dex: 27, map: "ROUTE_4", x: 30, y: 8, how: "caught", text: "Caught at level 9" },
  { dex: 121, map: "CERULEAN_CITY", x: 30, y: 20, how: "battled", text: "MISTY's STARMIE. Beaten" },
  { dex: 63, map: "ROUTE_24", x: 10, y: 20, how: "seen", text: "Seen once. It teleported away" },
  { dex: 69, map: "ROUTE_25", x: 20, y: 6, how: "seen", text: "Seen 3 times" },
  { dex: 17, map: "ROUTE_6", x: 10, y: 20, how: "battled", text: "A trainer's PIDGEOTTO", today: true },
  { dex: 96, map: "ROUTE_11", x: 8, y: 8, how: "seen", text: "Seen just now", today: true },
];
const FINDS: { item: string; map: string; x: number; y: number; text: string; today?: boolean }[] = [
  { item: "POTION", map: "ROUTE_1", x: 12, y: 30, text: "Lying on Route 1" },
  { item: "TOWN MAP", map: "PALLET_TOWN", x: 4, y: 5, text: "From DAISY" },
  { item: "HM01", map: "VERMILION_CITY", x: 18, y: 30, text: "From the S.S. ANNE's captain", today: true },
  { item: "BICYCLE", map: "CERULEAN_CITY", x: 13, y: 26, text: "Cerulean Bike Shop", today: true },
];
const CHECKPOINTS: { place: string; map: string; x: number; y: number; when: string; today?: boolean }[] = [
  { place: "Vermilion City", map: "VERMILION_CITY", x: 11, y: 4, when: "10 minutes ago", today: true },
  { place: "Cerulean City", map: "CERULEAN_CITY", x: 19, y: 18, when: "1 hour ago", today: true },
  { place: "Pewter City", map: "PEWTER_CITY", x: 13, y: 26, when: "Yesterday" },
];
const FRIEND_AT: Record<string, [string, number, number]> = { nick: ["CELADON_CITY", 20, 12], sam: ["ROUTE_3", 30, 8] };
const TRAIL = ["PALLET_TOWN", "ROUTE_1", "VIRIDIAN_CITY", "ROUTE_2", "PEWTER_CITY", "ROUTE_3", "ROUTE_4", "CERULEAN_CITY", "ROUTE_5", "ROUTE_6", "VERMILION_CITY"];
const TODAY_FROM = 7;

type LayerId = "places" | "mons" | "finds" | "trail" | "saves" | "friends" | "wild";
const LAYERS: [LayerId, string, string][] = [
  ["places", "Places", "#2f7d5b"],
  ["mons", "Pokémon met", "#4caf50"],
  ["finds", "Items found", "#e8473b"],
  ["trail", "Your trail", "#e0702a"],
  ["saves", "Checkpoints", "#2c6fd6"],
  ["friends", "Friends", "#8e5bb5"],
  ["wild", "Wild areas", "#62b05a"],
];

type Sel =
  | { t: "place"; place: string }
  | { t: "pin"; i: number }
  | { t: "mon"; i: number }
  | { t: "find"; i: number }
  | { t: "save"; i: number }
  | { t: "friend"; id: string }
  | { t: "fog" };

const PIN_LOOK: Record<PinKind, [string, string, string]> = {
  center: ["#e8473b", "+", "Pokémon Center"],
  mart: ["#2c6fd6", "M", "Poké Mart"],
  gym: ["#c9a227", "★", "Gym"],
  dock: ["#2f7d5b", "⚓", "Dock"],
  house: ["#8e5bb5", "•", "House"],
};

const niceName = (s: string) => s.toLowerCase().replace(/(^|[ .])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase()).replace("Mt.moon", "Mt. Moon");

/** Painting Kanto takes a moment, so it's kept per ROM. */
const painted = new WeakMap<Uint8Array, { map: WorldMap; art: string }>();
function useWorldMap(rom: Uint8Array, world: Parameters<typeof buildWorldMap>[1]) {
  return useMemo(() => {
    let p = painted.get(rom);
    if (!p) {
      const map = buildWorldMap(rom, world);
      painted.set(rom, (p = { map, art: map.paint().toDataURL() }));
    }
    return p;
  }, [rom, world]);
}

export function MapScreen({ focus }: { focus?: string }) {
  const env = useEnv();
  const nav = useNav();
  const { map, art } = useWorldMap(env.rom, env.world);
  const { model } = env;
  const [mode, setMode] = useState<"map" | "index">("map");
  const [layers, setLayers] = useState<Record<LayerId, boolean>>({ places: true, mons: true, finds: false, trail: false, saves: false, friends: true, wild: false });
  const [today, setToday] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const partly = useMemo(() => new Set(["ROUTE 11"]), []);
  const fog = useMemo(() => paintFog(map, model.visited, partly).toDataURL(), [map, model.visited, partly]);
  const here = map.at(model.here.map, model.here.x, model.here.y);
  const [view, setView] = useState(() => {
    const a = focus ? map.area(focus) : undefined;
    return a ? { x: a.x + a.w / 2, y: a.y + a.h / 2, z: 0.5 } : { x: here.x, y: here.y, z: 0.45 };
  });
  const [sel, setSel] = useState<Sel | null>(() => (focus ? { t: "place", place: map.area(focus)?.place ?? focus.toUpperCase() } : null));
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pts: Map<number, { x: number; y: number }>; moved: boolean; start?: { x: number; y: number; z: number; d: number; cx: number; cy: number } }>({ pts: new Map(), moved: false });

  const clampZ = (z: number) => Math.min(2.5, Math.max(0.1, z));
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => ({ ...v, z: clampZ(v.z * (e.deltaY > 0 ? 0.9 : 1.11)) }));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [mode]);

  const down = (e: React.PointerEvent) => {
    const d = drag.current;
    d.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    d.moved = false;
    const pts = [...d.pts.values()];
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const dist = pts.length > 1 ? Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) : 0;
    d.start = { x: view.x, y: view.y, z: view.z, d: dist, cx, cy };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.pts.has(e.pointerId) || !d.start) return;
    d.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...d.pts.values()];
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    if (!d.moved && (Math.hypot(cx - d.start.cx, cy - d.start.cy) > 5 || pts.length > 1)) {
      d.moved = true;
      // Capture only once it's a drag, so a tap still reaches the pin under the finger.
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    const s = d.start;
    const z = pts.length > 1 && s.d ? clampZ(s.z * (Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) / s.d)) : s.z;
    setView({ x: s.x - (cx - s.cx) / z, y: s.y - (cy - s.cy) / z, z });
  };
  const up = (e: React.PointerEvent) => {
    const d = drag.current;
    d.pts.delete(e.pointerId);
    if (d.pts.size) {
      // One finger left after a pinch: carry on dragging from where it is.
      const [p] = [...d.pts.values()];
      d.start = { x: view.x, y: view.y, z: view.z, d: 0, cx: p!.x, cy: p!.y };
      return;
    }
    const t = e.target as HTMLElement;
    if (!d.moved && t.closest(".m-map-inner") && !t.closest("button")) pickAt(e);
  };
  const pickAt = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    const mx = view.x + (e.clientX - r.left - r.width / 2) / view.z;
    const my = view.y + (e.clientY - r.top - r.height / 2) / view.z;
    const a = map.areas.find((q) => mx >= q.x && mx < q.x + q.w && my >= q.y && my < q.y + q.h);
    setSel(a && model.visited.has(a.place) ? { t: "place", place: a.place } : { t: "fog" });
  };

  const visible = (today_: boolean | undefined) => !today || today_;
  const pos = (m: string, x: number, y: number) => map.at(mapId(m), x, y);
  const tap = (s: Sel) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!drag.current.moved) setSel(s);
  };
  const pinStyle = (x: number, y: number): CSSProperties => ({ left: x, top: y });
  const trail = TRAIL.map((n, i) => {
    const a = map.areas.find((q) => q.map.id === mapId(n))!;
    return { x: a.x + a.w / 2, y: a.y + a.h / 2, today: i >= TODAY_FROM };
  });

  if (mode === "index") {
    const places = map.areas.filter((a) => model.visited.has(a.place)).sort((a, b) => Number(b.town) - Number(a.town) || a.place.localeCompare(b.place));
    return (
      <Page title="Map" meta={`${places.length} places`}>
        <Seg<"map" | "index"> label="View" value={mode} onChange={setMode} options={[["map", "Map"], ["index", "Places"]]} />
        <div className="m-list">
          {places.map((a) => (
            <Row
              key={a.place}
              title={niceName(a.place)}
              sub={`${a.town ? "Town" : "Route"}${partly.has(a.place) ? " · partly explored" : ""}${a.place === model.here.place ? " · you're here" : ""}`}
              onClick={() => {
                setMode("map");
                setView({ x: a.x + a.w / 2, y: a.y + a.h / 2, z: 0.5 });
                setSel({ t: "place", place: a.place });
              }}
            />
          ))}
        </div>
      </Page>
    );
  }

  return (
    <Page title="Map" meta="Kanto" wide>
      <div className="m-mapwrap">
        <div className={`m-map${view.z < 0.3 ? " far" : ""}`} ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} style={{ ["--z" as string]: view.z }}>
          <div className="m-map-inner" style={{ width: map.width, height: map.height, transform: `translate(-${view.x * view.z}px, -${view.y * view.z}px) scale(${view.z})` }}>
            <img className="m-map-art" src={art} alt="" draggable={false} />
            {layers.wild &&
              map.areas
                .filter((a) => model.visited.has(a.place) && env.catalogue.places.some((p) => p.name.toUpperCase() === a.place && (p.grass.length || p.water.length)))
                .map((a) => <span key={a.place} className="m-map-wild" style={{ left: a.x, top: a.y, width: a.w, height: a.h }} />)}
            <img className="m-map-fog" src={fog} alt="" draggable={false} />
            {layers.trail && (
              <svg className="m-map-trail" width={map.width} height={map.height}>
                {!today && <polyline points={trail.filter((p, i) => !p.today || trail[i - 1]?.today === false).map((p) => `${p.x},${p.y}`).join(" ")} className="old" />}
                <polyline points={trail.filter((p, i) => p.today || trail[i + 1]?.today).map((p) => `${p.x},${p.y}`).join(" ")} />
              </svg>
            )}
            {layers.places &&
              map.pins
                .filter((p) => model.visited.has(p.place))
                .map((p, i) => (
                  <button key={p.to} type="button" className={`m-pin${sel?.t === "pin" && sel.i === i ? " sel" : ""}`} style={{ ...pinStyle(p.x, p.y), ["--c" as string]: PIN_LOOK[p.kind][0] }} onClick={tap({ t: "pin", i })} aria-label={PIN_LOOK[p.kind][2]}>
                    {PIN_LOOK[p.kind][1]}
                  </button>
                ))}
            {layers.mons &&
              ENCOUNTERS.map((m, i) =>
                visible(m.today) ? (
                  <button key={i} type="button" className={`m-monpin ${m.how}${sel?.t === "mon" && sel.i === i ? " sel" : ""}`} style={pinStyle(pos(m.map, m.x, m.y).x, pos(m.map, m.x, m.y).y)} onClick={tap({ t: "mon", i })} aria-label={niceMon(env.catalogue.entries[m.dex - 1]!.name)}>
                    <Pixel src={monPic(env, m.dex)} />
                  </button>
                ) : null,
              )}
            {layers.finds &&
              FINDS.map((f, i) =>
                visible(f.today) ? (
                  <button key={i} type="button" className="m-findpin" style={pinStyle(pos(f.map, f.x, f.y).x, pos(f.map, f.x, f.y).y)} onClick={tap({ t: "find", i })} aria-label={f.item} />
                ) : null,
              )}
            {layers.saves &&
              CHECKPOINTS.map((c, i) =>
                visible(c.today) ? (
                  <button key={i} type="button" className="m-flagpin" style={pinStyle(pos(c.map, c.x, c.y).x, pos(c.map, c.x, c.y).y)} onClick={tap({ t: "save", i })} aria-label={`Checkpoint, ${c.place}`} />
                ) : null,
              )}
            {layers.friends &&
              model.friends
                .filter((f) => f.online && FRIEND_AT[f.id])
                .map((f) => {
                  const [m, x, y] = FRIEND_AT[f.id]!;
                  const p = pos(m, x, y);
                  return (
                    <button key={f.id} type="button" className="m-friendpin" style={pinStyle(p.x, p.y)} onClick={tap({ t: "friend", id: f.id })} aria-label={f.name}>
                      <Avatar friend={f} />
                    </button>
                  );
                })}
            {map.areas
              .filter((a) => a.town && model.visited.has(a.place))
              .map((a) => (
                <span key={a.place} className="m-map-label" style={pinStyle(a.x + a.w / 2, a.y - 6)}>
                  {niceName(a.place)}
                </span>
              ))}
            <span className="m-you" style={pinStyle(here.x, here.y)}>
              <Pixel src={spritePic(env, SPRITE_NAMES.indexOf("RED"))} />
            </span>
          </div>
          <div className="m-mapctl">
            <button type="button" className="m-round" aria-label="Zoom in" onClick={() => setView((v) => ({ ...v, z: clampZ(v.z * 1.4) }))}>+</button>
            <button type="button" className="m-round" aria-label="Zoom out" onClick={() => setView((v) => ({ ...v, z: clampZ(v.z / 1.4) }))}>−</button>
            <button type="button" className="m-round" aria-label="Find me" onClick={() => (setView({ x: here.x, y: here.y, z: 0.9 }), setSel({ t: "place", place: model.here.place }))}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor" /><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2.4" /></svg>
            </button>
            <button type="button" className={`m-round${layersOpen ? " on" : ""}`} aria-label="Layers" aria-pressed={layersOpen} onClick={() => setLayersOpen(!layersOpen)}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" /></svg>
            </button>
          </div>
          <div className="m-mapseg">
            <Seg<"map" | "index"> label="View" value={mode} onChange={setMode} options={[["map", "Map"], ["index", "Places"]]} />
          </div>
          {layersOpen && (
            <div className="m-layers" onPointerDown={(e) => e.stopPropagation()}>
              <div className="m-title">Show on the map</div>
              <Seg label="When" value={today ? "today" : "all"} onChange={(v) => setToday(v === "today")} options={[["all", "All time"], ["today", "Today"]]} />
              <div className="m-layerchips">
                {LAYERS.map(([id, label, c]) => (
                  <button key={id} type="button" aria-pressed={layers[id]} onClick={() => setLayers({ ...layers, [id]: !layers[id] })}>
                    <i style={{ background: c }} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <MapCard sel={sel} map={map} onClose={() => setSel(null)} go={(dex) => nav.tab("dex", { k: "entry", dex })} friend={(id) => nav.tab("people", { k: "friend", id })} saves={() => nav.tab("me", { k: "saves" })} />
        </div>
      </div>
    </Page>
  );
}

function MapCard({ sel, map, onClose, go, friend, saves }: { sel: Sel | null; map: WorldMap; onClose(): void; go(dex: number): void; friend(id: string): void; saves(): void }) {
  const env = useEnv();
  const { model } = env;
  if (!sel)
    return (
      <div className="m-mapcard hint">
        <span className="m-sub">Tap a place or a pin. Drag to move, pinch to zoom.</span>
      </div>
    );
  let body: React.ReactNode;
  if (sel.t === "fog") body = <><div className="m-title">Not explored yet</div><div className="m-sub">The clouds clear as you walk there.</div></>;
  else if (sel.t === "pin") {
    const p: Pin = map.pins.filter((q) => model.visited.has(q.place))[sel.i]!;
    body = (
      <>
        <div className="m-title">
          <span className="m-pinmark" style={{ background: PIN_LOOK[p.kind][0] }}>{PIN_LOOK[p.kind][1]}</span> {PIN_LOOK[p.kind][2]}
        </div>
        <div className="m-sub">{niceName(p.place)}{p.kind === "center" ? " · Heals your team. Trade and battle friends upstairs." : p.kind === "gym" ? " · Beat the leader for a badge." : p.kind === "mart" ? " · Buy Poké Balls and potions here." : ""}</div>
      </>
    );
  } else if (sel.t === "mon") {
    const m = ENCOUNTERS[sel.i]!;
    body = (
      <div className="m-mapcard-row">
        <Pixel src={monPic(env, m.dex)} />
        <div>
          <div className="m-title">
            {niceMon(env.catalogue.entries[m.dex - 1]!.name)} <span className={`m-tag ${m.how}`}>{m.how}</span>
          </div>
          <div className="m-sub">{m.text}{m.today ? " · today" : ""}</div>
        </div>
        <button type="button" className="m-pill" onClick={() => go(m.dex)}>Look</button>
      </div>
    );
  } else if (sel.t === "find") {
    const f = FINDS[sel.i]!;
    body = <><div className="m-title">{f.item}</div><div className="m-sub">{f.text}{f.today ? " · today" : ""}</div></>;
  } else if (sel.t === "save") {
    const c = CHECKPOINTS[sel.i]!;
    body = (
      <div className="m-mapcard-row">
        <div>
          <div className="m-title">Checkpoint · {c.place}</div>
          <div className="m-sub">{c.when}</div>
        </div>
        <button type="button" className="m-pill" onClick={saves}>Go back…</button>
      </div>
    );
  } else if (sel.t === "friend") {
    const f = model.friends.find((x) => x.id === sel.id)!;
    body = (
      <div className="m-mapcard-row">
        <Avatar friend={f} />
        <div>
          <div className="m-title">{f.name} is here</div>
          <div className="m-sub">{f.where} · playing now</div>
        </div>
        <button type="button" className="m-pill" onClick={() => friend(f.id)}>See</button>
      </div>
    );
  } else {
    const place = env.catalogue.places.find((p) => p.name.toUpperCase() === sel.place);
    const wild = place ? [...new Set([...place.grass, ...place.water])] : [];
    const seen = wild.filter((d) => model.seen.has(d));
    body = (
      <>
        <div className="m-title">{niceName(sel.place)}</div>
        <div className="m-sub">{sel.place === model.here.place ? "You're here" : model.visited.has(sel.place) ? "Explored" : "Not explored yet"}</div>
        {wild.length > 0 && (
          <div className="m-wildrow">
            {seen.map((d) => (
              <button key={d} type="button" onClick={() => go(d)} aria-label={niceMon(env.catalogue.entries[d - 1]!.name)}>
                <Pixel src={monPic(env, d)} />
              </button>
            ))}
            {wild.length > seen.length && <span className="m-unseen">+{wild.length - seen.length} not seen yet</span>}
          </div>
        )}
      </>
    );
  }
  return (
    <div className="m-mapcard" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
      <button type="button" className="m-mapcard-x" aria-label="Close" onClick={onClose}>×</button>
      {body}
    </div>
  );
}
