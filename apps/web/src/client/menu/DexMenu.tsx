// The Pokédex menu (p2-dex-menu, D40): one menu in place of the game's Start menu and its
// Pokédex. Five tabs (Pokémon, People, Inventory, Map, Me), each a list with pages on top. What
// it shows is read from the game's memory and the play journal; what it does goes through the
// game's own routines (EmulatorHost.act), never its menus. Prototype and decisions:
// /mnt/project-files/dex-menu/ (prototype.html, handoff.md, hifi-screens.png).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ActionResult, GameAction, GameSnapshot } from "@pokehd/emu";
import type { WorldData } from "@pokehd/rom";
import type { Catalogue } from "../dex/catalogue.ts";
import type { Friend } from "../room/client.ts";
import { Menu, type MenuContext, type Page, type Tab } from "./context.ts";
import { Inventory, ItemPage, TeamPage } from "./InventoryTab.tsx";
import type { PlayJournal } from "./journal.ts";
import { MapTab, PlacePage } from "./MapTab.tsx";
import { Me, SavesPage, SettingsPage } from "./MeTab.tsx";
import { MonGrid, MonPage } from "./MonTab.tsx";
import { TAB_ICONS } from "./icons.tsx";
import { FriendPage, People, PersonPage } from "./PeopleTab.tsx";
import "./menu.css";

export interface DexMenuProps {
  rom: Uint8Array;
  world: WorldData;
  catalogue: Catalogue;
  /** Reads the game as it is now. */
  read(): Promise<GameSnapshot>;
  act(action: GameAction, signal: AbortSignal): Promise<ActionResult>;
  journal: PlayJournal | null;
  friends: readonly Friend[];
  savedAt: number;
  grownUps?: ReactNode;
  /** Opens on this tab and page (the game showing a new catch opens its page). */
  start?: { tab: Tab; page?: Page };
  onClose(): void;
}

const TABS: [Tab, string][] = [
  ["pokemon", "Pokémon"],
  ["people", "People"],
  ["inventory", "Inventory"],
  ["map", "Map"],
  ["me", "Me"],
];
/** How often the open menu re-reads the game (HP in a battle, money, the clock). */
const READ_EVERY_MS = 1000;
/** An action still waiting after this long shows "waiting for the game" with a Cancel. */
const WAIT_SHOWN_MS = 350;

/** Why an action didn't happen, in words for the player. */
function reasonText(reason: string): string {
  if (reason === "not now") return "Not right now.";
  return reason.charAt(0).toUpperCase() + reason.slice(1) + (/[.!?]$/.test(reason) ? "" : ".");
}

/** The game's words for the toast: its line breaks join, its capitals stay (they're names). */
const said = (messages: readonly string[]) => messages.map((m) => m.replace(/\n/g, " ")).join("\n");

export function DexMenu(props: DexMenuProps) {
  const { rom, world, catalogue, read, journal, friends, savedAt, grownUps, start, onClose } = props;
  const [tab, setTab] = useState<Tab>(start?.tab ?? "pokemon");
  const [stack, setStack] = useState<Page[]>(start?.page ? [start.page] : []);
  const [game, setGame] = useState<GameSnapshot | null>(null);
  const [waiting, setWaiting] = useState<{ cancel(): void } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [journalVersion, setJournalVersion] = useState(journal?.version ?? 0);
  const body = useRef<HTMLDivElement>(null);
  const actRef = useRef(props.act);
  useLayoutEffect(() => {
    actRef.current = props.act;
  });

  const refresh = useCallback(() => void read().then(setGame, () => {}), [read]);
  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      refresh();
      // The journal changes as the game runs behind the menu.
      setJournalVersion(journal?.version ?? 0);
    }, READ_EVERY_MS);
    return () => clearInterval(timer);
  }, [refresh, journal]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (stack.length) setStack((s) => s.slice(0, -1));
      else onClose();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [stack.length, onClose]);
  // A new page or tab starts at the top.
  useEffect(() => body.current?.querySelector(".dm-body")?.scrollTo(0, 0), [tab, stack]);

  const act = useCallback(
    async (action: GameAction): Promise<ActionResult | null> => {
      const abort = new AbortController();
      const shown = setTimeout(() => setWaiting({ cancel: () => abort.abort() }), WAIT_SHOWN_MS);
      const result = await actRef.current(action, abort.signal);
      clearTimeout(shown);
      setWaiting(null);
      refresh();
      if (!result.ok && result.reason === "cancelled") return null;
      if (result.ok && result.messages.length) setToast(said(result.messages));
      if (!result.ok) setToast(result.messages.length ? said(result.messages.slice(-1)) : reasonText(result.reason));
      return result;
    },
    [refresh],
  );

  const ctx = useMemo<MenuContext>(
    () => ({
      rom,
      world,
      catalogue,
      game,
      journal,
      journalVersion,
      friends,
      act,
      savedAt,
      grownUps,
      lookOnly: !!game?.inBattle,
      open: (page) => setStack((s) => [...s, page]),
      go: (t, page) => {
        setTab(t);
        setStack(page ? [page] : []);
      },
      back: () => setStack((s) => s.slice(0, -1)),
    }),
    [rom, world, catalogue, game, journal, journalVersion, friends, act, savedAt, grownUps],
  );
  const page = stack.at(-1);
  return (
    <Menu.Provider value={ctx}>
      <div className="dm" role="dialog" aria-modal aria-label="Pokédex" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="dm-frame">
          <div className="dm-card" ref={body}>
            {page ? <PageView page={page} /> : <TabView tab={tab} />}
            {waiting && (
              <div className="dm-wait" role="status">
                Waiting for the game to finish talking…
                <button type="button" onClick={waiting.cancel}>
                  Cancel
                </button>
              </div>
            )}
            {toast && !waiting && (
              <div className="dm-toast" role="status">
                {toast}
              </div>
            )}
            <nav className="dm-tabs" role="tablist">
              {TABS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  className="dm-tab"
                  aria-selected={tab === id}
                  onClick={() => {
                    setTab(id);
                    setStack([]);
                  }}
                >
                  {TAB_ICONS[id]}
                  {label}
                  {id === "people" && friends.some((f) => f.presence) && <span className="dm-dot">{friends.filter((f) => f.presence).length}</span>}
                </button>
              ))}
            </nav>
          </div>
          {(["tl", "tr", "bl", "br"] as const).map((c) => (
            <i key={c} className={`dm-ball ${c}`} aria-hidden />
          ))}
          <button type="button" className="dm-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>
    </Menu.Provider>
  );
}

function TabView({ tab }: { tab: Tab }) {
  switch (tab) {
    case "pokemon":
      return <MonGrid />;
    case "people":
      return <People />;
    case "inventory":
      return <Inventory />;
    case "map":
      return <MapTab />;
    case "me":
      return <Me />;
  }
}

function PageView({ page }: { page: Page }) {
  switch (page.kind) {
    case "mon":
      return <MonPage key={page.dex} dex={page.dex} />;
    case "team":
      return <TeamPage slot={page.slot} />;
    case "item":
      return <ItemPage item={page.item} />;
    case "person":
      return <PersonPage k={page.key} />;
    case "friend":
      return <FriendPage id={page.id} />;
    case "place":
      return <PlacePage name={page.name} />;
    case "settings":
      return <SettingsPage />;
    case "saves":
      return <SavesPage />;
  }
}
