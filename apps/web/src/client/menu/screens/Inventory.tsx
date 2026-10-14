// The Inventory tab: your team (Pokémon in their balls, the leader first) and your items, both
// reordered by dragging. Filters narrow it to a kind, or bring back things you've run out of. The
// same lists answer the game's requests in a sheet (battle Team and Bag, PC, Mart).
import { useState } from "react";
import { monPic, niceItem, niceMon, useEnv } from "../env.tsx";
import { BallMark, ItemIcon } from "../icons.tsx";
import { useNav, type Purpose } from "../nav.tsx";
import { inBattle, ITEM_KINDS, type Item, type ItemKind, type Mon } from "../model.ts";
import { HpBar, Page, Pixel, ReadButton, Row, Section, SortList, StatusPill, Switch, Types, Verbs } from "../ui.tsx";
import { canLearn, itemVerbs, monVerbs, onMon } from "../verbs.ts";

type Kind = "all" | "Pokémon" | ItemKind;

export function MonRow({ m, i, grip, onClick, off, active }: { m: Mon; i: number; grip?: React.ReactNode; onClick?: () => void; off?: boolean; active?: boolean }) {
  const env = useEnv();
  return (
    <div className={`m-monrow${off ? " off" : ""}${active ? " active" : ""}`}>
      {grip}
      <Row
        media={
          <span className="m-inball">
            <Pixel src={monPic(env, m.dex)} />
            <BallMark size={16} />
          </span>
        }
        title={
          <>
            {niceMon(m.name)} <StatusPill status={m.hp === 0 ? undefined : m.status} />
            {m.hp === 0 && <span className="m-status s-fnt">Fainted</span>}
            {i === 0 && !active && <span className="m-lead">Leader</span>}
            {active && <span className="m-lead now">In battle</span>}
          </>
        }
        sub={<HpBar mon={m} />}
        right={
          <>
            <b>Lv {m.level}</b>
            <span>
              {m.hp}/{m.maxHp}
            </span>
          </>
        }
        onClick={onClick}
        off={off}
      />
    </div>
  );
}

export function ItemRow({ it, grip, onClick, right, faded }: { it: Item; grip?: React.ReactNode; onClick?: () => void; right?: React.ReactNode; faded?: boolean }) {
  return (
    <div className={`m-itemrow${faded ? " faded" : ""}`}>
      {grip}
      <Row
        media={
          <span className="m-itemicon">
            <ItemIcon id={it.id} kind={it.kind} />
          </span>
        }
        title={
          <>
            {niceItem(it.name)}
            {it.sub && <span className="m-faint"> {niceItem(it.sub)}</span>}
          </>
        }
        sub={it.gone ?? it.kind}
        right={right ?? (it.count !== undefined && it.count > 0 ? <b className="m-count">×{it.count}</b> : undefined)}
        onClick={onClick}
      />
    </div>
  );
}

export function InventoryScreen() {
  const env = useEnv();
  const nav = useNav();
  const { model, actions, moment } = env;
  const [kind, setKind] = useState<Kind>("all");
  const [past, setPast] = useState(false);
  const [open, setOpen] = useState(false);
  const battle = inBattle(moment);
  const mons = kind === "all" || kind === "Pokémon";
  const items = model.bag.filter((b) => kind === "all" || b.kind === kind);
  const gone = past ? model.past.filter((b) => kind === "all" || b.kind === kind) : [];
  const filters = (kind !== "all" ? 1 : 0) + (past ? 1 : 0);
  return (
    <Page title="Inventory" meta={`₽${model.trainer.money.toLocaleString()}`}>
      <div className="m-filterbar">
        <button type="button" className={`m-filterbtn${open ? " open" : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}>
          Filters {filters > 0 && <b>{filters}</b>}
        </button>
        {kind !== "all" && (
          <button type="button" className="m-fchip" onClick={() => setKind("all")}>
            {kind} <span aria-label="Remove">×</span>
          </button>
        )}
        {past && (
          <button type="button" className="m-fchip" onClick={() => setPast(false)}>
            Run out of <span aria-label="Remove">×</span>
          </button>
        )}
      </div>
      {open && (
        <div className="m-card m-fpanel">
          <div className="m-chips">
            {(["all", "Pokémon", ...ITEM_KINDS] as Kind[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}>
                {k === "all" ? "Everything" : k}
              </button>
            ))}
          </div>
          <Switch on={past} onChange={setPast} label="Show things you've run out of" sub="Anything you've ever had stays here, faded" />
        </div>
      )}
      {mons && (
        <>
          <Section right={<span className="m-faint">{model.team.length} of 6</span>}>Your team</Section>
          <SortList
            label="Your team"
            items={model.team}
            keyOf={(m) => m.key}
            enabled={!battle}
            onMove={actions.moveMon}
            render={(m, i, grip) => <MonRow m={m} i={i} grip={grip} onClick={() => nav.go({ k: "mon", i })} />}
          />
          <p className="m-foot">{battle ? "In battle you can look. Choose on the battle screen." : `Drag to change the order: the first one leads. ${model.box.length} more are in BILL's PC.`}</p>
        </>
      )}
      {kind !== "Pokémon" && (
        <>
          {mons && <Section right={<span className="m-faint">{model.bag.length} things</span>}>Items</Section>}
          <SortList
            label="Items"
            items={items}
            keyOf={(it) => String(it.id)}
            enabled={!battle && kind === "all"}
            onMove={actions.moveItem}
            render={(it, _i, grip) => <ItemRow it={it} grip={grip} onClick={() => nav.go({ k: "item", id: it.id })} />}
          />
          {!items.length && !gone.length && <p className="m-empty">Nothing here yet.</p>}
          {gone.length > 0 && (
            <>
              <Section>Run out of</Section>
              <div className="m-list">
                {gone.map((it) => (
                  <ItemRow key={it.id} it={it} faded onClick={() => nav.go({ k: "item", id: it.id })} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Page>
  );
}

const purposeLine = (env: ReturnType<typeof useEnv>, p?: Purpose) => {
  if (!p) return undefined;
  if ("use" in p) return `Use ${niceItem(env.model.bag.find((b) => b.id === p.use)?.name ?? "")} on which Pokémon?`;
  if ("teach" in p) return "Teach it to which Pokémon?";
  if ("giftTo" in p) return `Send to ${env.model.friends.find((f) => f.id === p.giftTo)?.name}`;
  return `Use what on ${niceMon(env.model.team[p.onMon]?.name ?? "")}?`;
};

export function MonScreen({ i, purpose }: { i: number; purpose?: Purpose }) {
  const env = useEnv();
  const nav = useNav();
  const m = env.model.team[i];
  if (!m) return null;
  const e = env.catalogue.entries[m.dex - 1];
  const battle = inBattle(env.moment);
  return (
    <Page title={niceMon(m.name)} meta={`Lv ${m.level}`} banner={purposeLine(env, purpose) ?? (battle && nav.sheet && i > 0 ? "Sending it out uses your turn" : undefined)}>
      <div className="m-hero mon">
        <div className="m-hero-pic">
          <Pixel src={monPic(env, m.dex)} />
        </div>
        <div className="m-hero-text">
          <span className="m-no">{i === 0 ? "Your leader" : `In your team`}</span>
          <h3>{niceMon(m.name)}</h3>
          <span className="m-sub">
            HP {m.hp} of {m.maxHp} <StatusPill status={m.status} />
          </span>
          <HpBar mon={m} big />
          {e && <Types types={e.types} />}
        </div>
      </div>
      <Verbs verbs={monVerbs(env, nav, i, purpose)} />
      {!purpose && (
        <>
          <Section right={!battle || nav.sheet ? <span className="m-faint">Drag to reorder</span> : undefined}>Moves</Section>
          <SortList
            label="Moves"
            items={m.moves}
            keyOf={(mv) => mv.name}
            enabled={!battle}
            onMove={(a, b) => env.actions.moveMove(i, a, b)}
            render={(mv, _j, grip) => (
              <div className="m-moverow">
                {grip}
                <Row title={niceMon(mv.name)} sub={<span className="m-movetype" data-type={mv.type}>{mv.type.toLowerCase()}</span>} right={<span>PP {mv.pp}/{mv.maxPp}</span>} />
              </div>
            )}
          />
          {e && <Row title="Pokédex page" sub={`${e.category.charAt(0) + e.category.slice(1).toLowerCase()} Pokémon`} onClick={() => nav.tab("dex", { k: "entry", dex: m.dex })} />}
        </>
      )}
    </Page>
  );
}

export function ItemScreen({ id, purpose }: { id: number; purpose?: Purpose }) {
  const env = useEnv();
  const nav = useNav();
  const it = env.model.bag.find((b) => b.id === id) ?? env.model.past.find((b) => b.id === id);
  const [count, setCount] = useState(1);
  if (!it) return null;
  const selling = env.moment === "shop" && nav.sheet;
  const have = it.count === undefined ? (it.gone ? "Not any more" : "Yes") : it.count ? `${it.count}` : it.gone ?? "None left";
  return (
    <Page title={niceItem(it.name)} meta={it.count ? `×${it.count}` : it.kind} banner={purposeLine(env, purpose) ?? (selling ? "Selling at the Poké Mart" : inBattle(env.moment) && nav.sheet ? "Using it uses your turn" : undefined)}>
      <div className="m-hero item">
        <div className="m-hero-pic">
          <ItemIcon id={it.id} kind={it.kind} />
        </div>
        <div className="m-hero-text">
          <span className="m-no">{it.kind}</span>
          <h3>
            {niceItem(it.name)}
            {it.sub && <span className="m-faint"> · {niceItem(it.sub)}</span>}
          </h3>
          <p className="m-sub">{it.text}</p>
        </div>
      </div>
      {selling && it.sell && it.count ? (
        <div className="m-card m-qty">
          <button type="button" className="m-round" aria-label="One fewer" onClick={() => setCount(Math.max(1, count - 1))}>−</button>
          <b>{count}</b>
          <button type="button" className="m-round" aria-label="One more" onClick={() => setCount(Math.min(it.count ?? 1, count + 1))}>+</button>
        </div>
      ) : null}
      <Verbs verbs={itemVerbs(env, nav, it, purpose, count)} />
      {!purpose && !selling && (
        <>
          <dl className="m-card m-kv">
            {it.buy && (
              <div>
                <dt>Buy</dt>
                <dd>{it.buy}</dd>
              </div>
            )}
            {it.found && (
              <div>
                <dt>Found</dt>
                <dd>{it.found}</dd>
              </div>
            )}
            <div>
              <dt>You have</dt>
              <dd>{have}</dd>
            </div>
          </dl>
          {it.place && <Verbs verbs={[{ label: "Show on the map", alt: true, run: () => nav.tab("map", { k: "map", focus: it.place }) }]} />}
          <ReadButton text={`${it.name}. ${it.text}`} />
        </>
      )}
    </Page>
  );
}

/** The team, to pick one for something already started (use, teach, gift; PC deposit; battle). */
export function TeamPick({ purpose, title = "Your team" }: { purpose?: Purpose; title?: string }) {
  const env = useEnv();
  const nav = useNav();
  const { model, moment } = env;
  const it = purpose && "use" in purpose ? model.bag.find((b) => b.id === purpose.use) : undefined;
  const offFor = (m: Mon) => (purpose && "teach" in purpose ? !canLearn(env, m, purpose.teach) : moment === "fainted" ? m.hp === 0 : false);
  const banner =
    purposeLine(env, purpose) ??
    (moment === "fainted" ? `${niceMon(model.team[0]!.name)} fainted! Who's next?` : moment === "pc" ? "Put which Pokémon in the PC?" : inBattle(moment) ? "Sending one out uses your turn" : undefined);
  return (
    <Page title={title} meta={`${model.team.length} of 6`} banner={banner}>
      <div className="m-list">
        {model.team.map((m, i) => (
          <MonRow key={m.key} m={m} i={i} off={offFor(m)} active={inBattle(moment) && moment !== "fainted" && i === 0} onClick={() => nav.go({ k: "mon", i, for: purpose })} />
        ))}
      </div>
      {it && <p className="m-foot">{niceItem(it.name)}: {it.text}</p>}
    </Page>
  );
}

/** The bag, to pick an item for something already started, or as the battle and Mart sheets. */
export function BagPick({ purpose }: { purpose?: Purpose }) {
  const env = useEnv();
  const nav = useNav();
  const { model, moment } = env;
  let items = model.bag;
  if (purpose && "onMon" in purpose) items = items.filter(onMon);
  if (purpose && "giftTo" in purpose) items = items.filter((b) => b.kind !== "Key" && b.kind !== "Machines");
  if (moment === "wild") items = [...items].sort((a, b) => Number(b.kind === "Balls") - Number(a.kind === "Balls"));
  if (inBattle(moment) && nav.sheet) items = items.filter((b) => b.kind === "Healing" || b.kind === "Balls" || b.kind === "Battle");
  const selling = moment === "shop" && nav.sheet;
  const banner = purposeLine(env, purpose) ?? (selling ? "Sell what? The Mart pays half price" : inBattle(moment) ? "Using an item uses your turn" : undefined);
  return (
    <Page title="Bag" meta={`₽${model.trainer.money.toLocaleString()}`} banner={banner}>
      <div className="m-list">
        {items.map((it) => (
          <ItemRow
            key={it.id}
            it={it}
            right={selling ? (it.sell && it.kind !== "Key" ? <b className="m-count">₽{it.sell}</b> : <span className="m-faint">Keep</span>) : undefined}
            onClick={() => nav.go({ k: "item", id: it.id, for: purpose })}
          />
        ))}
      </div>
      {!items.length && <p className="m-empty">Nothing that works here.</p>}
    </Page>
  );
}

/** Bill's PC: take one out (the withdraw sheet). */
export function BoxPick() {
  const env = useEnv();
  const { model, actions } = env;
  const nav = useNav();
  const full = model.team.length >= 6;
  return (
    <Page title="Box 1" meta={`${model.box.length} of 20`} banner={full ? "Your team is full. Put one in first" : "Take which Pokémon with you?"}>
      <div className="m-list">
        {model.box.map((m, i) => (
          <Row
            key={m.key}
            media={<Pixel src={monPic(env, m.dex)} />}
            title={niceMon(m.name)}
            sub={`Level ${m.level}`}
            right={
              <button type="button" className="m-pill" disabled={full} onClick={() => (env.toast(actions.withdraw(i)), nav.close())}>
                Take
              </button>
            }
          />
        ))}
      </div>
    </Page>
  );
}

/** The Poké Mart's counter (the buy sheet). */
export function ShopPick({ stock }: { stock: { id: number; name: string; price: number; kind: ItemKind }[] }) {
  const env = useEnv();
  const { model, actions } = env;
  return (
    <Page title="Poké Mart" meta={`₽${model.trainer.money.toLocaleString()}`} banner="What would you like?">
      <div className="m-list">
        {stock.map((s) => {
          const have = model.bag.find((b) => b.id === s.id)?.count ?? 0;
          return (
            <Row
              key={s.id}
              media={
                <span className="m-itemicon">
                  <ItemIcon id={s.id} kind={s.kind} />
                </span>
              }
              title={niceItem(s.name)}
              sub={have ? `You have ${have}` : "You have none"}
              right={
                <button type="button" className="m-pill" disabled={model.trainer.money < s.price} onClick={() => env.toast(actions.buy(s.id, 1))}>
                  ₽{s.price}
                </button>
              }
            />
          );
        })}
      </div>
    </Page>
  );
}
