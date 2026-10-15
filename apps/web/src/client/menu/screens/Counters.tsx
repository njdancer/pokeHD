// Proposals (UI pass, 2026-10-15) for the game's counter menus, which the HD layer drew as several
// boxes at once: the Mart's BUY / SELL / QUIT with a MONEY box and the clerk's line, and Bill's
// PC's WITHDRAW / DEPOSIT / RELEASE / CHANGE BOX with "What?" and BOX No. 1 over it. Each is one
// sheet here, in two looks for Nick to pick from at /dev/menu: "menu" (the game's choices as big
// rows, each opening its list) and "tabs" (the lists themselves, one tab each). Standalone until
// picked: the live game still shows the game's own menus.
import { useState } from "react";
import { useEnv } from "../env.tsx";
import { RowIcon } from "../icons.tsx";
import { useNav } from "../nav.tsx";
import { Page, Row, Seg, Verbs } from "../ui.tsx";
import { sellable } from "../verbs.ts";
import { BoxList, ItemRow, MonRow, ShopList } from "./Inventory.tsx";
import type { StockItem } from "./Quantity.tsx";

export type CounterLook = "menu" | "tabs";

const yen = (n: number) => `₽${n.toLocaleString("en")}`;

/** The bag at the Mart's counter: what sells, for half the price, and what you keep. */
export function SellList() {
  const { model } = useEnv();
  const nav = useNav();
  return (
    <div className="m-list">
      {model.bag.map((it) => (
        <ItemRow
          key={it.id}
          it={it}
          right={sellable(it) ? <b className="m-count">{yen(it.sell ?? 0)}</b> : <span className="m-faint">Keep</span>}
          onClick={() => nav.go(sellable(it) ? { k: "sell", id: it.id } : { k: "item", id: it.id })}
        />
      ))}
    </div>
  );
}

/** The team at the PC: pick one to put in the box. */
export function DepositList() {
  const { model } = useEnv();
  const nav = useNav();
  return (
    <div className="m-list">
      {model.team.map((m, i) => (
        <MonRow key={m.key} m={m} i={i} onClick={() => nav.go({ k: "mon", i })} />
      ))}
    </div>
  );
}

/** Talking to the clerk: one sheet for the whole visit. `onLeave` is QUIT ("Thank you!"). */
export function MartCounter({ stock, look, onLeave }: { stock: StockItem[]; look: CounterLook; onLeave(): void }) {
  const env = useEnv();
  const nav = useNav();
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const { model } = env;
  const leave = () => {
    env.toast("Thank you!");
    onLeave();
  };
  const sells = model.bag.filter(sellable).length;
  if (look === "tabs")
    return (
      <Page title="Poké Mart" meta={yen(model.trainer.money)} banner={tab === "buy" ? "Hi there! What would you like?" : "Sell what? The Mart pays half price"}>
        <Seg label="Buy or sell" value={tab} onChange={setTab} options={[["buy", "Buy"], ["sell", "Sell"]]} />
        {tab === "buy" ? <ShopList stock={stock} /> : <SellList />}
        <Verbs verbs={[{ label: "Done", alt: true, run: leave }]} />
      </Page>
    );
  return (
    <Page title="Poké Mart" meta={yen(model.trainer.money)} banner="Hi there! May I help you?">
      <div className="m-list">
        <Row media={<RowIcon kind="ball" />} title="Buy" sub={`${stock.length} things on the shelves`} onClick={() => nav.go({ k: "shelf", stock })} />
        <Row media={<RowIcon kind="star" />} title="Sell" sub={sells ? `Half price for ${sells} things in your bag` : "Nothing in your bag sells"} off={!sells} onClick={() => nav.go({ k: "sellbag" })} />
      </div>
      <Verbs verbs={[{ label: "Done", alt: true, run: leave }]} />
    </Page>
  );
}

/** Bill's PC: one sheet for the box and the team. `onLeave` is SEE YA!. */
export function PcCounter({ look, onLeave }: { look: CounterLook; onLeave(): void }) {
  const env = useEnv();
  const nav = useNav();
  const { model } = env;
  const [tab, setTab] = useState<"box" | "team">("box");
  const full = model.team.length >= 6;
  const meta = `Box 1 · ${model.box.length} of 20`;
  const soon = () => env.toast("Not in this mock yet");
  if (look === "tabs")
    return (
      <Page title="Bill's PC" meta={meta} banner={tab === "box" ? (full ? "Your team is full. Put one in first" : "Take which Pokémon with you?") : "Put which Pokémon in the PC?"}>
        <Seg label="Box or team" value={tab} onChange={setTab} options={[["box", `In the box (${model.box.length})`], ["team", `Your team (${model.team.length})`]]} />
        {tab === "box" ? <BoxList /> : <DepositList />}
        <Verbs verbs={[{ label: "Change box", alt: true, run: soon }, { label: "Done", alt: true, run: onLeave }]} />
      </Page>
    );
  return (
    <Page title="Bill's PC" meta={meta} banner="What do you want to do?">
      <div className="m-list">
        <Row media={<RowIcon kind="ball" />} title="Take one out" sub={full ? "Your team is full" : `${model.box.length} in this box`} off={!model.box.length} onClick={() => nav.go({ k: "box" })} />
        <Row media={<RowIcon kind="save" />} title="Put one in" sub={model.team.length < 2 ? "Keep one with you" : `${model.team.length} in your team`} off={model.team.length < 2} onClick={() => nav.go({ k: "deposit" })} />
        <Row media={<RowIcon kind="flag" />} title="Let one go" sub="For good: it can't come back" onClick={soon} />
        <Row media={<RowIcon kind="gear" />} title="Change box" sub="Box 1 of 12" onClick={soon} />
      </div>
      <Verbs verbs={[{ label: "Done", alt: true, run: onLeave }]} />
    </Page>
  );
}

/** The lists the menu look's rows open, with their own headings. */
export function ShelfScreen({ stock }: { stock: StockItem[] }) {
  const { model } = useEnv();
  return (
    <Page title="Buy" meta={yen(model.trainer.money)} banner="What would you like?">
      <ShopList stock={stock} />
    </Page>
  );
}

export function SellBagScreen() {
  const { model } = useEnv();
  return (
    <Page title="Sell" meta={yen(model.trainer.money)} banner="Sell what? The Mart pays half price">
      <SellList />
    </Page>
  );
}

export function BoxScreen() {
  const { model } = useEnv();
  return (
    <Page title="Box 1" meta={`${model.box.length} of 20`} banner={model.team.length >= 6 ? "Your team is full. Put one in first" : "Take which Pokémon with you?"}>
      <BoxList />
    </Page>
  );
}

export function DepositScreen() {
  const { model } = useEnv();
  return (
    <Page title="Put one in" meta={`${model.team.length} of 6`} banner="Put which Pokémon in the PC?">
      <DepositList />
    </Page>
  );
}
