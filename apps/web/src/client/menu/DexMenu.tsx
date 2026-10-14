// The Pokédex menu (p2-menu): one menu around the Pokédex, replacing Start and Select. Five tabs
// (Pokémon, People, Inventory, Map, Me), each keeping its own place; and the game's requests
// (battle Team and Bag, who's next, PC, Mart) as a sheet over the game instead. Storybook look.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { Env, useEnv, type MenuEnv } from "./env.tsx";
import { CloseIcon, TabIcon, type TabId } from "./icons.tsx";
import { useFreshTapGuard } from "./fresh-tap.ts";
import { NavContext, rootOf, TABS, withoutPicks, type Nav, type Screen } from "./nav.tsx";
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
  /**
   * Where to open (a tab, or a screen in it). `backCloses`: backing out of that screen shuts the
   * menu rather than going to the tab's start (a Pokémon's page the game opened and waits on).
   */
  start?: { tab: TabId; screen?: Screen; backCloses?: boolean };
  /** A game request: shown as a sheet instead of the dex. */
  request?: Request | null;
  /** Called when the request ends (answered or cancelled). */
  onRequestDone?(): void;
  /** A line from the game after an action finished (toasted when `n` changes). */
  notice?: { text: string; n: number } | null;
  /**
   * The open Pokédex's screen to draw into. The menu fills it edge to edge and has no frame of
   * its own: the dex is the frame. Without one, the menu floats over the game in a plain panel.
   */
  screen?: HTMLElement | null;
  /** Forces a layout; by default the screen's shape picks it (wider than tall: the sidebar). */
  layout?: Layout;
  /** Landscape's sidebar to start with: words (default) or icons only. The player can drag it. */
  side?: Side;
  /**
   * A second copy to draw at the same time in the other layout, for crossfading while the dex
   * turns. It shows the same tab and page as the main one, and can't be tapped.
   */
  also?: { screen: HTMLElement; layout: Layout } | null;
}

/** Landscape's sidebar: icons and words, or a slim rail of icons. */
export type Side = "full" | "rail";

const SIDE_KEY = "pokehd.menu.sidebar";
function storedSide(): Side | null {
  try {
    const v = localStorage.getItem(SIDE_KEY);
    return v === "full" || v === "rail" ? v : null;
  } catch {
    return null;
  }
}

/** Portrait: tabs along the bottom. Landscape: a sidebar, and wide pages in two columns. */
export type Layout = "portrait" | "landscape";

export function DexMenu({ env: base, open, onClose, start, request, onRequestDone, notice, screen, layout, side, also }: DexMenuProps) {
  const [toastText, setToastText] = useState<{ text: string; n: number } | null>(null);
  const toast = useCallback((text: string) => {
    // Actions that finish later (in the game) return "", and their words follow as a notice.
    if (text) setToastText((t) => ({ text, n: (t?.n ?? 0) + 1 }));
  }, []);
  useEffect(() => {
    if (!toastText) return;
    const timer = setTimeout(() => setToastText(null), 2600);
    return () => clearTimeout(timer);
  }, [toastText]);
  // The game's words after an action, shown like any other line.
  const [shown, setShown] = useState(notice);
  if (notice !== shown) {
    setShown(notice);
    if (notice) setToastText((t) => ({ text: notice.text, n: (t?.n ?? 0) + 1 }));
  }
  const env = useMemo<MenuEnv>(() => ({ ...base, toast }), [base, toast]);
  // Where you are (tab, and the screens open in each), shared by every copy drawn.
  const place = useState(() => {
    const s = Object.fromEntries(TABS.map((t) => [t.id, [rootOf(t.id)]])) as Record<TabId, Screen[]>;
    if (start?.screen) s[start.tab] = [rootOf(start.tab), start.screen];
    const closesAt = start?.backCloses ? start.screen : undefined;
    return { tab: start?.tab ?? ("dex" as TabId), stacks: s, motion: "none" as Motion, ...(closesAt ? { closesAt } : {}) };
  });
  // Each tab keeps its place when the dex shuts, but not a one-off pick ("Teach it to which
  // Pokémon?", "Use it on…", a gift): it reopens on the screen the pick started from (QA bug 54).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) place[1]((st) => withoutPicks(st));
  }
  // The sidebar's width is the player's to choose, so it's remembered on this device.
  const [sideNow, setSideNow] = useState<Side>(() => storedSide() ?? side ?? "full");
  const [shownSide, setShownSide] = useState(side);
  if (side !== shownSide) {
    setShownSide(side);
    if (side) setSideNow(side);
  }
  const chooseSide = useCallback((s: Side) => {
    setSideNow(s);
    try {
      localStorage.setItem(SIDE_KEY, s);
    } catch {
      // Private browsing: it just isn't remembered.
    }
  }, []);
  const dex = { open, onClose, place, side: sideNow, setSide: chooseSide };
  return (
    <Env.Provider value={env}>
      <div className={`m-root${open ? " open" : ""}${request ? " asked" : ""}${screen ? " hosted" : ""}`}>
        <div className="m-shade" onClick={request ? undefined : onClose} />
        {screen ? createPortal(<Dex {...dex} layout={layout} />, screen) : <Dex {...dex} layout={layout} floating />}
        {also && createPortal(<Dex {...dex} layout={also.layout} copy />, also.screen)}
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

/** Wider than this (width ÷ height) is landscape; a little hysteresis stops it flickering mid-turn. */
const WIDE = 1.15;

/** The layout a box's shape asks for, watched as it changes (the dex turning with the phone). */
function useShape(forced?: Layout) {
  const ref = useRef<HTMLDivElement>(null);
  const [shape, setShape] = useState<Layout>("portrait");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || forced) return;
    const ro = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      setShape((was) => (width / height > (was === "landscape" ? WIDE - 0.1 : WIDE) ? "landscape" : "portrait"));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [forced]);
  return [ref, forced ?? shape] as const;
}

/**
 * The sidebar's grip: drag it to any width between the rail and full, and on letting go it
 * settles on whichever is nearer; a tap swaps them. The width follows the finger while dragging.
 */
function useSideGrip(dexRef: RefObject<HTMLDivElement | null>, side: Side, setSide: (s: Side) => void) {
  /** While dragging: the width, and the midpoint between rail and full. */
  const [now, setNow] = useState<{ width: number; mid: number } | null>(null);
  const drag = useRef<{ x: number; from: number; rail: number; full: number; moved: boolean } | null>(null);
  /** The two widths, read from the dex's own CSS so there's one source for them. */
  const widths = () => {
    const dex = dexRef.current!;
    const probe = (v: string) => {
      const el = document.createElement("div");
      el.style.cssText = `position:absolute;visibility:hidden;width:${v}`;
      dex.append(el);
      const w = el.getBoundingClientRect().width;
      el.remove();
      return w;
    };
    return { rail: probe("var(--m-side-rail)"), full: probe("var(--m-side-full)") };
  };
  const midpoint = (d: NonNullable<typeof drag.current>) => (d.rail + d.full) / 2;
  return {
    side: now ? (now.width < now.mid ? "rail" : "full") : side,
    dragging: !!now,
    style: now ? ({ "--m-side-w": `${now.width}px` } as CSSProperties) : undefined,
    handlers: {
      onPointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
        const { rail, full } = widths();
        drag.current = { x: e.clientX, from: side === "rail" ? rail : full, rail, full, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      },
      onPointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (!d.moved && Math.abs(dx) < 4) return;
        d.moved = true;
        // A little give past either end, like a rubber band.
        const w = d.from + dx;
        const give = (over: number) => Math.sign(over) * Math.sqrt(Math.abs(over)) * 2;
        setNow({ width: w < d.rail ? d.rail + give(w - d.rail) : w > d.full ? d.full + give(w - d.full) : w, mid: midpoint(d) });
      },
      onPointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
        const d = drag.current;
        if (!d) return;
        if (d.moved) setSide(d.from + (e.clientX - d.x) < midpoint(d) ? "rail" : "full");
        else setSide(side === "rail" ? "full" : "rail");
        drag.current = null;
        setNow(null);
      },
      onPointerCancel() {
        drag.current = null;
        setNow(null);
      },
      onKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setSide(side === "rail" ? "full" : "rail");
        }
      },
    },
  };
}

/** `closesAt`: the screen the menu opened on, when backing out of it shuts the menu. */
type Place = { tab: TabId; stacks: Record<TabId, Screen[]>; motion: Motion; closesAt?: Screen };

function Dex({ open, onClose, place, layout: forced, side, setSide, floating, copy }: {
  open: boolean;
  onClose(): void;
  place: [Place, Dispatch<SetStateAction<Place>>];
  layout?: Layout;
  side: Side;
  setSide(s: Side): void;
  floating?: boolean;
  /** The extra copy drawn while the dex turns: looks the same, can't be used. */
  copy?: boolean;
}) {
  const [{ tab, stacks, motion, closesAt }, setState] = place;
  const stack = stacks[tab];
  const env = useEnv();
  const update = (t: TabId, next: Screen[], how: Motion) => setState((st) => ({ ...st, tab: t, stacks: { ...st.stacks, [t]: next }, motion: how }));
  const nav: Nav = {
    depth: stack.length,
    sheet: false,
    go: (s) => update(tab, [...stack, s], "push"),
    back: () => {
      if (stack.length === 2 && stack[1] === closesAt) onClose();
      else if (stack.length > 1) update(tab, stack.slice(0, -1), "pop");
    },
    replace: (s) => update(tab, [...stack.slice(0, -1), s], "none"),
    reset: (s) => update(tab, s ? [rootOf(tab), s] : [rootOf(tab)], "pop"),
    tab: (t, s) => setState((st) => ({ ...st, tab: t, stacks: s ? { ...st.stacks, [t]: s.k === t ? [s] : [rootOf(t), s] } : st.stacks, motion: "tab" })),
    close: onClose,
  };
  const top = stack[stack.length - 1]!;
  const gifts = env.model.friends.filter((f) => f.gift).length;
  const [ref, layout] = useShape(forced);
  const grip = useSideGrip(ref, side, setSide);
  useEffect(() => {
    if (!open || copy) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [open, onClose, copy]);
  return (
    <div ref={ref} className={`m-dex${floating ? " floating" : ""}${open ? " open" : ""}`} data-layout={layout} data-side={grip.side} data-dragging={grip.dragging || undefined} style={grip.style} role="dialog" aria-label="Pokédex" aria-hidden={!open || copy} inert={!open || copy}>
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
            <span className="m-tablabel">{t.label}</span>
            <span className="m-tabmini" aria-hidden="true">{t.label}</span>
          </button>
        ))}
      </nav>
      <button
        type="button"
        className="m-sidegrip"
        aria-label={side === "full" ? "Make the sidebar slim" : "Show the sidebar's words"}
        {...grip.handlers}
      />
    </div>
  );
}


/** A game request answered over the game: the same lists as the dex, filtered to what it asks. */
function Sheet({ request, onDone }: { request: Request; onDone(): void }) {
  const env = useEnv();
  // The bottom of the stack stands for the list the game asked for (`root` below).
  const { stack, set, motion } = useStack([{ k: "inv" }]);
  const mustAnswer = request.kind === "fainted";
  // The tap on A that made the game ask doesn't pick from the list sliding up under it.
  const guard = useFreshTapGuard();
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
    <div className="m-sheet" role="dialog" aria-label="The game asks" {...guard}>
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
