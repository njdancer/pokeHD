// The People tab: friends (from the shared world, where they're playing now) and the people met in
// the game (from the journal: who spoke to the player or battled them), filtered by what they
// are. Nobody the player hasn't met appears.
import { useState } from "react";
import { niceName, type Person, type PersonMet } from "../dex/catalogue.ts";
import { personPicture, trainerPicture } from "../dex/pictures.ts";
import { useMenu } from "./context.ts";
import { Head, Seg } from "./parts.tsx";

type Show = "all" | "friends" | "game";
type Kind = "Leaders" | "Trainers" | "Helpers" | "Townsfolk";
const KINDS: Kind[] = ["Leaders", "Trainers", "Helpers", "Townsfolk"];

/** Gym leaders, the Elite Four and the rival, by trainer class name. */
const LEADERS = new Set(["BROCK", "MISTY", "LT.SURGE", "ERIKA", "KOGA", "SABRINA", "BLAINE", "GIOVANNI", "LORELEI", "BRUNO", "AGATHA", "LANCE"]);
/** People whose job is to help: they heal, sell, explain or hand things out. */
const HELPERS = new Set(["Prof. Oak", "Mom", "Daisy", "Nurse Joy", "Shop clerk", "Mr. Fuji", "Bill", "Gym guide", "Link Club desk"]);

function kindOf(p: Person): Kind {
  if (p.trainer) return LEADERS.has(p.trainer.name) || p.name === "Rival" ? "Leaders" : "Trainers";
  return HELPERS.has(p.name) ? "Helpers" : "Townsfolk";
}

const COLOURS = ["#e0702a", "#2c6fd6", "#5aa93c", "#9b59b6", "#d9412f", "#c49a4a"];
const colourOf = (id: string) => COLOURS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % COLOURS.length]!;

export function People() {
  const { friends, journal, catalogue, open } = useMenu();
  const [show, setShow] = useState<Show>("all");
  const [kinds, setKinds] = useState<ReadonlySet<Kind>>(new Set());
  const met = (journal?.people() ?? [])
    .map((m) => ({ met: m, person: catalogue.person(m.map, m.npc) }))
    .filter((x): x is { met: PersonMet; person: Person } => !!x.person)
    .filter((x) => kinds.size === 0 || kinds.has(kindOf(x.person)))
    .reverse();
  const toggle = (k: Kind) => {
    const next = new Set(kinds);
    if (!next.delete(k)) next.add(k);
    setKinds(next);
  };
  const playing = friends.filter((f) => f.presence).length;
  return (
    <>
      <Head title="People" pill={playing ? `${playing} ${playing === 1 ? "friend" : "friends"} playing` : undefined} />
      <div className="dm-body">
        <Seg label="Show" value={show} onChange={setShow} options={[["all", "All"], ["friends", "Friends"], ["game", "In the game"]]} />
        {show !== "game" && (
          <>
            <div className="dm-section">
              <span>Friends</span>
            </div>
            {friends.length === 0 && <p className="dm-hint">No friends playing right now.</p>}
            <div className="dm-list">
              {friends.map((f) => {
                const place = f.presence ? catalogue.placeOf(f.presence.mapId)?.name : undefined;
                return (
                  <button key={f.id} type="button" className="dm-c dm-row" onClick={() => open({ kind: "friend", id: f.id })}>
                    <span className={`dm-initial${f.presence ? " on" : ""}`} style={{ background: colourOf(f.id) }}>
                      {f.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="grow">
                      <span>{f.name}</span>
                      <span className="sub">{f.presence ? `Playing now${place ? ` · ${place}` : ""}` : "Here, not playing yet"}</span>
                    </span>
                    <span className="chev">›</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {show !== "friends" && (
          <>
            <div className="dm-section">
              <span>People in the game</span>
              <span>{journal?.people().length ?? 0} met</span>
            </div>
            <div className="dm-filters">
              {KINDS.map((k) => (
                <button key={k} type="button" className="dm-chip" aria-pressed={kinds.has(k)} onClick={() => toggle(k)}>
                  {k}
                </button>
              ))}
            </div>
            {met.length === 0 && <p className="dm-empty">Talk to people in the game and they'll be here.</p>}
            <div className="dm-list">
              {met.map(({ met: m, person }) => (
                <button key={person.key} type="button" className="dm-c dm-row" onClick={() => open({ kind: "person", key: person.key })}>
                  <Face person={person} />
                  <span className="grow">
                    <span>{person.name}</span>
                    <span className="sub">
                      {catalogue.placeOf(m.map)?.name ?? "Somewhere"} · {m.beaten ? "Beaten" : "Met"}
                    </span>
                  </span>
                  <span className="chev">›</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

export function Face({ person }: { person: Person }) {
  const { rom, world, catalogue } = useMenu();
  if (person.trainer)
    return (
      <span className="dm-face trainer">
        <img src={trainerPicture(rom, person.trainer.picture)} alt="" />
      </span>
    );
  const sheet = world.sprites[person.sprite];
  // People take their town's colours (D22).
  const town = catalogue.placeOf(person.map);
  const palette = town && town.maps[0]! < 11 ? town.maps[0]! + 1 : 0;
  return <span className="dm-face">{sheet && <img src={personPicture(rom, sheet, palette)} alt="" />}</span>;
}

export function PersonPage({ k }: { k: string }) {
  const { journal, catalogue } = useMenu();
  const [map, npc] = k.split(":").map(Number) as [number, number];
  const person = catalogue.person(map, npc);
  const met = journal?.people().find((p) => p.map === map && p.npc === npc);
  if (!person || !met) return <Head title="Someone" back />;
  return (
    <>
      <Head title={person.name} back />
      <div className="dm-body">
        <div className="dm-c dm-row">
          <Face person={person} />
          <span className="grow">
            <span>{person.name}</span>
            <span className="sub">
              {catalogue.placeOf(map)?.name ?? "Somewhere"} · {kindOf(person).replace(/s$/, "").replace("Townsfolk", "Lives here")}
            </span>
          </span>
        </div>
        {met.said && <div className="dm-c dm-said">“{met.said.replace(/\n/g, " ")}”</div>}
        <div className="dm-c dm-lines">
          <div>
            <span className="k">First met</span>
            <span>{new Date(met.at).toLocaleDateString()}</span>
          </div>
          {person.trainer && (
            <div>
              <span className="k">Battle</span>
              <span>{met.beaten ? "You won!" : "Not beaten yet"}</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function FriendPage({ id }: { id: string }) {
  const { friends, catalogue, go } = useMenu();
  const f = friends.find((x) => x.id === id);
  if (!f) return <Head title="Friend" back />;
  const place = f.presence ? catalogue.placeOf(f.presence.mapId)?.name : undefined;
  return (
    <>
      <Head title={f.name} back />
      <div className="dm-body">
        <div className="dm-c dm-row">
          <span className={`dm-initial${f.presence ? " on" : ""}`} style={{ background: colourOf(f.id) }}>
            {f.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="grow">
            <span>{f.name}</span>
            <span className="sub">{f.presence ? `Playing now${place ? ` in ${place}` : ""}` : "Not playing right now"}</span>
          </span>
        </div>
        {f.presence && (
          <button type="button" className="dm-verb alt" onClick={() => go("map")}>
            Find {niceName(f.name)} on the map
          </button>
        )}
      </div>
    </>
  );
}
