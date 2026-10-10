// The Inventory tab: the team first, each in their ball, then the bag. Both reorder by dragging
// (the game's own swap routine for the team, the bag's order in memory for items); a team member
// or an item opens its page, where USE and TOSS go through the game's own item routines.
import { useState } from "react";
import { itemUse, type TeamMon } from "@pokehd/emu";
import { isKeyItem, monName, moveName, pokedexNumber } from "@pokehd/rom";
import { niceName } from "../dex/catalogue.ts";
import { useMenu } from "./context.ts";
import { useReorder } from "./drag.ts";
import { itemLine, itemPrice, money, needsMove, niceItem, shelf, SHELVES, type Shelf } from "./items.ts";
import { BallPic, HpBar, Head, ShelfIcon, StatusTag, TeamRowBody } from "./parts.tsx";

export function Inventory() {
  const { game, rom, open, act, journal, lookOnly } = useMenu();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [shelves, setShelves] = useState<ReadonlySet<Shelf>>(new Set());
  const [runOut, setRunOut] = useState(false);
  const moveMon = useReorder((from, to) => void act({ kind: "move-mon", from, to }));
  const moveItem = useReorder((from, to) => void act({ kind: "move-item", from, to }));
  if (!game) return <Head title="Inventory" />;
  const filtered = shelves.size > 0;
  const items = game.bag.map((b, index) => ({ ...b, index })).filter((b) => !filtered || shelves.has(shelf(rom, b.item)));
  const gone = runOut && journal ? journal.runOutOf([...game.bag, ...game.pcItems].map((b) => b.item)).filter((h) => !filtered || shelves.has(shelf(rom, h.item))) : [];
  const toggle = (s: Shelf) => {
    const next = new Set(shelves);
    if (!next.delete(s)) next.add(s);
    setShelves(next);
  };
  const canDrag = !lookOnly;
  return (
    <>
      <Head title="Inventory" pill={money(game.money)} />
      <div className="dm-body">
        <button type="button" className="dm-filter-btn" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
          ⚲ Filters{filtered || runOut ? ` · ${shelves.size + (runOut ? 1 : 0)}` : ""}
        </button>
        {filtersOpen && (
          <div className="dm-c" style={{ padding: 10 }}>
            <div className="dm-filters">
              {SHELVES.map((s) => (
                <button key={s} type="button" className="dm-chip" aria-pressed={shelves.has(s)} onClick={() => toggle(s)}>
                  {s}
                </button>
              ))}
            </div>
            <label className="dm-toggle">
              <input type="checkbox" checked={runOut} onChange={(e) => setRunOut(e.target.checked)} />
              Show things you've run out of
            </label>
          </div>
        )}
        <div className="dm-section">
          <span>Your team</span>
          <span>{game.team.length} of 6</span>
        </div>
        <div className="dm-list">
          {game.team.map((mon, slot) => (
            <div key={`${slot}:${mon.species}:${mon.otId}:${mon.nick}`} data-row className="dm-c dm-row">
              {canDrag && (
                <span className="dm-drag" aria-label="Drag to move" {...moveMon(slot)}>
                  ⋮⋮
                </span>
              )}
              <button type="button" className="dm-row" style={{ padding: 0, minHeight: 0 }} onClick={() => open({ kind: "team", slot })}>
                <BallPic species={mon.species} />
                <TeamRowBody mon={mon} lead={slot === 0} />
                <span className="chev">›</span>
              </button>
            </div>
          ))}
        </div>
        {game.team.length > 1 && (
          <p className="dm-hint">
            Drag to change the order: the first one leads.{game.box.length ? ` ${game.box.length} more are in Bill's PC.` : ""}
          </p>
        )}
        <div className="dm-section">
          <span>Items</span>
          <span>{game.bag.length} things</span>
        </div>
        <div className="dm-list">
          {items.map((b) => (
            <div key={`${b.index}:${b.item}`} data-row className="dm-c dm-row">
              {canDrag && !filtered && (
                <span className="dm-drag" aria-label="Drag to move" {...moveItem(b.index)}>
                  ⋮⋮
                </span>
              )}
              <button type="button" className="dm-row" style={{ padding: 0, minHeight: 0 }} onClick={() => open({ kind: "item", item: b.item })}>
                <ShelfIcon shelf={shelf(rom, b.item)} />
                <span className="grow">
                  <span>{niceName(niceItem(rom, b.item))}</span>
                  <span className="sub">{shelf(rom, b.item)}</span>
                </span>
                {!isKeyItem(rom, b.item) && <span className="right">×{b.quantity}</span>}
                <span className="chev">›</span>
              </button>
            </div>
          ))}
          {gone.map((h) => (
            <div key={`gone:${h.item}`} className="dm-c dm-row off">
              <ShelfIcon shelf={shelf(rom, h.item)} />
              <span className="grow">
                <span>{niceName(niceItem(rom, h.item))}</span>
                <span className="sub">Run out · you had {h.obtained}</span>
              </span>
              <span className="right">×0</span>
            </div>
          ))}
          {items.length === 0 && gone.length === 0 && <p className="dm-empty">{filtered ? "Nothing like that in your bag." : "Your bag is empty."}</p>}
        </div>
      </div>
    </>
  );
}

export function TeamPage({ slot }: { slot: number }) {
  const { game, rom, act, open, lookOnly } = useMenu();
  const mon: TeamMon | undefined = game?.team[slot];
  const moveMove = useReorder((from, to) => void act({ kind: "move-move", mon: slot, from, to }));
  if (!game || !mon) return <Head title="Team" back />;
  const own = mon.otId === game.playerId && mon.ot === game.player;
  const usable = game.bag.filter((b) => itemUse(rom, b.item).onMon && b.item < 0xc4 && !needsMove(b.item));
  return (
    <>
      <Head title={niceName(mon.nick)} pill={`Lv ${mon.level}`} back />
      <div className="dm-body">
        <div className="dm-c dm-row">
          <BallPic species={mon.species} />
          <span className="grow">
            <span>
              {niceName(monName(rom, mon.species))}
              <StatusTag mon={mon} />
            </span>
            <span className="sub">
              HP {mon.hp}/{mon.maxHp}
            </span>
            <HpBar hp={mon.hp} max={mon.maxHp} />
          </span>
        </div>
        <div className="dm-section">
          <span>Moves</span>
          <span>PP left</span>
        </div>
        <div className="dm-list">
          {mon.moves.map((m, i) => (
            <div key={`${i}:${m.move}`} data-row className="dm-c dm-row">
              {!lookOnly && mon.moves.length > 1 && (
                <span className="dm-drag" aria-label="Drag to move" {...moveMove(i)}>
                  ⋮⋮
                </span>
              )}
              <span className="grow">{niceName(moveName(rom, m.move))}</span>
              <span className="right">PP {m.pp}</span>
            </div>
          ))}
        </div>
        <div className="dm-c dm-lines">
          <div>
            <span className="k">Attack</span>
            <span>{mon.stats.attack}</span>
          </div>
          <div>
            <span className="k">Defence</span>
            <span>{mon.stats.defense}</span>
          </div>
          <div>
            <span className="k">Speed</span>
            <span>{mon.stats.speed}</span>
          </div>
          <div>
            <span className="k">Special</span>
            <span>{mon.stats.special}</span>
          </div>
          <div>
            <span className="k">Trainer</span>
            <span>{own ? "You" : `${niceName(mon.ot)} (a friend)`}</span>
          </div>
        </div>
        {!lookOnly && usable.length > 0 && (
          <>
            <div className="dm-section">
              <span>Give {niceName(mon.nick)} something</span>
            </div>
            <div className="dm-list">
              {usable.map((b) => (
                <button key={b.item} type="button" className="dm-c dm-row" onClick={() => void act({ kind: "use-item", item: b.item, mon: slot })}>
                  <ShelfIcon shelf={shelf(rom, b.item)} />
                  <span className="grow">
                    <span>{niceName(niceItem(rom, b.item))}</span>
                    <span className="sub">{itemLine(rom, b.item)}</span>
                  </span>
                  <span className="right">×{b.quantity}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <button type="button" className="dm-verb alt" onClick={() => open({ kind: "mon", dex: pokedexNumber(rom, mon.species) })}>
          Pokédex page
        </button>
      </div>
    </>
  );
}

export function ItemPage({ item }: { item: number }) {
  const { game, rom, act, journal, lookOnly } = useMenu();
  const [choosing, setChoosing] = useState(false);
  const [toss, setToss] = useState(0);
  const held = game?.bag.find((b) => b.item === item);
  const history = journal?.items().find((h) => h.item === item);
  const name = niceName(niceItem(rom, item));
  const onMon = itemUse(rom, item).onMon;
  const key = isKeyItem(rom, item);
  const price = itemPrice(rom, item);
  const teach = item >= 0xc4;
  const use = (mon?: number) => {
    setChoosing(false);
    // A machine's "Teach it?" is yes; a full set of moves still says no to forgetting one.
    void act({ kind: "use-item", item, ...(mon === undefined ? {} : { mon }), ...(teach ? { answers: [true] } : {}) });
  };
  return (
    <>
      <Head title={name} pill={held && !key ? `×${held.quantity}` : undefined} back />
      <div className="dm-body">
        <div className="dm-c dm-row">
          <ShelfIcon shelf={shelf(rom, item)} />
          <span className="grow">
            <span>{name}</span>
            <span className="sub">{itemLine(rom, item) || shelf(rom, item)}</span>
          </span>
        </div>
        <div className="dm-c dm-lines">
          {price > 0 && (
            <div>
              <span className="k">In shops</span>
              <span>{money(price)}</span>
            </div>
          )}
          {history && (
            <div>
              <span className="k">You've had</span>
              <span>{history.obtained}</span>
            </div>
          )}
          {history && history.used > 0 && (
            <div>
              <span className="k">Used</span>
              <span>{history.used}</span>
            </div>
          )}
        </div>
        {held && !lookOnly && (
          <div className="dm-verbs">
            {needsMove(item) ? (
              <p className="dm-hint">Use this one from the game's own bag for now.</p>
            ) : onMon ? (
              <button type="button" className="dm-verb" onClick={() => setChoosing(!choosing)} aria-expanded={choosing}>
                {teach ? "Teach a Pokémon" : "Use on a Pokémon"}
              </button>
            ) : (
              <button type="button" className="dm-verb" onClick={() => use()}>
                Use it
              </button>
            )}
            {choosing && game && (
              <div className="dm-list">
                {game.team.map((mon, slot) => (
                  <button key={slot} type="button" className="dm-c dm-row" onClick={() => use(slot)}>
                    <BallPic species={mon.species} />
                    <TeamRowBody mon={mon} />
                  </button>
                ))}
              </div>
            )}
            {!key && toss === 0 && (
              <button type="button" className="dm-verb alt" onClick={() => setToss(1)}>
                Throw some away
              </button>
            )}
            {!key && toss > 0 && (
              <div className="dm-c" style={{ padding: 12 }}>
                <div className="dm-qty">
                  <button type="button" aria-label="Fewer" disabled={toss <= 1} onClick={() => setToss(toss - 1)}>
                    −
                  </button>
                  <output>{toss}</output>
                  <button type="button" aria-label="More" disabled={toss >= held.quantity} onClick={() => setToss(toss + 1)}>
                    +
                  </button>
                </div>
                <div className="dm-two">
                  <button type="button" className="dm-verb alt" onClick={() => setToss(0)}>
                    Keep them
                  </button>
                  <button
                    type="button"
                    className="dm-verb"
                    onClick={() => {
                      setToss(0);
                      void act({ kind: "toss-item", item, quantity: toss });
                    }}
                  >
                    Throw away
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {!held && <p className="dm-empty">You've run out of these.</p>}
      </div>
    </>
  );
}
