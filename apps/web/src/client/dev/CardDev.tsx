// The Pokédex entry as a trading card (prototype), standalone at /dev/card until Nick picks it:
// any Pokémon's card, in three finishes, tilted by the phone's gyro (tap the card first on an
// iPhone), the mouse, or a slow sway. Sliders for the foil, the gloss and the relief.
// URL options: ?mon=6, ?finish=holo|reverse|gold, ?down=1 (face down), ?all=1 (three finishes
// side by side), ?art=0 (the cartridge's picture). The game's entry page shows it with ?card.
import { useEffect, useMemo, useState } from "react";
import { parseWorld } from "@pokehd/rom";
import { fetchDevRom } from "../dev-rom.ts";
import { loadStoredRom } from "../rom-store.ts";
import { buildCatalogue, type Catalogue } from "../dex/catalogue.ts";
import { romLearns } from "../menu/live.ts";
import { cardOf } from "../menu/card/data.ts";
import type { Finish } from "../menu/card/face.ts";
import { TradingCard } from "../menu/card/TradingCard.tsx";
import type { MenuModel } from "../menu/model.ts";
import "./card-dev.css";

const query = new URLSearchParams(location.search);
const FINISHES: [Finish, string, string][] = [
  ["holo", "Holo", "Rainbow starlight behind the Pokémon"],
  ["reverse", "Reverse", "Lined foil all round, the picture matte"],
  ["gold", "Gold", "All-over gold, etched in a sunburst"],
];

export function CardDev() {
  const [data, setData] = useState<{ rom: Uint8Array; catalogue: Catalogue; learns: MenuModel["learns"] } | null>(null);
  const [status, setStatus] = useState("Loading…");
  const [dex, setDex] = useState(() => Math.min(151, Math.max(1, +(query.get("mon") ?? 6) || 6)));
  const [finish, setFinish] = useState<Finish>(() => (FINISHES.find(([f]) => f === query.get("finish"))?.[0] ?? "holo"));
  const [down, setDown] = useState(query.get("down") === "1");
  const [all, setAll] = useState(query.get("all") === "1");
  const [art, setArt] = useState(query.get("art") !== "0");
  const [foil, setFoil] = useState(1);
  const [shine, setShine] = useState(1);
  const [bump, setBump] = useState(1);
  const [range, setRange] = useState(16);

  useEffect(() => {
    (async () => {
      const rom = (await fetchDevRom()) ?? (await loadStoredRom());
      if (!rom) return setStatus("No ROM: load one in the app first.");
      const catalogue = buildCatalogue(rom, parseWorld(rom));
      setData({ rom, catalogue, learns: romLearns(rom, catalogue) });
      (window as { __card?: object }).__card = { ready: true };
    })().catch((e) => setStatus(String(e)));
  }, []);

  const card = useMemo(() => (data ? cardOf({ rom: data.rom, catalogue: data.catalogue, model: { learns: data.learns } as MenuModel }, dex, art) : null), [data, dex, art]);
  if (!data || !card) return <div className="cd-root"><p className="cd-status">{status}</p></div>;

  const step = (d: number) => setDex((n) => ((n - 1 + d + 151) % 151) + 1);
  const props = { card, faceDown: down, foil, shine, bump, range, onTap: () => {} };
  return (
    <div className="cd-root">
      <header className="cd-head">
        <button type="button" onClick={() => step(-1)} aria-label="Previous">‹</button>
        <label>
          No.
          <input type="number" min={1} max={151} value={dex} onChange={(e) => setDex(Math.min(151, Math.max(1, +e.target.value || 1)))} />
        </label>
        <b>{card.name}</b>
        <button type="button" onClick={() => step(1)} aria-label="Next">›</button>
      </header>
      <div className={`cd-cards${all ? " all" : ""}`}>
        {all ? (
          FINISHES.map(([f, label]) => (
            <figure key={f}>
              <TradingCard {...props} finish={f} />
              <figcaption>{label}</figcaption>
            </figure>
          ))
        ) : (
          <TradingCard {...props} finish={finish} onTap={() => {}} />
        )}
      </div>
      <section className="cd-controls">
        <div className="cd-seg" role="radiogroup" aria-label="Finish">
          {FINISHES.map(([f, label]) => (
            <button key={f} type="button" role="radio" aria-checked={!all && finish === f} className={!all && finish === f ? "on" : ""} onClick={() => (setFinish(f), setAll(false))}>
              {label}
            </button>
          ))}
          <button type="button" role="radio" aria-checked={all} className={all ? "on" : ""} onClick={() => setAll(true)}>All three</button>
        </div>
        {!all && <p className="cd-note">{FINISHES.find(([f]) => f === finish)![2]}</p>}
        <div className="cd-toggles">
          <label><input type="checkbox" checked={!down} onChange={(e) => setDown(!e.target.checked)} /> Caught (face up)</label>
          <label><input type="checkbox" checked={art} onChange={(e) => setArt(e.target.checked)} /> Artwork (off: the cartridge's picture)</label>
        </div>
        {(
          [
            ["Foil", foil, setFoil, 0, 1.5],
            ["Gloss", shine, setShine, 0, 1.5],
            ["Relief", bump, setBump, 0, 2],
            ["Turn (°)", range, setRange, 4, 30],
          ] as const
        ).map(([label, v, set, min, max]) => (
          <label key={label} className="cd-slider">
            <span>{label}</span>
            <input type="range" min={min} max={max} step={label.startsWith("Turn") ? 1 : 0.05} value={v} onChange={(e) => set(+e.target.value)} />
            <output>{label.startsWith("Turn") ? v : v.toFixed(2)}</output>
          </label>
        ))}
        <p className="cd-note">On a phone, tap the card once to let it read the tilt. With a mouse, move over the card. Otherwise it sways by itself.</p>
      </section>
    </div>
  );
}
