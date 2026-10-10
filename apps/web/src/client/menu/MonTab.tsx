// The Pokémon tab: the game's own Pokédex (seen and caught), with no spoilers. Pokémon never seen
// are a numbered "?"; seen ones show their picture and name; caught ones open their whole page:
// the ROM's entry (read aloud on request), size and base stats, moves and how it grows from the
// ROM, where it lives, and PokeAPI's artwork, fetched live.
import { useMemo, useState } from "react";
import { growth, itemName, monName, moveName, pokedexNumber, type DexEntry } from "@pokehd/rom";
import { dexNo, heightText, niceName, weightText } from "../dex/catalogue.ts";
import { monPicture } from "../dex/pictures.ts";
import { useMenu } from "./context.ts";
import { Head, Seg, Types } from "./parts.tsx";
import { useLiveEntry } from "./pokeapi.ts";

type Filter = "all" | "caught" | "seen";

export function MonGrid() {
  const { game, catalogue, rom, open } = useMenu();
  const [filter, setFilter] = useState<Filter>("all");
  const seen = game?.seen ?? new Set<number>();
  const owned = game?.owned ?? new Set<number>();
  const last = Math.max(0, ...seen);
  const shown = catalogue.entries.filter((e) =>
    filter === "caught" ? owned.has(e.dex) : filter === "seen" ? seen.has(e.dex) && !owned.has(e.dex) : e.dex <= Math.max(12, Math.ceil(last / 4) * 4),
  );
  return (
    <>
      <Head title="Pokémon" pill="Kanto" />
      <div className="dm-body">
        <p className="dm-count">
          <b>{owned.size}</b> caught · <b>{seen.size}</b> seen of 151
        </p>
        <div className="dm-progress" aria-hidden>
          <i style={{ width: `${(owned.size / 151) * 100}%` }} />
        </div>
        <Seg label="Show" value={filter} onChange={setFilter} options={[["all", "All"], ["caught", "Caught"], ["seen", "Seen"]]} />
        {shown.length === 0 && <p className="dm-empty">{filter === "caught" ? "Nothing caught yet. Throw a Poké Ball at a wild Pokémon!" : "Nobody here yet."}</p>}
        <div className="dm-grid">
          {shown.map((e) =>
            seen.has(e.dex) ? (
              <button key={e.dex} type="button" className="dm-mon dm-c" onClick={() => open({ kind: "mon", dex: e.dex })}>
                {owned.has(e.dex) && <i className="own" aria-label="caught" />}
                <img src={monPicture(rom, e.species, e.picture)} alt="" />
                <span className="no">{dexNo(e.dex)}</span>
                <span>{niceName(e.name)}</span>
              </button>
            ) : (
              <span key={e.dex} className="dm-mon dm-c unseen" aria-label={`Number ${e.dex}, not seen yet`}>
                <span className="q">?</span>
                <span className="no">{dexNo(e.dex)}</span>
              </span>
            ),
          )}
        </div>
      </div>
    </>
  );
}

type Part = "about" | "moves" | "where" | "grows";

export function MonPage({ dex }: { dex: number }) {
  const { game, catalogue, rom, open } = useMenu();
  const entry = catalogue.entries[dex - 1]!;
  const caught = !!game?.owned.has(dex);
  const seen = caught || !!game?.seen.has(dex);
  const live = useLiveEntry(dex, caught);
  const [part, setPart] = useState<Part>("about");
  const [speaking, setSpeaking] = useState(false);
  const text = entry.pages.map((p) => p.join(" ")).join(" ");
  const say = () => {
    const s = globalThis.speechSynthesis;
    if (!s) return;
    if (speaking) return void (s.cancel(), setSpeaking(false));
    const u = new SpeechSynthesisUtterance(`${niceName(entry.name)}. The ${niceName(entry.category)} Pokémon. ${sentenceCase(text)}`);
    u.rate = 0.9;
    u.onend = u.onerror = () => setSpeaking(false);
    s.cancel();
    s.speak(u);
    setSpeaking(true);
  };
  if (!seen) return null;
  return (
    <>
      <Head title={niceName(entry.name)} pill={`No.${dexNo(dex)}`} back />
      <div className="dm-body">
        <div className="dm-c dm-hero">
          <div className="pic">
            {live?.art ? <img src={live.art} alt="" /> : <img className="px" src={monPicture(rom, entry.species, entry.picture)} alt="" />}
          </div>
          <div>
            <div className="no">No.{dexNo(dex)}</div>
            <h3>{niceName(entry.name)}</h3>
            <div className="cat">The {niceName(entry.category)} Pokémon</div>
            <Types types={entry.types} />
          </div>
        </div>
        {caught ? (
          <div className="dm-c dm-text">
            <p>{sentenceCase(text)}</p>
            {"speechSynthesis" in globalThis && (
              <button type="button" className="dm-say" onClick={say}>
                {speaking ? "■ Stop" : "🔈 Read it"}
              </button>
            )}
          </div>
        ) : (
          <div className="dm-c dm-text">
            <p>You've seen one. Catch one to read all about it!</p>
          </div>
        )}
        <Seg
          label="About"
          value={part}
          onChange={setPart}
          options={caught ? [["about", "About"], ["moves", "Moves"], ["where", "Where"], ["grows", "Grows"]] : [["about", "About"], ["where", "Where"]]}
        />
        {part === "about" && <About entry={entry} caught={caught} />}
        {part === "moves" && caught && <Moves species={entry.species} />}
        {part === "where" && <Where dex={dex} open={(name) => open({ kind: "place", name })} />}
        {part === "grows" && caught && <Grows species={entry.species} />}
      </div>
    </>
  );
}

function About({ entry, caught }: { entry: DexEntry; caught: boolean }) {
  const stats: [string, number][] = [
    ["HP", entry.stats.hp],
    ["Attack", entry.stats.attack],
    ["Defence", entry.stats.defense],
    ["Speed", entry.stats.speed],
    ["Special", entry.stats.special],
  ];
  return (
    <div className="dm-c">
      {caught && (
        <div className="dm-kv">
          <div>
            Height<b>{heightText(entry)}</b>
          </div>
          <div>
            Weight<b>{weightText(entry)}</b>
          </div>
        </div>
      )}
      <div className="dm-stats" style={caught ? undefined : { paddingTop: 12 }}>
        {stats.map(([k, v]) => (
          <span key={k} style={{ display: "contents" }}>
            <span>{k}</span>
            <b>{v}</b>
            <span className="bar">
              <i style={{ width: `${Math.min(100, (v / 150) * 100)}%` }} />
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Moves({ species }: { species: number }) {
  const { rom } = useMenu();
  const moves = useMemo(() => growth(rom, species).learnset, [rom, species]);
  if (!moves.length) return <p className="dm-empty">It learns nothing new by growing.</p>;
  return (
    <div className="dm-c dm-lines">
      {moves.map((m) => (
        <div key={`${m.level}:${m.move}`}>
          <span>{niceName(moveName(rom, m.move))}</span>
          <span className="k">Level {m.level}</span>
        </div>
      ))}
    </div>
  );
}

function Where({ dex, open }: { dex: number; open(name: string): void }) {
  const { catalogue, journal } = useMenu();
  const homes = catalogue.homes.get(dex) ?? [];
  const visited = new Set(journal?.places().map((p) => catalogue.placeOf(p.map)?.name));
  if (!homes.length) return <p className="dm-empty">It doesn't live in the wild. Someone might give you one, or it might grow from another.</p>;
  return (
    <div className="dm-list">
      {homes.map((p) => (
        <button key={p.name} type="button" className="dm-c dm-row" onClick={() => open(p.name)} disabled={!visited.has(p.name)}>
          <span className="grow">
            <span>{visited.has(p.name) ? p.name : "Somewhere you haven't been"}</span>
            <span className="sub">{p.grass.includes(dex) ? (p.water.includes(dex) ? "In the grass and on the water" : "In the grass") : "On the water"}</span>
          </span>
          {visited.has(p.name) && <span className="chev">›</span>}
        </button>
      ))}
    </div>
  );
}

function Grows({ species }: { species: number }) {
  const { rom, game, open } = useMenu();
  const evos = useMemo(() => growth(rom, species).evolutions, [rom, species]);
  if (!evos.length) return <p className="dm-empty">It doesn't grow into anything else.</p>;
  return (
    <div className="dm-list">
      {evos.map((e) => {
        const dex = pokedexNumber(rom, e.species);
        const known = !!game?.seen.has(dex);
        const how = e.how === "level" ? `At level ${e.level}` : e.how === "item" ? `With a ${niceName(itemName(rom, e.item))}` : "When traded with a friend";
        return (
          <button key={e.species} type="button" className="dm-c dm-row" disabled={!known} onClick={() => open({ kind: "mon", dex })}>
            <span className="grow">
              <span>{known ? niceName(monName(rom, e.species)) : "Something new"}</span>
              <span className="sub">{how}</span>
            </span>
            {known && <span className="chev">›</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The ROM's entries are in capitals at the start of each sentence only; "POKéMON" reads as a word. */
function sentenceCase(text: string): string {
  return text.replace(/POKé(MON)?/g, "Pokémon").replace(/\s+/g, " ").trim();
}
