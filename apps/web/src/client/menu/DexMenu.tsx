// The Pokédex menu (p2-menu): one menu around the Pokédex, replacing Start and Select. Five tabs
// (Pokémon, People, Inventory, Map, Me), each keeping its own place; and the game's requests
// (battle Team and Bag, who's next, PC, Mart) as a sheet over the game instead. Storybook look.
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Env, useEnv, type MenuEnv } from "./env.tsx";
import { CloseIcon, TabIcon, type TabId } from "./icons.tsx";
import { NavContext, rootOf, TABS, type Nav, type Screen } from "./nav.tsx";
import type { Request } from "./model.ts";
import { EntryScreen, PokemonScreen } from "./screens/Pokemon.tsx";
import { FriendScreen, PeopleScreen, PersonScreen } from "./screens/People.tsx";
import { BagPick, BoxPick, InventoryScreen, ItemScreen, MonScreen, ShopPick, TeamPick } from "./screens/Inventory.tsx";
import { MapScreen } from "./screens/MapScreen.tsx";
import { GrownupsScreen, MeScreen, SavesScreen, SettingsScreen } from "./screens/Me.tsx";
import "./menu.css";

function render(s: Screen): ReactNode {
  switch (s.k) {
    case "dex": return <PokemonScreen />;
    case "entry": return <EntryScreen dex={s.dex} />;
    case "people": return <PeopleScreen />;
    case "person": return <PersonScreen id={s.key} />;
    case "friend": return <FriendScreen id={s.id} />;
    case "inv": return <InventoryScreen />;
    case "mon": return <MonScreen i={s.i} purpose={s.for} />;
    case "item": return <ItemScreen id={s.id} purpose={s.for} />;
    case "team": return <TeamPick purpose={s.for} />;
    case "bag": return <BagPick purpose={s.for} />;
    case "map": return <MapScreen key={s.focus} focus={s.focus} />;
    case "me": return <MeScreen />;
    case "settings": return <SettingsScreen />;
    case "grownups": return <GrownupsScreen />;
    case "saves": return <SavesScreen />;
  }
}

/** How the last change moved: deeper, back out, or across tabs. Picks the animation. */
type Motion = "push" | "pop" | "tab" | "none";

function useStack(initial: Screen[]) {
  const [state, setState] = useState({ stack: initial, motion: "none" as Motion });
  const set = useCallback((next: (s: Screen[]) => Screen[], motion: Motion) => setState((st) => ({ stack: next(st.stack), motion })), []);
  return { stack: state.stack, motion: state.motion, set };
}

export interface DexMenuProps {
  env: Omit<MenuEnv, "toast">;
  open: boolean;
  onClose(): void;
  /** Where to open (a tab, or a screen in it). */
  start?: { tab: TabId; screen?: Screen };
  /** A game request: shown as a sheet instead of the dex. */
  request?: Request | null;
  /** Called when the request ends (answered or cancelled). */
  onRequestDone?(): void;
}

export function DexMenu({ env: base, open, onClose, start, request, onRequestDone }: DexMenuProps) {
  const [toastText, setToastText] = useState<{ text: string; n: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toast = useCallback((text: string) => {
    clearTimeout(toastTimer.current);
    setToastText((t) => ({ text, n: (t?.n ?? 0) + 1 }));
    toastTimer.current = setTimeout(() => setToastText(null), 2600);
  }, []);
  const env = useMemo<MenuEnv>(() => ({ ...base, toast }), [base, toast]);
  return (
    <Env.Provider value={env}>
      <div className={`m-root${open ? " open" : ""}${request ? " asked" : ""}`}>
        <div className="m-shade" onClick={request ? undefined : onClose} />
        <Dex open={open} onClose={onClose} start={start} />
        {request && <Sheet key={request.kind} request={request} onDone={() => onRequestDone?.()} />}
        {toastText && (
          <div className="m-toast" key={toastText.n} role="status">
            {toastText.text}
          </div>
        )}
      </div>
    </Env.Provider>
  );
}

function Dex({ open, onClose, start }: { open: boolean; onClose(): void; start?: DexMenuProps["start"] }) {
  const [{ tab, stacks, motion }, setState] = useState(() => {
    const s = Object.fromEntries(TABS.map((t) => [t.id, [rootOf(t.id)]])) as Record<TabId, Screen[]>;
    if (start?.screen) s[start.tab] = [rootOf(start.tab), start.screen];
    return { tab: start?.tab ?? ("dex" as TabId), stacks: s, motion: "none" as Motion };
  });
  const stack = stacks[tab];
  const env = useEnv();
  const update = (t: TabId, next: Screen[], how: Motion) => setState((st) => ({ tab: t, stacks: { ...st.stacks, [t]: next }, motion: how }));
  const nav: Nav = {
    depth: stack.length,
    sheet: false,
    go: (s) => update(tab, [...stack, s], "push"),
    back: () => {
      if (stack.length > 1) update(tab, stack.slice(0, -1), "pop");
    },
    replace: (s) => update(tab, [...stack.slice(0, -1), s], "none"),
    reset: (s) => update(tab, s ? [rootOf(tab), s] : [rootOf(tab)], "pop"),
    tab: (t, s) => setState((st) => ({ tab: t, stacks: s ? { ...st.stacks, [t]: s.k === t ? [s] : [rootOf(t), s] } : st.stacks, motion: "tab" })),
    close: onClose,
  };
  const top = stack[stack.length - 1]!;
  const gifts = env.model.friends.filter((f) => f.gift).length;
  return (
    <div className="m-dex" role="dialog" aria-label="Pokédex" aria-hidden={!open} inert={!open}>
      <Corners />
      <button type="button" className="m-round m-close" aria-label="Close the Pokédex" onClick={onClose}>
        <CloseIcon />
      </button>
      <NavContext.Provider value={nav}>
        <div className={`m-screen m-${motion}`} key={`${tab} ${stack.length} ${top.k}`}>
          {render(top)}
        </div>
      </NavContext.Provider>
      <nav className="m-tabbar" aria-label="Pokédex">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={t.id === tab ? "page" : undefined}
            onClick={() => {
              // Tapping the tab you're on goes back to its start, as phones do.
              if (t.id === tab) update(t.id, [rootOf(t.id)], "pop");
              else nav.tab(t.id);
            }}
          >
            <span className="m-tabicon">
              <TabIcon tab={t.id} on={t.id === tab} />
              {t.id === "people" && gifts > 0 && <i className="m-dot">{gifts}</i>}
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function Corners() {
  return (
    <>
      {(["tl", "tr", "bl", "br"] as const).map((c) => (
        <span key={c} className={`m-corner ${c}`} aria-hidden="true" />
      ))}
    </>
  );
}

/** A game request answered over the game: the same lists as the dex, filtered to what it asks. */
function Sheet({ request, onDone }: { request: Request; onDone(): void }) {
  const env = useEnv();
  // The bottom of the stack stands for the list the game asked for (`root` below).
  const { stack, set, motion } = useStack([{ k: "inv" }]);
  const mustAnswer = request.kind === "fainted";
  const close = () => {
    if (!mustAnswer) env.actions.cancel();
    onDone();
  };
  const nav: Nav = {
    depth: stack.length,
    sheet: true,
    go: (s) => set((st) => [...st, s], "push"),
    back: () => set((st) => (st.length > 1 ? st.slice(0, -1) : st), "pop"),
    replace: (s) => set((st) => [...st.slice(0, -1), s], "none"),
    reset: () => set((st) => st.slice(0, 1), "pop"),
    tab: () => {},
    close: onDone,
  };
  const top = stack[stack.length - 1];
  // The sheet's root is the list the game asked for; deeper screens are the dex's own.
  const root =
    request.kind === "battle-team" ? <TeamPick title="Your team" />
    : request.kind === "fainted" ? <TeamPick title="Who's next?" />
    : request.kind === "deposit" ? <TeamPick title="Bill's PC" />
    : request.kind === "withdraw" ? <BoxPick />
    : request.kind === "buy" ? <ShopPick stock={request.stock} />
    : <BagPick />;
  return (
    <div className="m-sheet" role="dialog" aria-label="The game asks">
      <span className="m-grabber" aria-hidden="true" />
      {!mustAnswer && (
        <button type="button" className="m-round m-close" aria-label="Back to the game" onClick={close}>
          <CloseIcon />
        </button>
      )}
      <NavContext.Provider value={nav}>
        <div className={`m-screen m-${motion}`} key={stack.length}>
          {stack.length <= 1 ? root : render(top!)}
        </div>
      </NavContext.Provider>
    </div>
  );
}
