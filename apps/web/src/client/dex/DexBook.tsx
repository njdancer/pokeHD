// The Pokédex's pages: Pokémon (the game's own Pokédex, richer), People met and Places visited.
// Real buttons to tap or click (no cursor), drawn in one of the looks: "hd" (on the 3D device's
// screen), "pixel" (the game's own letters on the pixel device) or "storybook" (a flat panel in
// the D31 look). Sized from its container, so it fits any screen it's put on.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { DexEntry, WorldData } from "@pokehd/rom";
import { dexNo, heightText, weightText, type Catalogue, type DexProgress, type Person, type Place } from "./catalogue.ts";
import { monPicture, personPicture, pixelText, townMapPicture, trainerPicture } from "./pictures.ts";
import "./dex.css";

export type DexLook = "hd" | "pixel" | "storybook";

interface Ctx {
  rom: Uint8Array;
  world: WorldData;
  look: DexLook;
  cat: Catalogue;
  progress: DexProgress;
}
const DexCtx = createContext<Ctx>(null!);

type View =
  | { tab: "pokemon"; dex?: number }
  | { tab: "people"; key?: string }
  | { tab: "places"; name?: string };

export interface DexBookProps {
  rom: Uint8Array;
  world: WorldData;
  catalogue: Catalogue;
  progress: DexProgress;
  look: DexLook;
  /** Opens on this Pokémon's page (the game showing a new catch, or the data page). */
  openOn?: number;
  /** Opens on this tab. */
  tab?: View["tab"];
  onClose(): void;
}

/** Words: plain text, or for the pixel look the game's own letters. */
function T({ children, className }: { children: string; className?: string }) {
  const { rom, look } = useContext(DexCtx);
  if (look !== "pixel") return <span className={className}>{children}</span>;
  return (
    <span className={`px-text ${className ?? ""}`} aria-label={children}>
      <img src={pixelText(rom, children)} alt="" />
    </span>
  );
}

export function DexBook({ rom, world, catalogue, progress, look, openOn, tab: firstTab = "pokemon", onClose }: DexBookProps) {
  const [view, setView] = useState<View>(openOn ? { tab: "pokemon", dex: openOn } : { tab: firstTab });
  const ctx = useMemo(() => ({ rom, world, look, cat: catalogue, progress }), [rom, world, look, catalogue, progress]);
  const back = () => setView({ tab: view.tab });
  const inPage = (view.tab === "pokemon" && view.dex) || (view.tab === "people" && view.key) || (view.tab === "places" && view.name);
  const tab = (id: View["tab"], label: string, count: string) => (
    <button type="button" role="tab" aria-selected={view.tab === id} className="dex-tab" onClick={() => setView({ tab: id })}>
      <T>{label}</T>
      <small><T>{count}</T></small>
    </button>
  );
  return (
    <DexCtx.Provider value={ctx}>
      <div className={`dex dex-${look}`} role="dialog" aria-label="Pokédex">
        {look === "storybook" && <Corners />}
        <header className="dex-head">
          {inPage ? (
            <button type="button" className="dex-back" onClick={back} aria-label="Back">
              <T>◀</T>
            </button>
          ) : (
            <span className="dex-title"><T>{look === "pixel" ? "POKéDEX" : "Pokédex"}</T></span>
          )}
          <nav className="dex-tabs" role="tablist">
            {tab("pokemon", look === "pixel" ? "MON" : "Pokémon", `${progress.owned.size}/${progress.seen.size}`)}
            {tab("people", look === "pixel" ? "PEOPLE" : "People", String(progress.people.length))}
            {tab("places", look === "pixel" ? "PLACES" : "Places", String(new Set(progress.places.map((p) => catalogue.placeOf(p.map)?.name)).size))}
          </nav>
          <button type="button" className="dex-close" onClick={onClose} aria-label="Close">
            <T>✕</T>
          </button>
        </header>
        <main className="dex-body">
          {view.tab === "pokemon" &&
            (view.dex ? <MonPage key={view.dex} dex={view.dex} go={(dex) => setView({ tab: "pokemon", dex })} /> : <MonGrid open={(dex) => setView({ tab: "pokemon", dex })} />)}
          {view.tab === "people" && (view.key ? <PersonPage k={view.key} /> : <PeopleList open={(key) => setView({ tab: "people", key })} />)}
          {view.tab === "places" &&
            (view.name ? (
              <PlacePage name={view.name} openMon={(dex) => setView({ tab: "pokemon", dex })} />
            ) : (
              <PlacesList open={(name) => setView({ tab: "places", name })} />
            ))}
        </main>
      </div>
    </DexCtx.Provider>
  );
}

/** Little Poké Balls where the game's text boxes have their corner dots. */
function Corners() {
  return (
    <>
      {["tl", "tr", "bl", "br"].map((c) => (
        <i key={c} className={`dex-ball ${c}`} aria-hidden />
      ))}
    </>
  );
}

function MonPic({ entry, size = "s", seen }: { entry: DexEntry; size?: "s" | "l"; seen: boolean }) {
  const { rom } = useContext(DexCtx);
  if (!seen) return <span className={`dex-pic ${size} unknown`}><T>?</T></span>;
  return <img className={`dex-pic ${size}`} src={monPicture(rom, entry.species, entry.picture)} alt="" />;
}

function MonGrid({ open }: { open(dex: number): void }) {
  const { cat, progress } = useContext(DexCtx);
  // Up to the highest seen, as the game's list does, rounded up to a full row.
  const last = Math.max(0, ...progress.seen);
  const shown = cat.entries.slice(0, Math.min(151, Math.max(12, Math.ceil(last / 4) * 4 + 4)));
  return (
    <div className="dex-grid">
      {shown.map((e) => {
        const seen = progress.seen.has(e.dex);
        const owned = progress.owned.has(e.dex);
        return (
          <button type="button" key={e.dex} className={`dex-cell ${owned ? "owned" : seen ? "seen" : "unseen"}`} disabled={!seen} onClick={() => open(e.dex)}>
            <MonPic entry={e} seen={seen} />
            <span className="dex-no"><T>{dexNo(e.dex)}</T></span>
            {seen && <span className="dex-name"><T>{e.name}</T></span>}
            {owned && <i className="dex-caught" aria-label="caught" />}
          </button>
        );
      })}
    </div>
  );
}

function MonPage({ dex, go }: { dex: number; go(dex: number): void }) {
  const { cat, progress, look } = useContext(DexCtx);
  const e = cat.entries[dex - 1]!;
  const owned = progress.owned.has(dex);
  const homes = cat.homes.get(dex) ?? [];
  const prev = [...progress.seen].filter((d) => d < dex).sort((a, b) => b - a)[0];
  const next = [...progress.seen].filter((d) => d > dex).sort((a, b) => a - b)[0];
  const max = 160;
  const [page, setPage] = useState(0);
  return (
    <article className="dex-mon">
      <div className="dex-mon-top">
        <div className="dex-stage">
          <MonPic entry={e} size="l" seen />
        </div>
        <div className="dex-mon-id">
          <span className="dex-no"><T>{`No.${dexNo(dex)}`}</T></span>
          <h2><T>{e.name}</T></h2>
          {owned ? <p className="dex-cat"><T>{`${e.category} POKéMON`}</T></p> : <p className="dex-cat"><T>Not caught yet</T></p>}
          <div className="dex-types">
            {e.types.map((t) => (
              <span key={t} className={`dex-type t-${t.toLowerCase()}`}><T>{t}</T></span>
            ))}
          </div>
          {owned && (
            <dl className="dex-hw">
              <dt><T>HT</T></dt><dd><T>{heightText(e)}</T></dd>
              <dt><T>WT</T></dt><dd><T>{weightText(e)}</T></dd>
            </dl>
          )}
        </div>
      </div>
      {owned &&
        (look === "pixel" ? (
          // The game's way: a page at a time, ▼ to turn it.
          <button type="button" className="dex-words" onClick={() => setPage((p) => (p + 1) % e.pages.length)} aria-label={e.pages.flat().join(" ")}>
            {e.pages[page % e.pages.length]!.map((line, i) => (
              <span key={i} className="dex-line"><T>{line}</T></span>
            ))}
            {e.pages.length > 1 && <span className="dex-more"><T>{page % e.pages.length < e.pages.length - 1 ? "▼" : "▶"}</T></span>}
          </button>
        ) : (
          <blockquote className="dex-words">
            {e.pages.flat().map((line, i) => (
              <span key={i} className="dex-line"><T>{line}</T> </span>
            ))}
          </blockquote>
        ))}
      {owned && look !== "pixel" && (
        <div className="dex-stats">
          {(
            [
              ["HP", e.stats.hp],
              ["Attack", e.stats.attack],
              ["Defense", e.stats.defense],
              ["Speed", e.stats.speed],
              ["Special", e.stats.special],
            ] as const
          ).map(([label, v]) => (
            <div key={label} className="dex-stat">
              <span>{label}</span>
              <b>{v}</b>
              <i style={{ width: `${Math.min(100, (v / max) * 100)}%` }} />
            </div>
          ))}
        </div>
      )}
      <section className="dex-homes">
        <h3><T>{look === "pixel" ? "AREA" : "Lives in"}</T></h3>
        {homes.length ? (
          <ul>
            {homes.map((p) => (
              <li key={p.name} className={progress.places.some((v) => cat.placeOf(v.map) === p) ? "been" : ""}>
                <T>{look === "pixel" ? p.name.toUpperCase() : p.name}</T>
              </li>
            ))}
          </ul>
        ) : (
          <p><T>{look === "pixel" ? "AREA UNKNOWN" : "Not found in the wild"}</T></p>
        )}
      </section>
      <footer className="dex-step">
        <button type="button" disabled={!prev} onClick={() => prev && go(prev)} aria-label="Previous"><T>◀</T></button>
        <button type="button" disabled={!next} onClick={() => next && go(next)} aria-label="Next"><T>▶</T></button>
      </footer>
    </article>
  );
}

function PersonPic({ person }: { person: Person }) {
  const { rom, world, cat } = useContext(DexCtx);
  if (person.trainer) return <img className="dex-face trainer" src={trainerPicture(rom, person.trainer.picture)} alt="" />;
  const sheet = world.sprites[person.sprite];
  if (!sheet) return <span className="dex-face" />;
  // People take their town's colours (D22).
  const town = cat.placeOf(person.map);
  const palette = town && town.maps[0]! < 11 ? town.maps[0]! + 1 : 0;
  return <img className="dex-face person" src={personPicture(rom, sheet, palette)} alt="" />;
}

function PeopleList({ open }: { open(key: string): void }) {
  const { cat, progress, look } = useContext(DexCtx);
  const people = progress.people.map((m) => ({ met: m, who: cat.person(m.map, m.npc) })).filter((p) => p.who);
  if (!people.length) return <Empty>Talk to people and they'll be remembered here.</Empty>;
  return (
    <ul className="dex-people">
      {people.map(({ met, who }) => (
        <li key={who!.key}>
          <button type="button" className="dex-person" onClick={() => open(who!.key)}>
            <PersonPic person={who!} />
            <span className="dex-person-text">
              <b><Name who={who!} /></b>
              <small><T>{place(cat.placeOf(met.map), look)}</T></small>
              {met.said && look !== "pixel" && <q>{met.said}</q>}
            </span>
            {met.beaten && <span className="dex-badge"><T>{look === "pixel" ? "WON" : "Beaten"}</T></span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A person's name for the look; the rival goes by the name the player gave them. */
function useName(who: Person): string {
  const { progress, look } = useContext(DexCtx);
  const name = who.name === "Rival" && progress.rival ? progress.rival : who.name;
  return look === "pixel" ? name.toUpperCase() : name;
}

function Name({ who }: { who: Person }) {
  return <T>{useName(who)}</T>;
}

const place = (p: Place | undefined, look: DexLook) => (p ? (look === "pixel" ? p.name.toUpperCase() : p.name) : "?");

function PersonPage({ k }: { k: string }) {
  const { cat, progress, look } = useContext(DexCtx);
  const met = progress.people.find((p) => `${p.map}:${p.npc}` === k)!;
  const who = cat.person(met.map, met.npc)!;
  return (
    <article className="dex-who">
      <div className="dex-stage"><PersonPic person={who} /></div>
      <h2><Name who={who} /></h2>
      <p><T>{`${look === "pixel" ? "MET IN" : "Met in"} ${place(cat.placeOf(met.map), look)}`}</T></p>
      {met.said && (
        <blockquote className="dex-words">
          {look === "pixel" ? met.said.split("\n").map((l, i) => <span key={i} className="dex-line"><T>{l}</T></span>) : met.said}
        </blockquote>
      )}
      {who.trainer && <p className="dex-note"><T>{met.beaten ? (look === "pixel" ? "BEATEN!" : "You won the battle!") : look === "pixel" ? "NOT BEATEN" : "Not beaten yet"}</T></p>}
    </article>
  );
}

function PlacesList({ open }: { open(name: string): void }) {
  const { rom, cat, progress, look } = useContext(DexCtx);
  const visited = [...new Set(progress.places.map((p) => cat.placeOf(p.map)).filter((p): p is Place => !!p))];
  const latest = cat.placeOf(progress.places.at(-1)?.map ?? -1);
  return (
    <div className="dex-places">
      <div className="dex-map">
        <img src={townMapPicture(rom)} alt="Town map" />
        {visited.map((p) => (
          <button
            type="button"
            key={p.name}
            className={`dex-pin ${p === latest ? "here" : ""}`}
            style={{ left: `${((p.x * 8 + 4) / 160) * 100}%`, top: `${((p.y * 8 + 4) / 144) * 100}%` }}
            onClick={() => open(p.name)}
            aria-label={p.name}
          />
        ))}
      </div>
      <ul className="dex-place-list">
        {visited.map((p) => (
          <li key={p.name}>
            <button type="button" onClick={() => open(p.name)}>
              <T>{look === "pixel" ? p.name.toUpperCase() : p.name}</T>
              <small><T>{`${p.grass.length + p.water.length || "No"} ${look === "pixel" ? "MON" : "Pokémon"}`}</T></small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlacePage({ name, openMon }: { name: string; openMon(dex: number): void }) {
  const { cat, progress, look } = useContext(DexCtx);
  const p = cat.places.find((x) => x.name === name)!;
  const people = progress.people.filter((m) => p.maps.includes(m.map)).map((m) => cat.person(m.map, m.npc)).filter((x): x is Person => !!x);
  const mons = [...new Set([...p.grass, ...p.water])];
  return (
    <article className="dex-place">
      <h2><T>{look === "pixel" ? p.name.toUpperCase() : p.name}</T></h2>
      <h3><T>{look === "pixel" ? "POKéMON" : "Pokémon here"}</T></h3>
      <div className="dex-grid mini">
        {mons.map((dex) => {
          const e = cat.entries[dex - 1]!;
          const seen = progress.seen.has(dex);
          return (
            <button type="button" key={dex} className={`dex-cell ${seen ? "seen" : "unseen"}`} disabled={!seen} onClick={() => openMon(dex)}>
              <MonPic entry={e} seen={seen} />
            </button>
          );
        })}
        {!mons.length && <Empty>No wild Pokémon here.</Empty>}
      </div>
      <h3><T>{look === "pixel" ? "PEOPLE" : "People met here"}</T></h3>
      <div className="dex-faces">
        {people.map((who) => <PersonPic key={who.key} person={who} />)}
        {!people.length && <Empty>Nobody yet.</Empty>}
      </div>
    </article>
  );
}

function Empty({ children }: { children: ReactNode }) {
  const { look } = useContext(DexCtx);
  return <p className="dex-empty">{look === "pixel" && typeof children === "string" ? <T>{children.toUpperCase()}</T> : children}</p>;
}

