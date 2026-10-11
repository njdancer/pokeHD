// The hi-fi Pokédex menu over the real game (/dev/menu/live): reads the game while the menu or a
// question is up, builds the menu's model from it (live.ts), and turns the game's questions into
// the menu's sheets, or the small fallback sheet where the menu has none.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ActionResult, AskAnswer, GameAction, GameAsk, GameSnapshot } from "@pokehd/emu";
import { trainerClasses, type WorldData } from "@pokehd/rom";
import type { Catalogue } from "../dex/catalogue.ts";
import { DexHost, type DexSlots } from "../dex/DexHost.tsx";
import { DexMenu, type DexMenuProps } from "./DexMenu.tsx";
import type { PlayJournal } from "./journal.ts";
import { LiveActions, liveModel, momentOf, requestOf, type LiveFriend, type LiveHost } from "./live.ts";
import type { AppOptions } from "./model.ts";
import { AskSheet } from "./Sheets.tsx";
import "./ask-sheet.css";

export interface LiveMenuProps {
  rom: Uint8Array;
  world: WorldData;
  catalogue: Catalogue;
  game: {
    read(): Promise<GameSnapshot>;
    act(action: GameAction, signal?: AbortSignal): Promise<ActionResult>;
    answer(id: number, answer: AskAnswer): void;
  };
  /**
   * Hands over the menu's actions, so the game's questions go to `asked` first: one it already
   * knows the answer to (a purchase's quantity, its "OK?") is answered there and never shown.
   */
  bind(actions: LiveActions): void;
  /** The game's question the menu shows a sheet for (with the game as it was when it asked). */
  ask: { id: number; ask: GameAsk; game: GameSnapshot | null } | null;
  /** The question has been answered (or a queued answer took it). */
  onAskDone(): void;
  open: boolean;
  /**
   * Draws the menu on the modelled dex (DexHost), which is then also the button that opens it.
   * Without it the menu is the floating panel and opening is the caller's.
   */
  onOpen?(): void;
  /** The shut dex steps aside (a question or the intro is up). */
  away?: boolean;
  start?: DexMenuProps["start"];
  onClose(): void;
  /** Read again with every read of the game (so its new records show). */
  journal: PlayJournal | null;
  friends: readonly LiveFriend[];
  savedAt: number;
  app: AppOptions;
  setApp<K extends keyof AppOptions>(key: K, value: AppOptions[K]): void;
  grownUps?: ReactNode;
}

/** How often the open menu reads the game (it runs on behind the menu). */
const READ_EVERY_MS = 1000;

export function LiveMenu({ rom, world, catalogue, game, bind, ask, onAskDone, open, onOpen, away, start, onClose, journal, friends, savedAt, app, setApp, grownUps }: LiveMenuProps) {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [notice, setNotice] = useState<{ text: string; n: number } | null>(null);
  const trainers = useMemo(() => trainerClasses(rom), [rom]);
  const reading = open || !!ask;
  const now = ask?.game ?? snapshot;
  const host = useRef<LiveHost>({ ...game, notice: () => {}, setApp, game: now });
  useEffect(() => {
    host.current = { ...game, notice: (text) => setNotice((n) => ({ text, n: (n?.n ?? 0) + 1 })), setApp, game: now };
  });
  const [actions] = useState(() => new LiveActions(rom, host));
  useEffect(() => bind(actions), [actions, bind]);

  // Read the game while anything is up; it keeps running behind the menu.
  useEffect(() => {
    if (!reading) return;
    let stopped = false;
    const read = () =>
      void game.read().then((s) => {
        if (!stopped) setSnapshot(s);
      });
    read();
    const timer = setInterval(read, READ_EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [reading, game]);

  const asking = ask;
  const request = useMemo(() => (asking ? requestOf(rom, asking.ask) : null), [rom, asking]);

  const model = useMemo(() => (now ? liveModel({ rom, world, catalogue, game: now, journal, friends, savedAt, app }) : null), [rom, world, catalogue, now, journal, friends, savedAt, app]);
  const moment = momentOf(now, asking?.ask ?? null);
  const env = useMemo(() => (model ? { rom, world, catalogue, trainers, model, moment, actions, ...(grownUps ? { grownUps } : {}) } : null), [rom, world, catalogue, trainers, model, moment, actions, grownUps]);

  const requestDone = () => {
    // Ended without an answer (closed): the game hears "cancel", as from its own B button.
    if (asking && actions.isAsking(asking.id)) actions.cancel();
    onAskDone();
  };
  const answerFallback = (answer: AskAnswer) => {
    if (!asking) return;
    actions.answered();
    game.answer(asking.id, answer);
    onAskDone();
  };

  const menu = (slots: Partial<DexSlots>) =>
    env && (
      <DexMenu
        key={start?.screen ? JSON.stringify(start) : "menu"}
        env={env}
        open={open && !asking}
        onClose={onClose}
        {...(start ? { start } : {})}
        request={request}
        onRequestDone={requestDone}
        notice={notice}
        {...slots}
      />
    );
  return (
    <>
      {/* The dex (the button) shows before the game's first read; the menu joins it once there's one. */}
      {onOpen ? (
        <DexHost open={open && !asking} onOpen={onOpen} onClose={onClose} away={!!away} alert={!!env?.model.friends.some((f) => f.gift)}>
          {(slots) => menu(slots ?? {})}
        </DexHost>
      ) : (
        menu({})
      )}
      {asking && !request && <AskSheet rom={rom} world={world} catalogue={catalogue} ask={asking.ask} game={asking.game ?? snapshot} answer={answerFallback} />}
    </>
  );
}
