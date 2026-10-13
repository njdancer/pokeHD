// The game's questions as bottom sheets (the handoff's "sheets, not the dex"): the bag or the team
// in battle, who's next after a faint, the Poké Mart, Bill's PC, how many, yes or no. The game
// waits at the routine that would have drawn its own menu (GameAsks) until the sheet answers;
// a cancel answers as B would.
import { useEffect, useState } from "react";
import type { AskAnswer, GameAsk, GameSnapshot } from "@pokehd/emu";
import { isKeyItem, monName, type WorldData } from "@pokehd/rom";
import type { Catalogue } from "../dex/catalogue.ts";
import { niceName } from "../dex/catalogue.ts";
import { Menu, type MenuContext } from "./context.ts";
import { useFreshTapGuard } from "./fresh-tap.ts";
import { itemPrice, money, niceItem, shelf } from "./items.ts";
import { BallPic, MonPic, ShelfIcon, TeamRowBody } from "./parts.tsx";

export interface AskSheetProps {
  rom: Uint8Array;
  world: WorldData;
  catalogue: Catalogue;
  ask: GameAsk;
  /** The game as it was when it asked (the team's HP for the party sheet). */
  game: GameSnapshot | null;
  answer(answer: AskAnswer): void;
}

const TITLES: Record<"switch" | "item" | "next" | "other", string> = {
  switch: "Switch to who?",
  item: "Use it on who?",
  next: "Who's next?",
  other: "Choose a Pokémon",
};

export function AskSheet({ rom, world, catalogue, ask, game, answer }: AskSheetProps) {
  const cancellable = !(ask.kind === "party" && ask.purpose === "next");
  const cancel = () => cancellable && answer(ask.kind === "yes-no" ? { yes: false } : null);
  // The tap on A that made the game ask doesn't answer (or cancel) it as the finger lifts.
  const guard = useFreshTapGuard();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && cancel();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });
  // The shared pieces (pictures, rows) read the menu's context; only what they use is filled.
  const ctx = { rom, world, catalogue, game } as MenuContext;
  return (
    <Menu.Provider value={ctx}>
      <div className="dm-sheet-shade" {...guard} onClick={(e) => e.target === e.currentTarget && cancel()}>
        <section className="dm-sheet" role="dialog" aria-modal aria-label={titleOf(ask)}>
          {cancellable && ask.kind !== "yes-no" && (
            <button type="button" className="dm-sheet-close" aria-label="Cancel" onClick={cancel}>
              ✕
            </button>
          )}
          <header>
            {/* A yes or no is headed by the game's own question. */}
            <h2 className={ask.kind === "yes-no" ? "dm-question" : undefined}>{titleOf(ask)}</h2>
            {(ask.kind === "items" || ask.kind === "mart") && game && <span className="dm-pill">{money(game.money)}</span>}
          </header>
          <Body rom={rom} ask={ask} game={game} answer={answer} />
        </section>
      </div>
    </Menu.Provider>
  );
}

function titleOf(ask: GameAsk): string {
  switch (ask.kind) {
    case "party":
      return TITLES[ask.purpose];
    case "items":
      return ask.list === "pc-items" ? "Your PC" : ask.selling ? "Sell what?" : "Bag";
    case "mart":
      return "Buy something";
    case "mons":
      return ask.list === "team" ? "Your team" : "Bill's PC";
    case "quantity":
      return "How many?";
    case "yes-no":
      return ask.text.replace(/\n/g, " ") || "Your choice";
  }
}

function Body({ rom, ask, game, answer }: { rom: Uint8Array; ask: GameAsk; game: GameSnapshot | null; answer(a: AskAnswer): void }) {
  switch (ask.kind) {
    case "party": {
      const team = game?.team ?? [];
      return (
        <div className="dm-list">
          {ask.inBattle && ask.purpose === "item" && <div className="dm-banner">Using an item uses your turn</div>}
          {team.map((mon, index) => {
            // Fainted Pokémon can't come out; the game would say so, so the sheet doesn't offer them.
            const out = (ask.purpose === "switch" || ask.purpose === "next") && mon.hp === 0;
            return (
              <button key={index} type="button" className="dm-c dm-row" disabled={out} onClick={() => answer({ index })}>
                <BallPic species={mon.species} />
                <TeamRowBody mon={mon} lead={index === 0} />
              </button>
            );
          })}
        </div>
      );
    }
    case "items":
      return (
        <div className="dm-list">
          {ask.inBattle && <div className="dm-banner">Using an item uses your turn</div>}
          {/* The same list serves the PC's deposit, withdraw and toss: the game's question says which. */}
          {!ask.inBattle && !ask.selling && ask.text && <div className="dm-banner">{ask.text.replace(/\n/g, " ")}</div>}
          {ask.entries.map((e, index) => (
            <button key={index} type="button" className="dm-c dm-row" onClick={() => answer({ index })} disabled={ask.selling && (isKeyItem(rom, e.item) || itemPrice(rom, e.item) === 0)}>
              <ShelfIcon shelf={shelf(rom, e.item)} />
              <span className="grow">
                <span>{niceName(niceItem(rom, e.item))}</span>
                <span className="sub">{ask.selling ? `Sells for ${money(Math.floor(itemPrice(rom, e.item) / 2))}` : shelf(rom, e.item)}</span>
              </span>
              {!isKeyItem(rom, e.item) && <span className="right">×{e.quantity}</span>}
              <span className="chev">›</span>
            </button>
          ))}
          {ask.entries.length === 0 && <p className="dm-empty">Nothing here.</p>}
        </div>
      );
    case "mart":
      return (
        <div className="dm-list">
          {ask.entries.map((item, index) => {
            const price = itemPrice(rom, item);
            return (
              <button key={index} type="button" className="dm-c dm-row" onClick={() => answer({ index })} disabled={!!game && game.money < price}>
                <ShelfIcon shelf={shelf(rom, item)} />
                <span className="grow">
                  <span>{niceName(niceItem(rom, item))}</span>
                  <span className="sub">{shelf(rom, item)}</span>
                </span>
                <span className="right">{money(price)}</span>
              </button>
            );
          })}
        </div>
      );
    case "mons":
      return (
        <div className="dm-list">
          {ask.species.map((species, index) => {
            const mon = ask.list === "team" ? game?.team[index] : game?.box[index];
            return (
              <button key={index} type="button" className="dm-c dm-row" onClick={() => answer({ index })}>
                <MonPic species={species} />
                <span className="grow">
                  <span>{niceName(mon?.nick ?? monName(rom, species))}</span>
                  {mon && <span className="sub">Lv {mon.level}</span>}
                </span>
              </button>
            );
          })}
        </div>
      );
    case "quantity":
      return <Quantity max={ask.max} price={ask.price} answer={answer} />;
    case "yes-no":
      return (
        <div className="dm-two">
          {/* The game's own words for its options: YES/NO, HEAL/CANCEL, TRADE/CANCEL… */}
          <button type="button" className="dm-verb alt" onClick={() => answer({ yes: false })}>
            {niceName(ask.no) || "No"}
          </button>
          <button type="button" className="dm-verb" onClick={() => answer({ yes: true })}>
            {niceName(ask.yes) || "Yes"}
          </button>
        </div>
      );
  }
}

function Quantity({ max, price, answer }: { max: number; price: number; answer(a: AskAnswer): void }) {
  const [n, setN] = useState(1);
  return (
    <>
      <div className="dm-qty">
        <button type="button" aria-label="Fewer" disabled={n <= 1} onClick={() => setN(n - 1)}>
          −
        </button>
        <output>{n}</output>
        <button type="button" aria-label="More" disabled={n >= max} onClick={() => setN(n + 1)}>
          +
        </button>
      </div>
      {price > 0 && <div className="dm-qty-total">{money(price * n)}</div>}
      <div className="dm-two">
        <button type="button" className="dm-verb alt" onClick={() => answer(null)}>
          Cancel
        </button>
        <button type="button" className="dm-verb" onClick={() => answer({ quantity: n })}>
          OK
        </button>
      </div>
    </>
  );
}
