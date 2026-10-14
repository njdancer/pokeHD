// How many to buy or sell at the Poké Mart (QA #70): the game's own "How many?" as a stepper, with
// the total and the money after, then one button for what the game asks next ("That will be ₽…
// OK?"). The number answers the game's own questions (LiveActions.buy and .sell); the limits are
// the game's (quantity.ts), so the picker never offers what the game would refuse.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { niceItem, useEnv } from "../env.tsx";
import { ItemIcon } from "../icons.tsx";
import type { ItemKind } from "../model.ts";
import { useNav } from "../nav.tsx";
import { buyMax, buyTotal, limitOf, moneyAfter, sellMax, sellTotal } from "../quantity.ts";
import { Page, Verbs } from "../ui.tsx";

/** Something on the Mart's shelf. */
export interface StockItem {
  id: number;
  name: string;
  price: number;
  kind: ItemKind;
}

const QUICK = [1, 5, 10];
const yen = (n: number) => `₽${n.toLocaleString("en")}`;

/** Buy `item` from the Mart's list. */
export function BuyScreen({ item }: { item: StockItem }) {
  const env = useEnv();
  const nav = useNav();
  const { model, actions } = env;
  const money = model.trainer.money;
  const bag = model.bag.map((b) => ({ item: b.id, quantity: b.count ?? 1 }));
  const have = model.bag.filter((b) => b.id === item.id).reduce((n, b) => n + (b.count ?? 0), 0);
  const max = buyMax(money, item.price, bag, item.id);
  return (
    <QuantityPick
      mode="buy"
      id={item.id}
      name={item.name}
      kind={item.kind}
      price={item.price}
      have={have}
      max={max}
      money={money}
      limit={limitOf("buy", max, money, item.price, have)}
      onDone={(n) => {
        env.toast(actions.buy(item.id, n));
        // Back to the shelf: the game takes the money and says its thanks as a notice.
        nav.back();
      }}
    />
  );
}

/** Sell the bag's `id` (its first stack, the one the game's list gives). */
export function SellScreen({ id }: { id: number }) {
  const env = useEnv();
  const nav = useNav();
  const { model, actions } = env;
  const it = model.bag.find((b) => b.id === id);
  if (!it) return null;
  const price = it.price ?? (it.sell ?? 0) * 2;
  const stack = it.count ?? 0;
  const max = it.kind === "Key" ? 0 : sellMax(stack, price);
  return (
    <QuantityPick
      mode="sell"
      id={it.id}
      name={it.name}
      kind={it.kind}
      price={price}
      have={stack}
      max={max}
      money={model.trainer.money}
      limit={limitOf("sell", max, model.trainer.money, price, stack)}
      onDone={(n) => {
        env.toast(actions.sell(it.id, n));
        nav.reset();
      }}
    />
  );
}

interface PickProps {
  mode: "buy" | "sell";
  id: number;
  name: string;
  kind: ItemKind;
  /** The game's price for one; a sale pays half of the whole. */
  price: number;
  have: number;
  /** The most the game would go through with (0: none). */
  max: number;
  money: number;
  limit: string;
  onDone(count: number): void;
}

export function QuantityPick({ mode, id, name, kind, price, have, max, money, limit, onDone }: PickProps) {
  const nav = useNav();
  const [count, setCount] = useState(1);
  const n = Math.max(1, Math.min(count, max));
  const selling = mode === "sell";
  const total = selling ? sellTotal(price, n) : buyTotal(price, n);
  const after = moneyAfter(money, total, selling);
  const each = selling ? price / 2 : price;
  const verb = selling ? "Sell" : "Buy";
  return (
    <Page title={selling ? "Sell" : "Buy"} meta={yen(money)} banner={selling ? "How many? The Mart pays half price" : "How many would you like?"}>
      <div className="m-card m-qtyitem">
        <span className="m-itemicon">
          <ItemIcon id={id} kind={kind} />
        </span>
        <span className="m-text">
          <span className="m-title">{niceItem(name)}</span>
          <span className="m-sub">{selling ? `${Number.isInteger(each) ? yen(each) : `Half of ${yen(price)}`} each` : `${yen(price)} each`}</span>
        </span>
        <span className="m-right">
          <span>{selling ? "You have" : "In your bag"}</span>
          <b>{have}</b>
        </span>
      </div>

      <div className="m-card m-qtypick">
        <div className="m-qtyrow">
          <Step dir={-1} disabled={max === 0 || n <= 1} onStep={() => setCount((c) => Math.max(1, Math.min(c, max) - 1))} />
          <output className="m-qtyn" aria-live="polite" aria-label={`${n} ${niceItem(name)}`}>
            <small>×</small>
            {max === 0 ? 0 : n}
          </output>
          <Step dir={1} disabled={n >= max} onStep={() => setCount((c) => Math.min(max, Math.max(1, c) + 1))} />
        </div>
        <div className="m-qtyquick" role="group" aria-label="Quick amounts">
          {QUICK.map((q) => (
            <button key={q} type="button" aria-pressed={n === q && max > 0} disabled={q > max} onClick={() => setCount(q)}>
              {q}
            </button>
          ))}
          <button type="button" aria-pressed={n === max && max > 0 && !QUICK.includes(max)} disabled={max === 0} onClick={() => setCount(max)}>
            Max{max > 0 && <small> {max}</small>}
          </button>
        </div>
        <p className="m-qtylimit">{limit}</p>
      </div>

      <dl className="m-card m-kv m-qtysum">
        <div>
          <dt>
            {max === 0 ? 0 : n} × {Number.isInteger(each) ? yen(each) : `½ of ${yen(price)}`}
          </dt>
          <dd className="m-qtytotal">{selling ? "+" : "−"}{yen(max === 0 ? 0 : total)}</dd>
        </div>
        <div>
          <dt>Money after</dt>
          <dd>{yen(max === 0 ? money : after)}</dd>
        </div>
      </dl>

      <Verbs
        verbs={[
          max === 0
            ? { label: verb, off: limit }
            : { label: `${verb} ${n} for ${yen(total)}`, run: () => onDone(n) },
          { label: "Cancel", alt: true, run: nav.back },
        ]}
      />
    </Page>
  );
}

/** − or +: a tap is one; held down it keeps going, faster after a moment. */
function Step({ dir, disabled, onStep }: { dir: 1 | -1; disabled: boolean; onStep(): void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const step = useRef(onStep);
  useLayoutEffect(() => {
    step.current = onStep;
  });
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  useEffect(() => {
    if (disabled) stop();
  }, [disabled]);
  const start = (e: ReactPointerEvent) => {
    if (disabled || e.button !== 0) return;
    step.current();
    let wait = 380;
    const again = () => {
      step.current();
      wait = Math.max(45, wait * 0.8);
      timer.current = setTimeout(again, wait);
    };
    timer.current = setTimeout(again, wait);
  };
  return (
    <button
      type="button"
      className="m-round m-qtystep"
      aria-label={dir > 0 ? "One more" : "One fewer"}
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      // A keyboard's Enter or Space (no pointer went down): one step.
      onClick={(e) => e.detail === 0 && onStep()}
    >
      {dir > 0 ? "+" : "−"}
    </button>
  );
}
