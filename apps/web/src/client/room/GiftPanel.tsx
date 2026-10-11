import { useEffect, useState, useSyncExternalStore } from "react";
import type { GiftSpec } from "@pokehd/emu";
import type { PlayerInfo } from "@pokehd/protocol";
import type { GiftCourier, GiftNotice } from "./gifts.ts";
import { decodeGiftables, describeGift, GIFT_REASONS, type Giftables } from "./giftables.ts";
import "./gift-panel.css";

interface PanelProps {
  rom: Uint8Array;
  courier: GiftCourier;
  /** Everyone else in the room. */
  friends: readonly PlayerInfo[];
  /** Reads the party, bag and money (`EmulatorHost.read`). */
  read: () => Promise<Uint8Array[]>;
  onClose(): void;
}

/**
 * Sends a friend money, an item or a Pokémon (D20). The gift leaves the game at its next quiet
 * moment in the overworld, and the game saves straight after, as the Cable Club does.
 */
export function GiftPanel({ rom, courier, friends, read, onClose }: PanelProps) {
  const [giftables, setGiftables] = useState<Giftables>();
  const [picked, setTo] = useState<string>("");
  // The friend picked, or the first one online if they've left (or none was picked yet).
  const to = friends.some((f) => f.id === picked) ? picked : (friends[0]?.id ?? "");
  const [tab, setTab] = useState<"mon" | "item" | "money">("mon");
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<{ busy: boolean; text: string }>({ busy: false, text: "" });

  const refresh = () => void read().then((bytes) => setGiftables(decodeGiftables(rom, bytes)));
  useEffect(refresh, [rom, read]);

  const friend = friends.find((f) => f.id === to);
  const send = async (spec: GiftSpec) => {
    if (!friend || status.busy) return;
    setStatus({ busy: true, text: "Waiting for a quiet moment in the game…" });
    const result = await courier.send(friend, spec);
    setStatus({
      busy: false,
      text: result.ok ? `Sent ${describeGift(rom, result.gift)} to ${friend.name}. Your game saved.` : (GIFT_REASONS[result.reason] ?? `Couldn't send it (${result.reason}).`),
    });
    refresh();
  };

  const money = Number(amount);
  const moneyOk = Number.isInteger(money) && money >= 1 && money <= (giftables?.money ?? 0);

  return (
    <div className="gift-panel" role="dialog" aria-labelledby="gift-panel-title">
      <h2 id="gift-panel-title">Send a gift</h2>
      {friends.length === 0 ? (
        <p>No friends are online.</p>
      ) : (
        <>
          <label className="gift-to">
            To{" "}
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              {friends.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </label>
          <div className="gift-tabs" role="tablist">
            {(["mon", "item", "money"] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                {{ mon: "Pokémon", item: "Item", money: "Money" }[t]}
              </button>
            ))}
          </div>
          {!giftables ? (
            <p>Reading your game…</p>
          ) : tab === "mon" ? (
            <ul>
              {giftables.party.map((m) => (
                <li key={m.slot}>
                  <span>{m.nick}{m.nick !== m.speciesName && <small> {m.speciesName}</small>} <small>Lv {m.level}</small></span>
                  <button
                    type="button"
                    disabled={status.busy || giftables.party.length < 2}
                    title={giftables.party.length < 2 ? "You can't give away your last Pokémon" : undefined}
                    onClick={() => void send({ kind: "mon", slot: m.slot, species: m.species })}
                  >
                    Send
                  </button>
                </li>
              ))}
              {giftables.party.length === 0 && <li>No Pokémon yet.</li>}
            </ul>
          ) : tab === "item" ? (
            <ul>
              {giftables.bag.map((it) => {
                const n = Math.min(counts[it.slot] ?? 1, it.quantity);
                return (
                  <li key={it.slot}>
                    <span>{it.name} <small>×{it.quantity}</small></span>
                    {it.key ? (
                      <small>Key item</small>
                    ) : (
                      <span>
                        <input
                          type="number"
                          min={1}
                          max={it.quantity}
                          value={n}
                          aria-label={`How many ${it.name}`}
                          onChange={(e) => setCounts({ ...counts, [it.slot]: Math.max(1, Math.min(it.quantity, Number(e.target.value) || 1)) })}
                        />
                        <button
                          type="button"
                          disabled={status.busy}
                          onClick={() => void send({ kind: "item", slot: it.slot, item: it.item, quantity: n })}
                        >
                          Send
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
              {giftables.bag.length === 0 && <li>Your bag is empty.</li>}
            </ul>
          ) : (
            <form
              className="gift-money"
              onSubmit={(e) => {
                e.preventDefault();
                if (moneyOk) void send({ kind: "money", amount: money });
              }}
            >
              <span>You have ¥{giftables.money.toLocaleString("en-US")}</span>
              <input type="number" min={1} max={giftables.money} value={amount} placeholder="¥" aria-label="Amount" onChange={(e) => setAmount(e.target.value)} />
              <button type="submit" disabled={status.busy || !moneyOk}>Send</button>
            </form>
          )}
          <p className="gift-note">{status.text || "Sending saves your game."}</p>
        </>
      )}
      <button type="button" className="gift-close" onClick={onClose}>Close</button>
    </div>
  );
}

const WAITING: Record<string, string> = {
  "bag full": "Make room in your bag to take it.",
  "party and box full": "Make room in your party or box to take it.",
  "money would pass ¥999,999": "Spend some money to take it.",
};

/** Gifts arriving, waiting for room, and the ones you sent reaching the room. */
export function GiftNotices({ rom, courier }: { rom: Uint8Array; courier: GiftCourier }) {
  const { notices } = useSyncExternalStore(
    (onChange) => courier.subscribe(onChange),
    () => courier.state,
  );
  // Good news fades; a gift that's waiting stays until it lands.
  useEffect(() => {
    const fading = notices.filter((n) => n.kind !== "waiting");
    if (fading.length === 0) return;
    const timer = setTimeout(() => fading.forEach((n) => courier.dismiss(n.id)), 8000);
    return () => clearTimeout(timer);
  }, [notices, courier]);
  if (notices.length === 0) return null;
  return (
    <ul className="gift-notices" aria-live="polite">
      {notices.map((n) => (
        <li key={n.id} data-kind={n.kind}>
          {text(rom, n)}
          <button type="button" aria-label="Dismiss" onClick={() => courier.dismiss(n.id)}>×</button>
        </li>
      ))}
    </ul>
  );
}

function text(rom: Uint8Array, n: GiftNotice): string {
  const what = describeGift(rom, n.gift);
  switch (n.kind) {
    case "received":
      return `${n.from.name} sent you ${what}${n.where === "box" ? ", in your box" : ""}.`;
    case "waiting":
      return `${n.from.name} sent you ${what}. ${WAITING[n.reason] ?? "It'll arrive when you're free to move."}`;
    case "refused":
      return `${n.from.name} sent ${what}, but it can't be accepted (${n.reason}).`;
    case "sent":
      return `${what} is on its way to ${n.toName}.`;
  }
}
