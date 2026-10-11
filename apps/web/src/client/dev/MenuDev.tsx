// Hi-fi design of the Pokédex menu (p2-menu) at /dev/menu, standalone until Nick picks it: the
// real menu components over the live HD world, in an iPhone 13 Pro sized frame (full screen on a
// phone). A sample adventure stands in for the game; "Under the hood" logs the game routine each
// tap would call. URL options for screenshots: ?open=1, ?tab=map, ?moment=wild, ?world=0,
// ?turn=1 (the phone on its side), ?rail=1 (start with the slim sidebar), ?r=4 (screen radius). The menu draws into a
// stand-in for the open dex's screen, so its layout follows the screen's shape: tabs below in
// portrait, a sidebar in landscape.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createEngine, DEFAULT_CYCLE, type Engine } from "@pokehd/engine";
import { createLiveWorld, standingState, type LiveWorld } from "@pokehd/engine/world";
import { MAP_NAMES, parseWorld, trainerClasses, type TrainerClass, type WorldData } from "@pokehd/rom";
import { fetchDevRom } from "../dev-rom.ts";
import { loadStoredRom } from "../rom-store.ts";
import { buildCatalogue, type Catalogue } from "../dex/catalogue.ts";
import { DexMenu } from "../menu/DexMenu.tsx";
import type { TabId } from "../menu/icons.tsx";
import { inBattle, type MenuActions, type MenuModel, type Moment, type Request } from "../menu/model.ts";
import { SAMPLE_STOCK, sampleModel } from "../menu/sample.ts";
import "../game/text-overlay.css";
import "./menu-dev.css";

const query = new URLSearchParams(location.search);

const MOMENTS: [Moment, string, string][] = [
  ["explore", "Exploring", "Walking around Vermilion City. Everything works; the game waits while the dex is open."],
  ["talk", "Talking", "A message is on screen. Look at anything; actions wait for the message to end."],
  ["wild", "Wild battle", "Your turn against a wild Pokémon. Team and Bag on the battle screen open sheets; the dex is for looking."],
  ["trainer", "Trainer battle", "As wild, but you can't run and the trainer blocks Poké Balls."],
  ["fainted", "Fainted", "Your Pokémon fainted. The game asks who's next, so the Team sheet opens by itself and must be answered."],
  ["pc", "At the PC", "Bill's PC. Deposit and Withdraw open a sheet over the game, not the dex."],
  ["shop", "At the Mart", "The Poké Mart. Buy and Sell open a sheet; Sell shows your Bag with one action."],
];

const initialMoment = (query.get("moment") as Moment | null) ?? "explore";

/** The sample as it stands at a moment: a foe in battle, the leader down when fainted. */
function withMoment(md: MenuModel, m: Moment): MenuModel {
  const team = md.team.map((x, i) => ({ ...x, hp: m === "fainted" && i === 0 ? 0 : x.hp || 1 }));
  const enemy = m === "wild" ? { dex: 96, name: "DROWZEE", level: 11 } : m === "trainer" || m === "fainted" ? { dex: 10, name: "CATERPIE", level: 10, trainer: "BUG CATCHER" } : undefined;
  return { ...md, team, enemy };
}

interface Log {
  title: string;
  code: string;
}

function move<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x!);
  return out;
}

interface Data {
  rom: Uint8Array;
  world: WorldData;
  catalogue: Catalogue;
  trainers: TrainerClass[];
}

export function MenuDev() {
  const [data, setData] = useState<Data | null>(null);
  const [status, setStatus] = useState("Loading the cartridge…");
  const [moment, setMomentState] = useState<Moment>(initialMoment);
  const [open, setOpen] = useState(query.get("open") === "1");
  const [request, setRequest] = useState<Request | null>(null);
  const [model, setModel] = useState<MenuModel | null>(null);
  const [log, setLog] = useState<Log[]>([]);
  const [pending, setPending] = useState<{ label: string; run(): void } | null>(null);
  const [panel, setPanel] = useState(false);
  const [turned, setTurned] = useState(query.get("turn") === "1");
  const rail = query.get("rail") === "1";
  const [screenEl, setScreenEl] = useState<HTMLDivElement | null>(null);
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const rom = (await fetchDevRom()) ?? (await loadStoredRom());
      if (!rom) return setStatus("No ROM: load one in the app first.");
      const world = parseWorld(rom);
      const trainers = trainerClasses(rom);
      setData({ rom, world, catalogue: buildCatalogue(rom, world), trainers });
      setModel(withMoment(sampleModel(trainers), initialMoment));
      if (initialMoment === "fainted") setRequest({ kind: "fainted" });
      setStatus("");
    })().catch((e: unknown) => setStatus(String(e)));
  }, []);

  // The live HD world behind the menu, standing in Vermilion City.
  useEffect(() => {
    if (!data || query.get("world") === "0") return;
    let disposed = false;
    let engine: Engine | null = null;
    let live: LiveWorld | null = null;
    const canvas = document.createElement("canvas");
    canvas.className = "md-scene";
    holder.current!.prepend(canvas);
    (async () => {
      live = createLiveWorld(data.world);
      engine = await createEngine(canvas, { world: live });
      if (disposed) return engine.dispose();
      live.setLook(engine.look);
      Object.assign(engine.look.params.time, { phase: 0.4, drift: false });
      engine.look.setCycle(DEFAULT_CYCLE);
      const state = standingState(data.world, MAP_NAMES.indexOf("VERMILION_CITY"));
      const l = live;
      const tick = () => {
        if (disposed) return;
        l.push(state, performance.now() / 1000);
        requestAnimationFrame(tick);
      };
      tick();
    })().catch(() => {});
    return () => {
      disposed = true;
      engine?.dispose();
      live?.dispose();
      canvas.remove();
    };
  }, [data]);

  const say = useCallback((title: string, code: string) => setLog((l) => [{ title, code }, ...l].slice(0, 40)), []);

  const setMoment = useCallback(
    (m: Moment) => {
      setMomentState(m);
      setRequest(m === "fainted" ? { kind: "fainted" } : null);
      setOpen(false);
      setPending(null);
      setModel((md) => md && withMoment(md, m));
      if (m === "fainted") say("Your Pokémon fainted", "ChooseNextMon calls DisplayPartyMenu. Our hook shows the Team sheet instead of drawing the party menu, and returns wWhichPokemon.");
    },
    [say],
  );

  const actions = useMemo<MenuActions | null>(() => {
    if (!model) return null;
    const upd = (f: (m: MenuModel) => MenuModel) => setModel((m) => (m ? f(m) : m));
    const name = (i: number) => model.team[i]!.name;
    /** While a message is up, actions wait for it to end (queued, cancellable). */
    const queue = (label: string, code: string, run: () => void): string | null => {
      if (moment !== "talk") return null;
      setPending({ label, run });
      say(`Queued: ${label}`, `Waits for the next overworld safe point (the message ends and JoypadOverworld runs), then: ${code}`);
      return "It'll happen when the message ends";
    };
    const take = (m: MenuModel, id: number, n = 1) => ({ ...m, bag: m.bag.map((b) => (b.id === id && b.count !== undefined ? { ...b, count: b.count - n } : b)).filter((b) => b.count === undefined || b.count > 0) });
    return {
      useItem(item, mon) {
        const it = model.bag.find((b) => b.id === item)!;
        const run = () =>
          upd((m) => {
            let next = m;
            if (it.kind === "Healing" && mon !== undefined) next = { ...m, team: m.team.map((x, i) => (i === mon ? { ...x, hp: item === 0x0b ? x.hp : Math.min(x.maxHp, x.hp + (item === 0x13 ? 50 : 20)), status: item === 0x0b ? undefined : x.status } : x)) };
            if (item === 0x1e) next = { ...next, repel: 100 };
            if (item === 6) return { ...next, biking: !next.biking };
            return take(next, item);
          });
        const code = mon !== undefined ? `wCurItem ← ${it.name}; call UseItem. ${it.kind === "Healing" ? "ItemUseMedicine" : "The item's routine"} asks for a Pokémon through DisplayPartyMenu; our hook answers wWhichPokemon ← ${mon}.` : `wCurItem ← ${it.name}; call UseItem (${item === 0x1e ? "ItemUseRepel sets wRepelRemainingSteps ← 100" : item === 6 ? "ItemUseBicycle, which refuses indoors as the game does" : "its routine"}).`;
        const q = queue(`${it.name}${mon !== undefined ? ` on ${name(mon)}` : ""}`, code, run);
        if (q) return q;
        run();
        say(`Use ${it.name}${mon !== undefined ? ` on ${name(mon)}` : ""}`, inBattle(moment) ? `DisplayBattleMenu hook returns ITEM; DisplayListMenuID hook returns ${it.name}. ${code} The turn is used.` : `At the overworld safe point: ${code}`);
        if (mon !== undefined) return item === 0x0b ? `${name(mon)} is cured` : `${name(mon)} got some HP back`;
        return item === 0x1e ? "Wild Pokémon stay away for 100 steps" : item === 6 ? (model.biking ? "Walking" : "Riding the bike!") : "Used it";
      },
      makeLeader(i) {
        const run = () => upd((m) => ({ ...m, team: move(m.team, i, 0) }));
        const q = queue(`Make ${name(i)} leader`, "SwitchPartyMon", run);
        if (q) return q;
        run();
        say(`Make ${name(i)} the leader`, `SwitchPartyMon with wWhichPokemon ← ${i}, wMenuItemToSwap ← 0: the game's own swap, no party menu drawn.`);
        return `${name(i)} leads now`;
      },
      moveMon(from, to) {
        upd((m) => ({ ...m, team: move(m.team, from, to) }));
        say(`Team: ${name(from)} to place ${to + 1}`, `SwitchPartyMon (wWhichPokemon ← ${from}, wMenuItemToSwap ← ${to}), repeated if it moves more than one place.`);
      },
      moveMove(mon, from, to) {
        upd((m) => ({ ...m, team: m.team.map((x, i) => (i === mon ? { ...x, moves: move(x.moves, from, to) } : x)) }));
        say(`${name(mon)}'s moves`, inBattle(moment) ? "SwapMovesInMenu (the routine Select used to reach)." : "Outside battle the game has no routine for this: swap the move and its PP in wPartyMon at a safe point (what SwapMovesInMenu does in battle).");
      },
      moveItem(from, to) {
        upd((m) => ({ ...m, bag: move(m.bag, from, to) }));
        say("Bag order", "The swap HandleItemListSwapping does on wBagItems, called directly.");
      },
      sendOut(i) {
        upd((m) => ({ ...m, team: move(m.team, i, 0) }));
        setRequest(null);
        if (moment === "fainted") {
          setMomentState("trainer");
          say(`Send out ${name(i)}`, `ChooseNextMon: our DisplayPartyMenu hook returns wWhichPokemon ← ${i}. No turn is used.`);
        } else say(`Send out ${name(i)}`, `DisplayBattleMenu hook returns PKMN; DisplayPartyMenu hook returns wWhichPokemon ← ${i}. SwitchPlayerMon runs; the enemy takes its turn.`);
        return `Go! ${name(i)}!`;
      },
      throwBall(item) {
        upd((m) => take(m, item));
        setRequest(null);
        say("Throw a POKé BALL", moment === "trainer" ? "UseItem → ItemUseBall refuses in a trainer battle and prints its own message. The turn is used, as on the cartridge." : "DisplayBattleMenu hook returns ITEM; DisplayListMenuID hook returns POKé BALL. ItemUseBall rolls the catch with the game's own RNG.");
        return moment === "trainer" ? "The trainer blocked the BALL!" : "Shoot! It was so close too!";
      },
      teach(_item, mon) {
        upd((m) => ({ ...m, team: m.team.map((x, i) => (i === mon ? { ...x, moves: [...x.moves.slice(0, 3), { name: "CUT", type: "NORMAL", pp: 30, maxPp: 30 }] } : x)) }));
        say(`Teach CUT to ${name(mon)}`, `wCurItem ← HM01; call UseItem → ItemUseTMHM. Our DisplayPartyMenu hook answers wWhichPokemon ← ${mon}; LearnMove asks which move to forget through the same kind of hook.`);
        return `${name(mon)} learned CUT!`;
      },
      deposit(i) {
        upd((m) => ({ ...m, team: m.team.filter((_, j) => j !== i), box: [m.team[i]!, ...m.box] }));
        setRequest(null);
        say(`Deposit ${name(i)}`, `BillsPCDeposit → DisplayMonListMenu → DisplayListMenuID: our hook returns wWhichPokemon ← ${i}. The game moves it to the box.`);
        return `${name(i)} is in the PC now`;
      },
      withdraw(b) {
        const mon = model.box[b]!;
        upd((m) => ({ ...m, box: m.box.filter((_, j) => j !== b), team: [...m.team, mon] }));
        setRequest(null);
        say(`Withdraw ${mon.name}`, `BillsPCWithdraw → DisplayMonListMenu: our hook returns box index ${b}.`);
        return `${mon.name} joined your team`;
      },
      buy(item, n) {
        const s = SAMPLE_STOCK.find((x) => x.id === item)!;
        upd((m) => {
          const has = m.bag.some((b) => b.id === item);
          const bag = has ? m.bag.map((b) => (b.id === item ? { ...b, count: (b.count ?? 0) + n } : b)) : [...m.bag, { id: item, name: s.name, kind: s.kind, count: n, sell: s.price / 2, text: "" }];
          return { ...m, bag, trainer: { ...m.trainer, money: m.trainer.money - s.price * n } };
        });
        say(`Buy ${s.name}`, `Mart buy list: DisplayListMenuID hook returns ${s.name}; DisplayChooseQuantityMenu hook returns ${n}. The game takes ₽${s.price * n}.`);
        return `Bought a ${s.name}`;
      },
      sell(item, n) {
        const it = model.bag.find((b) => b.id === item)!;
        upd((m) => ({ ...take(m, item, n), trainer: { ...m.trainer, money: m.trainer.money + (it.sell ?? 0) * n } }));
        say(`Sell ${n} × ${it.name}`, `Mart sell: DisplayListMenuID hook returns ${it.name}; DisplayChooseQuantityMenu hook returns ${n}. The game pays ₽${(it.sell ?? 0) * n}.`);
        return `Sold for ₽${(it.sell ?? 0) * n}`;
      },
      gift(friend, what) {
        const f = model.friends.find((x) => x.id === friend)!;
        if ("item" in what) {
          const it = model.bag.find((b) => b.id === what.item)!;
          upd((m) => take(m, what.item));
          say(`Send ${it.name} to ${f.name}`, "RemoveItemFromInventory at a safe point; their mailbox patch hands it over at their next overworld safe point (p3-gifts).");
          return `${it.name} is on its way to ${f.name}`;
        }
        upd((m) => ({ ...m, team: m.team.filter((_, j) => j !== what.mon) }));
        say(`Send ${name(what.mon)} to ${f.name}`, "The party slot is removed by the game's own routine at a safe point and delivered through their mailbox (p3-gifts).");
        return `${name(what.mon)} is on its way to ${f.name}`;
      },
      ask(friend, what) {
        const f = model.friends.find((x) => x.id === friend)!;
        say(`Ask ${f.name} to ${what}`, "A room message to the friend; when you both talk to the Cable Club attendant, the link cable runs over the network (p3-link).");
        return `Asked ${f.name}. Meet upstairs in any Pokémon Center!`;
      },
      save() {
        upd((m) => ({ ...m, savedAgo: "just now" }));
        say("Save now", "Overworld safe point: the game's own save path (SaveGameData writes SRAM as the cartridge does), then a checkpoint.");
        return "Saved!";
      },
      setOption(key, value) {
        upd((m) => ({ ...m, options: { ...m.options, [key]: value } }));
        say(`Game option: ${key} → ${String(value)}`, "wOptions ← the new bits (what the OPTION screen writes), read by the game wherever it already does.");
      },
      setApp(key, value) {
        upd((m) => ({ ...m, app: { ...m.app, [key]: value } }));
      },
      goBack(i) {
        say(`Go back to ${model.checkpoints[i]!.place}`, "Our checkpoint (a save state) loads; the moment you leave is kept as a checkpoint first, so nothing is lost.");
        return `Back at ${model.checkpoints[i]!.place}`;
      },
      cancel() {
        say("Back to the game", "The sheet answers the game's menu routine with Cancel, as its own menu would.");
        setRequest(null);
      },
    };
  }, [model, moment, say]);

  const endTalk = () => {
    setMomentState("explore");
    if (pending) {
      pending.run();
      say(`Ran: ${pending.label}`, "The message ended; at the next overworld safe point the queued routine ran.");
    }
    setPending(null);
  };

  const ask = (r: Request, title: string, code: string) => {
    setOpen(false);
    setRequest(r);
    say(title, code);
  };

  const env = useMemo(() => (data && model && actions ? { ...data, model, moment, actions } : null), [data, model, moment, actions]);
  const tab = (query.get("tab") as TabId | null) ?? undefined;
  const info = MOMENTS.find((m) => m[0] === moment)!;

  return (
    <div className="md-page">
      <div className="md-phone-col">
        <div className={`md-phone${turned ? " turned" : ""}`} ref={holder}>
          {!env && <div className="md-status">{status}</div>}
          {env && (
            <>
              <div className="md-place">Vermilion City</div>
              <GameMock moment={moment} model={env.model} onAsk={ask} onEndTalk={endTalk} pending={pending?.label ?? null} onCancelPending={() => setPending(null)} />
              <button type="button" className={`md-dexbtn${env.model.friends.some((f) => f.gift) ? " alert" : ""}`} aria-label="Open the Pokédex" onClick={() => setOpen(true)} />
              {/* A stand-in for the open dex (its own threads own the real one and its motion). */}
              <div className={`md-opendex${open ? " open" : ""}`} aria-hidden="true">
                <div className="md-opendex-screen" ref={setScreenEl} style={query.get("r") ? ({ "--m-screen-r": `${query.get("r")}px` } as CSSProperties) : undefined} />
                <i className="md-opendex-lights" />
                <i className="md-opendex-pad" />
              </div>
              {screenEl && <DexMenu env={env} open={open} onClose={() => setOpen(false)} start={tab ? { tab } : undefined} request={request} onRequestDone={() => setRequest(null)} screen={screenEl} {...(rail ? { side: "rail" as const } : {})} />}
            </>
          )}
        </div>
        <button type="button" className="md-paneltoggle" onClick={() => setPanel(!panel)} aria-expanded={panel}>
          {panel ? "Hide notes" : "Moments & notes"}
        </button>
      </div>
      <aside className={`md-panel${panel ? " shown" : ""}`}>
        <p className="md-kicker">Hi-fi design · Pokédex menu</p>
        <h1>One menu around the Pokédex</h1>
        <p className="md-lede">
          The real components in the Storybook look, over the live HD world. Tap the red Pokédex. Pictures and Pokédex words come from your ROM; caught Pokémon also show PokeAPI's artwork, live. The adventure itself is a sample.
        </p>
        <section>
          <h2>Hold the phone</h2>
          <div className="md-chips">
            <button type="button" aria-pressed={!turned} onClick={() => setTurned(false)}>Upright</button>
            <button type="button" aria-pressed={turned} onClick={() => setTurned(true)}>On its side</button>
          </div>
          <p className="md-hint">The menu fills the dex's screen and picks its layout from the screen's shape. On a real phone, just turn it. On its side, drag the grip on the sidebar's edge (or tap it) to slim it to icons.</p>
        </section>
        <section>
          <h2>The game's moment</h2>
          <div className="md-chips">
            {MOMENTS.map(([m, label]) => (
              <button key={m} type="button" aria-pressed={m === moment} onClick={() => setMoment(m)}>
                {label}
              </button>
            ))}
          </div>
          <p className="md-hint">{info[2]}</p>
        </section>
        <section>
          <h2>Under the hood</h2>
          <p className="md-hint">What each tap calls in the game's own code: our UI answers the game's menu routines and calls its routines at safe points. No button presses.</p>
          <ul className="md-log">
            {log.length === 0 && <li><b>Nothing yet</b>Tap something on the phone.</li>}
            {log.map((l, i) => (
              <li key={log.length - i}>
                <b>{l.title}</b>
                <code>{l.code}</code>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}

/** Stand-ins for the game's own screens (battle menu, message box) that open the request sheets. */
function GameMock({ moment, model, onAsk, onEndTalk, pending, onCancelPending }: {
  moment: Moment;
  model: MenuModel;
  onAsk(r: Request, title: string, code: string): void;
  onEndTalk(): void;
  pending: string | null;
  onCancelPending(): void;
}) {
  const box = (text: string, buttons: [string, () => void, boolean?][]) => (
    <div className="md-msg">
      <p>{text}</p>
      <div className="md-msg-btns">
        {buttons.map(([t, f, off]) => (
          <button key={t} type="button" onClick={f} disabled={off}>
            {t}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <>
      {pending && (
        <div className="md-pending">
          <span>⏳ {pending}: waits for the message</span>
          <button type="button" onClick={onCancelPending}>Cancel</button>
        </div>
      )}
      {moment === "talk" && box("SAILOR: The ship's leaving soon. Better hurry!", [["Next ▼", onEndTalk]])}
      {moment === "pc" &&
        box("BILL's PC. What do you want to do?", [
          ["Withdraw", () => onAsk({ kind: "withdraw" }, "PC: Withdraw", "BillsPCWithdraw asks through DisplayMonListMenu; the Box sheet answers.")],
          ["Deposit", () => onAsk({ kind: "deposit" }, "PC: Deposit", "BillsPCDeposit asks through DisplayMonListMenu; the Team sheet answers.")],
        ])}
      {moment === "shop" &&
        box("Hi there! May I help you?", [
          ["Buy", () => onAsk({ kind: "buy", stock: SAMPLE_STOCK }, "Mart: Buy", "The buy list (DisplayListMenuID) is answered by the Mart sheet.")],
          ["Sell", () => onAsk({ kind: "sell" }, "Mart: Sell", "The sell list (DisplayListMenuID) is answered by the Bag sheet.")],
        ])}
      {(moment === "wild" || moment === "trainer") && model.enemy && (
        <div className="md-battle">
          <div className="md-foe">
            {moment === "wild" ? "Wild" : "BUG CATCHER's"} {model.enemy.name} <small>Lv {model.enemy.level}</small>
          </div>
          <div className="md-bbar">
            <button type="button" disabled>FIGHT</button>
            <button type="button" onClick={() => onAsk({ kind: "battle-team" }, "Battle: Team", "DisplayBattleMenu hook: the player chose PKMN. The Team sheet stands in for DisplayPartyMenu.")}>Team</button>
            <button type="button" onClick={() => onAsk({ kind: "battle-bag" }, "Battle: Bag", "DisplayBattleMenu hook: the player chose ITEM. The Bag sheet stands in for DisplayListMenuID.")}>Bag</button>
            <button type="button" disabled={moment === "trainer"}>Run</button>
          </div>
        </div>
      )}
    </>
  );
}
