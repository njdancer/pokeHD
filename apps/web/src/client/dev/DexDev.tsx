// Dev page for the HD Pokédex's looks (p2-dex): the live HD world at a place, with the Pokédex
// held up over it, filled with an early-game journey. Open /dev/dex. URL options: ?look=device
// (or pixel, storybook), ?map=VIRIDIAN_CITY, ?page=pokemon|mon|people|places, ?mon=4.
// Once open, window.__dex.ready is true (for screenshots).
import { useEffect, useMemo, useRef, useState } from "react";
import { createEngine, DEFAULT_CYCLE, type Engine } from "@pokehd/engine";
import { createLiveWorld, standingState, type LiveWorld } from "@pokehd/engine/world";
import { MAP_NAMES, parseWorld, type WorldData } from "@pokehd/rom";
import { fetchDevRom } from "../dev-rom.ts";
import { loadStoredRom } from "../rom-store.ts";
import { buildCatalogue, type DexProgress } from "../dex/catalogue.ts";
import { Pokedex, type PokedexStyle } from "../dex/Pokedex.tsx";

const query = new URLSearchParams(location.search);
const map = (name: string) => MAP_NAMES.indexOf(name);

/** An early-game journey: Pallet Town to Pewter City, some catches, a few people. */
function sampleProgress(): DexProgress {
  const start = Date.parse("2026-10-01T09:00:00Z");
  const places = ["PALLET_TOWN", "REDS_HOUSE_1F", "OAKS_LAB", "ROUTE_1", "VIRIDIAN_CITY", "VIRIDIAN_POKECENTER", "ROUTE_22", "ROUTE_2", "VIRIDIAN_FOREST", "PEWTER_CITY", "PEWTER_GYM"];
  const said = (m: string, npc: number, text: string, beaten?: boolean) => ({ map: map(m), npc, at: start, said: text, beaten });
  return {
    seen: new Set([1, 4, 7, 10, 11, 13, 14, 16, 17, 19, 21, 25, 29, 32, 74, 95]),
    owned: new Set([4, 10, 13, 16, 19, 25, 29]),
    places: places.map((m, i) => ({ map: map(m), at: start + i * 600_000 })),
    people: [
      said("REDS_HOUSE_1F", 0, "MOM: Right.\nAll boys leave\nhome some day."),
      said("OAKS_LAB", 4, "OAK: Now, RED,\nwhich POKéMON do\nyou want?"),
      said("OAKS_LAB", 0, "BLUE: Heh, I don't\nneed to be greedy\nlike you!"),
      said("PALLET_TOWN", 1, "I'm raising\nPOKéMON too!"),
      said("VIRIDIAN_CITY", 6, "Ahh, I've had my\ncoffee now and I\nfeel great!"),
      said("VIRIDIAN_POKECENTER", 0, "Welcome to our\nPOKéMON CENTER!"),
      said("VIRIDIAN_FOREST", 1, "Hey! You have\nPOKéMON! Come on!\nLet's battle 'em!", true),
      said("VIRIDIAN_FOREST", 2, "Yo! You can't jam\nout if you're a\nPOKéMON trainer!", true),
      said("PEWTER_GYM", 0, "I'm BROCK!\nI'm PEWTER's GYM\nLEADER!"),
    ],
  };
}

export function DexDev() {
  const holder = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Loading…");
  const [data, setData] = useState<{ rom: Uint8Array; world: WorldData } | null>(null);
  const [look, setLook] = useState<PokedexStyle>((query.get("look") as PokedexStyle) ?? "device");
  const [open, setOpen] = useState(true);
  const [run, setRun] = useState(0);
  const progress = useMemo(() => sampleProgress(), []);
  const catalogue = useMemo(() => data && buildCatalogue(data.rom, data.world), [data]);

  useEffect(() => {
    let disposed = false;
    let engine: Engine | null = null;
    let live: LiveWorld | null = null;
    const canvas = document.createElement("canvas");
    canvas.className = "scene";
    holder.current!.prepend(canvas);
    (async () => {
      const rom = (await fetchDevRom()) ?? (await loadStoredRom());
      if (!rom) return setStatus("No ROM: load one in the app first.");
      const world = parseWorld(rom);
      if (disposed) return;
      setData({ rom, world });
      live = createLiveWorld(world);
      engine = await createEngine(canvas, { world: live });
      if (disposed) return engine.dispose();
      live.setLook(engine.look);
      Object.assign(engine.look.params.time, { phase: 0.45, drift: false });
      engine.look.setCycle(DEFAULT_CYCLE);
      const state = standingState(world, map((query.get("map") ?? "PALLET_TOWN").toUpperCase()));
      const l = live;
      const tick = () => {
        if (disposed) return;
        l.push(state, performance.now() / 1000);
        requestAnimationFrame(tick);
      };
      tick();
      setStatus(engine.backend);
    })().catch((e: unknown) => setStatus(String(e)));
    return () => {
      disposed = true;
      engine?.dispose();
      live?.dispose();
      canvas.remove();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => ((window as { __dex?: { ready: boolean } }).__dex = { ready: true }), 1400);
    return () => {
      clearTimeout(t);
      (window as { __dex?: { ready: boolean } }).__dex = { ready: false };
    };
  }, [open, look, run]);

  const page = query.get("page");
  const openOn = page === "mon" ? Number(query.get("mon") ?? 4) : undefined;
  return (
    <div className="live-page" ref={holder}>
      <div className="bench-panel" style={{ zIndex: 30, position: "fixed" }}>
        <p>{status}</p>
        {(["device", "pixel", "storybook"] as const).map((l) => (
          <button key={l} type="button" aria-pressed={look === l} onClick={() => (setLook(l), setOpen(true), setRun((n) => n + 1))}>
            {l}
          </button>
        ))}
        {!open && <button type="button" onClick={() => setOpen(true)}>Open</button>}
      </div>
      {data && catalogue && open && (
        <Pokedex key={`${look} ${run}`} rom={data.rom} world={data.world} catalogue={catalogue} progress={progress} style={look} openOn={openOn} tab={page === "people" || page === "places" ? page : undefined} onClosed={() => setOpen(false)} />
      )}
    </div>
  );
}
