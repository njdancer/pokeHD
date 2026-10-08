// The ROM explorer (/explore): a guided look inside the cartridge and the CPU running it. Uses the
// same ROM the game does (the player's own, or Nick's cartridge for his friends); nothing here
// is shipped, and nothing writes to the player's saves.
import { useCallback, useEffect, useMemo, useState } from "react";
import { POKEBLUE_SHA1, sha1Hex } from "@pokehd/rom";
import { labelDb, type Label } from "@pokehd/rom/explore";
import { fetchDevRom } from "../dev-rom.ts";
import { MapViewer } from "../dev/MapViewer.tsx";
import { loadStoredRom } from "../rom-store.ts";
import { readResumePoint } from "../saves/resume-store.ts";
import { loadSave, romKey } from "../saves/save-store.ts";
import { TextView, PicsView, TilesView, VramView } from "./AssetViews.tsx";
import { CodeView } from "./CodeView.tsx";
import { ExplorerContext, useExplorer, type Explorer as ExplorerState } from "./context.ts";
import { CpuPanel } from "./CpuPanel.tsx";
import { KIND_INFO, parseRoute, place, routeForLabel, routeHash, type Route } from "./format.ts";
import { LayoutView } from "./LayoutView.tsx";
import { MemoryView } from "./MemoryView.tsx";
import { EmuSession, type BootFrom } from "./session.ts";
import "./explore.css";

const TABS: { view: Route["view"] | "maps"; name: string }[] = [
  { view: "layout", name: "Layout" },
  { view: "code", name: "Code" },
  { view: "memory", name: "Memory" },
  { view: "tiles", name: "Tiles" },
  { view: "pics", name: "Pictures" },
  { view: "maps", name: "Maps" },
  { view: "vram", name: "Video RAM" },
  { view: "text", name: "Text" },
];

export function Explorer() {
  const [rom, setRom] = useState<Uint8Array | null>(null);
  const [problem, setProblem] = useState("");
  const [route, setRoute] = useState<Route | { view: "maps" }>(() => (location.hash === "#/maps" ? { view: "maps" } : parseRoute(location.hash)));
  const [session, setSession] = useState<EmuSession | null>(null);
  const [booting, setBooting] = useState("");
  const [cpuOpen, setCpuOpen] = useState(() => matchMedia("(min-width: 1001px)").matches);
  const db = useMemo(() => labelDb(), []);

  useEffect(() => {
    document.title = "ROM explorer";
    (async () => {
      const found = (await fetchDevRom()) ?? (await loadStoredRom());
      if (!found) return setProblem("There's no ROM in this browser yet. Load yours on the game's page first, then come back.");
      if ((await sha1Hex(found)) !== POKEBLUE_SHA1) {
        setProblem("This ROM isn't the one the explorer's labels were made for, so addresses and names won't line up.");
      }
      setRom(found);
    })().catch((e: unknown) => setProblem(String(e)));
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(location.hash === "#/maps" ? { view: "maps" } : parseRoute(location.hash));
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => () => session?.dispose(), [session]);

  const go = useCallback((next: Route) => {
    const hash = routeHash(next);
    if (location.hash !== hash) location.hash = hash;
    else setRoute(next);
  }, []);

  const boot = async (from: BootFrom) => {
    if (!rom) return;
    setBooting("Starting…");
    try {
      const key = await romKey(rom);
      const sram = from === "power" ? undefined : ((await loadSave(key)) ?? undefined);
      const point = from === "resume" ? await readResumePoint(key) : null;
      if (from === "resume" && !point) return setBooting("There's no resume point in this browser yet; try “From my save”.");
      if (from === "save" && !sram) return setBooting("There's no save in this browser yet.");
      const s = await EmuSession.create(rom, sram, point?.state);
      setSession(s);
      setBooting("");
      s.setMode("running");
    } catch (e) {
      setBooting(`Couldn't start: ${String(e)}`);
    }
  };

  if (!rom) {
    return (
      <div className="explorer loading">
        <p>{problem || "Loading the ROM…"}</p>
        {problem && <a href="/">Go to the game</a>}
      </div>
    );
  }

  const state: ExplorerState = { rom, db, session, route: route.view === "maps" ? { view: "layout" } : route, go };
  const tabRoute = (view: string): Route => {
    if (view === "code") return { view: "code", bank: 0, address: 0x100 };
    if (view === "memory") return { view: "memory", address: 0xc000 };
    if (view === "tiles") {
      const font = db.byName.get("FontGraphics")!;
      return { view: "tiles", bank: font.bank, address: font.address, format: "1bpp" };
    }
    return { view } as Route;
  };

  return (
    <ExplorerContext.Provider value={state}>
      <div className={`explorer ${cpuOpen ? "with-cpu" : ""}`}>
        <header className="explorer-top">
          <a className="home" href="/" title="Back to the game">
            ←
          </a>
          <strong>ROM explorer</strong>
          <nav className="tabs">
            {TABS.map((t) => (
              <button
                key={t.view}
                className={route.view === t.view ? "on" : ""}
                onClick={() => (t.view === "maps" ? (location.hash = "#/maps") : go(tabRoute(t.view)))}
              >
                {t.name}
              </button>
            ))}
          </nav>
          <Search />
          <button className={`cpu-toggle ${cpuOpen ? "on" : ""}`} onClick={() => setCpuOpen(!cpuOpen)}>
            CPU
          </button>
        </header>
        {problem && <p className="warning">{problem}</p>}
        <main className="explorer-main">
          {route.view === "layout" && <LayoutView />}
          {route.view === "code" && <CodeView bank={route.bank} address={route.address} />}
          {route.view === "memory" && <MemoryView address={route.address} />}
          {route.view === "tiles" && <TilesView bank={route.bank} address={route.address} format={route.format} />}
          {route.view === "pics" && <PicsView name={route.name} />}
          {route.view === "vram" && <VramView />}
          {route.view === "text" && <TextView name={route.name} />}
          {route.view === "maps" && (
            <div className="maps-view">
              <p className="muted explain">
                Maps are grids of 32×32-pixel blocks. Each block is 4×4 tiles, looked up in the tileset's block set, so a whole
                town fits in a few hundred bytes. This draws them straight from the map headers in your ROM.
              </p>
              <MapViewer />
            </div>
          )}
        </main>
        {cpuOpen && <CpuPanel boot={(f) => void boot(f)} booting={booting} />}
      </div>
    </ExplorerContext.Provider>
  );
}

/** Jump to any of the ~21,000 labels by name. */
function Search() {
  const { db, go } = useExplorer();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const results = useMemo(() => {
    if (q.length < 2) return [];
    const needle = q.toLowerCase();
    const starts: Label[] = [];
    const contains: Label[] = [];
    for (const l of db.labels) {
      const n = l.name.toLowerCase();
      if (n.startsWith(needle)) starts.push(l);
      else if (n.includes(needle)) contains.push(l);
      if (starts.length > 40) break;
    }
    return [...starts, ...contains].slice(0, 40);
  }, [db, q]);
  const pick = (l: Label) => {
    go(routeForLabel(l));
    setOpen(false);
    setQ("");
  };
  return (
    <div className="search">
      <input
        placeholder="Jump to a label…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) pick(results[0]);
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && results.length > 0 && (
        <ul className="results">
          {results.map((l) => (
            <li key={l.name}>
              <button onMouseDown={() => pick(l)}>
                <i style={{ background: KIND_INFO[l.kind].colour }} />
                {l.name} <span className="muted">{place(l.bank, l.address)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
