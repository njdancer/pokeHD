// The Pokémon tab: every species as a card (caught, seen, or a question mark), and each one's
// page. Pictures and words come from the ROM; caught Pokémon also show PokeAPI's artwork, live.
import { useMemo, useState } from "react";
import { artworkUrl, dexNo, monPic, niceMon, useEnv } from "../env.tsx";
import { BallMark } from "../icons.tsx";
import { useNav } from "../nav.tsx";
import { heightText, weightText } from "../../dex/catalogue.ts";
import { Page, Pixel, ReadButton, Row, Seg, Types } from "../ui.tsx";

type Filter = "all" | "caught" | "seen";

export function PokemonScreen() {
  const env = useEnv();
  const nav = useNav();
  const { seen, owned, enemy } = env.model;
  const [filter, setFilter] = useState<Filter>("all");
  const shown = useMemo(
    () => Array.from({ length: 151 }, (_, i) => i + 1).filter((n) => (filter === "all" ? true : filter === "caught" ? owned.has(n) : seen.has(n) && !owned.has(n))),
    [filter, seen, owned],
  );
  return (
    <Page title="Pokémon" meta="Kanto">
      {enemy && (
        <Row
          className="m-now"
          media={<Pixel src={monPic(env, enemy.dex)} />}
          title={<>{enemy.trainer ? `${enemy.trainer}'s` : "Wild"} {enemy.name}</>}
          sub={owned.has(enemy.dex) ? "You've caught one before. Look it up" : "Look it up"}
          right={`Lv ${enemy.level}`}
          onClick={() => nav.go({ k: "entry", dex: enemy.dex })}
        />
      )}
      <div className="m-progress">
        <div>
          <b>{owned.size}</b> caught <span className="m-dot-sep">·</span> <b>{seen.size}</b> seen <span className="m-faint">of 151</span>
        </div>
        <span className="m-bar">
          <i className="seen" style={{ width: `${(seen.size / 151) * 100}%` }} />
          <i style={{ width: `${(owned.size / 151) * 100}%` }} />
        </span>
      </div>
      <Seg label="Show" value={filter} onChange={setFilter} options={[["all", "All"], ["caught", "Caught"], ["seen", "Seen"]]} />
      <div className="m-dexgrid">
        {shown.map((n) => {
          const c = owned.has(n);
          const s = seen.has(n);
          if (!s)
            return (
              <div key={n} className="m-dexcard none" aria-label={`${dexNo(n)}, not seen yet`}>
                <span className="m-q">?</span>
                <span className="m-no">{String(n).padStart(3, "0")}</span>
              </div>
            );
          const e = env.catalogue.entries[n - 1]!;
          return (
            <button key={n} type="button" className={`m-dexcard${c ? " caught" : " seen"}`} onClick={() => nav.go({ k: "entry", dex: n })}>
              {c && <BallMark />}
              <Pixel src={monPic(env, n)} />
              <span className="m-no">{String(n).padStart(3, "0")}</span>
              <span className="m-name">{niceMon(e.name)}</span>
            </button>
          );
        })}
      </div>
    </Page>
  );
}

type EntryTab = "about" | "moves" | "where" | "grows";

export function EntryScreen({ dex }: { dex: number }) {
  const env = useEnv();
  const nav = useNav();
  const e = env.catalogue.entries[dex - 1]!;
  // In full when caught, or while the game shows it in full (a starter in Oak's lab).
  const caught = env.model.owned.has(dex) || !!env.model.onShow?.has(dex);
  const homes = env.catalogue.homes.get(dex) ?? [];
  const [tab, setTab] = useState<EntryTab>("about");
  const [art, setArt] = useState(true);
  const words = e.pages.map((p) => p.join(" ")).join(" ");
  const name = niceMon(e.name);
  const kind = e.category.charAt(0) + e.category.slice(1).toLowerCase();

  if (!caught)
    return (
      <Page title={name} meta={dexNo(dex)}>
        <div className="m-hero seen">
          <div className="m-hero-pic">
            <Pixel src={monPic(env, dex)} />
          </div>
          <div className="m-hero-text">
            <span className="m-no">{dexNo(dex)}</span>
            <h3>{name}</h3>
            <span className="m-sub">Seen, not caught yet</span>
          </div>
        </div>
        <div className="m-card m-note">
          <p>Catch one to find out more about it.</p>
          {homes.length > 0 && <p className="m-sub">You might find one around {homes.slice(0, 2).map((h) => h.name).join(" or ")}.</p>}
        </div>
        <ReadButton text={`${name}. Catch one to find out more about it.`} />
      </Page>
    );

  const learns = env.model.learns(dex);
  return (
    <Page title={name} meta={dexNo(dex)}>
      <div className="m-hero" style={{ ["--type" as string]: typeTint(e.types[0]!) }}>
        <div className="m-hero-pic art">
          {art ? <img src={artworkUrl(dex)} alt="" onError={() => setArt(false)} draggable={false} /> : <Pixel src={monPic(env, dex)} />}
          {art && (
            <span className="m-cart" title="As your cartridge draws it">
              <Pixel src={monPic(env, dex)} />
            </span>
          )}
        </div>
        <div className="m-hero-text">
          <span className="m-no">{dexNo(dex)}</span>
          <h3>{name}</h3>
          <span className="m-sub">The {kind} Pokémon</span>
          <Types types={e.types} />
        </div>
      </div>
      <div className="m-card m-words">
        <p>{words}</p>
        <ReadButton text={`${name}, the ${kind} Pokémon. ${words}`} label="Read it" />
      </div>
      <Seg label="About" value={tab} onChange={setTab} options={[["about", "About"], ["moves", "Moves"], ["where", "Where"], ["grows", "Grows"]]} />
      {tab === "about" && (
        <div className="m-card m-about">
          <dl className="m-facts">
            <div><dt>Height</dt><dd>{heightText(e)}</dd></div>
            <div><dt>Weight</dt><dd>{weightText(e)}</dd></div>
          </dl>
          {(
            [
              ["HP", e.stats.hp],
              ["Attack", e.stats.attack],
              ["Defence", e.stats.defense],
              ["Speed", e.stats.speed],
              ["Special", e.stats.special],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="m-stat">
              <span>{k}</span>
              <b>{v}</b>
              <span className="m-statbar"><i style={{ width: `${Math.min(100, (v / 160) * 100)}%` }} /></span>
            </div>
          ))}
        </div>
      )}
      {tab === "moves" &&
        (learns ? (
          <div className="m-list">
            {learns.moves.map(([m, at]) => (
              <Row key={m} title={m} right={at === 0 ? "From the start" : `Level ${at}`} />
            ))}
          </div>
        ) : (
          <p className="m-empty">Its moves come from the cartridge in the real build.</p>
        ))}
      {tab === "where" &&
        (homes.length ? (
          <div className="m-list">
            {homes.map((h) => (
              <Row key={h.name} title={h.name} sub={h.water.includes(dex) && !h.grass.includes(dex) ? "In the water" : "In the grass or a cave"} onClick={() => nav.tab("map", { k: "map", focus: h.name })} />
            ))}
          </div>
        ) : (
          <p className="m-empty">Not found in the wild. You get it another way.</p>
        ))}
      {tab === "grows" &&
        (learns ? (
          <div className="m-card m-grows">
            {learns.grows.map((g, i) =>
              typeof g === "number" ? (
                <button key={i} type="button" className={`m-evo${g === dex ? " here" : ""}`} onClick={() => g !== dex && env.model.seen.has(g) && nav.go({ k: "entry", dex: g })}>
                  {env.model.seen.has(g) ? <Pixel src={monPic(env, g)} /> : <span className="m-q">?</span>}
                  <span>{env.model.seen.has(g) ? niceMon(env.catalogue.entries[g - 1]!.name) : "???"}</span>
                </button>
              ) : (
                <span key={i} className="m-evo-how">{g}</span>
              ),
            )}
          </div>
        ) : (
          <p className="m-empty">How it grows comes from the cartridge in the real build.</p>
        ))}
    </Page>
  );
}

/** A type's colour as a soft wash behind the picture. */
function typeTint(type: string): string {
  const tints: Record<string, string> = { WATER: "#cfe3fb", FIRE: "#fbd9c2", GRASS: "#d6efcc", ELECTRIC: "#fbefc0", POISON: "#ead3ef", NORMAL: "#ece6d4", BUG: "#e6efbf", FLYING: "#dddcf6", GROUND: "#f2e2c2", ROCK: "#ebe1c4", PSYCHIC: "#f8d3e2", FIGHTING: "#f1cfc9", ICE: "#d3eff1", GHOST: "#dcd5ea", DRAGON: "#d9d0f6" };
  return tints[type] ?? "#f2e4c6";
}
