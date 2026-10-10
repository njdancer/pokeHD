// Prototype of the intro and the save manager (p2-slots, D39), at /dev/saves until Nick picks it.
// First load shows the intro: Resume (the save played last, from its latest resume point), Saves
// (every adventure, to play, copy, rename, bin or bring back, and start new) and Settings (the
// Pokédex menu's panel, once it exists). The game of the save played last is already loaded
// behind the menu, paused, so Resume just steps the menu aside; playing another save switches the
// game behind to it.
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { saveSummary, type SaveSummary } from "@pokehd/emu";
import { checkRom, decodeText, type RomHeader } from "@pokehd/rom";
import { fetchDevRom } from "../dev-rom.ts";
import { loadStoredRom } from "../rom-store.ts";
import { fetchCloudSave } from "../saves/cloud-save.ts";
import { readResumePoint } from "../saves/resume-store.ts";
import { loadSave, romKey } from "../saves/save-store.ts";
import {
  binSlot,
  createSlot,
  duplicateSlot,
  lastPlayedSlot,
  loadSlots,
  markPlayed,
  newSlotId,
  renameSlot,
  slotKey,
  unbinSlot,
  type SlotIndex,
  type SlotMeta,
} from "../saves/slots.ts";
import "../game/text-overlay.css";
import "../game/start-screen.css";
import { LoadingScreen, LOADING_FADE_MS } from "../LoadingScreen.tsx";
import "./saves-dev.css";

const Game = lazy(() => import("../game/Game.tsx").then((m) => ({ default: m.Game })));

interface Cart {
  rom: Uint8Array;
  header: RomHeader;
  sha1: string;
}

/** What a slot holds, as far as this device can tell. Its name and times come from the list. */
interface SlotView {
  summary: SaveSummary | null;
  /** Its latest resume point, if any (play since the last save). */
  pointAt: number | null;
  /** The save is only in the cloud so far. */
  cloudOnly: boolean;
}

const EMPTY: SlotView = { summary: null, pointAt: null, cloudOnly: false };

async function viewOf(sha1: string, meta: SlotMeta): Promise<SlotView> {
  const key = slotKey(sha1, meta.id);
  const local = await loadSave(key).catch(() => null);
  const cloud = local ? null : await fetchCloudSave(key).catch(() => null);
  const sram = local ?? (cloud && cloud !== "signed-out" ? cloud.sram : null);
  const point = await readResumePoint(key).catch(() => null);
  return { summary: sram && saveSummary(sram), pointAt: point?.takenAt ?? null, cloudOnly: !local && !!sram };
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function ago(at: number): string {
  if (!at) return "not played yet";
  const mins = Math.round((Date.now() - at) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${plural(mins, "minute")} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${plural(hours, "hour")} ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** The name the player gave it, or its trainer's. */
function title(meta: SlotMeta, v: SlotView): string {
  return meta.name ?? (v.summary ? decodeText(v.summary.name) : "New adventure");
}

function Facts({ summary }: { summary: SaveSummary | null }) {
  if (!summary) return <p className="saves-none">Not started yet</p>;
  return (
    <ul className="start-facts">
      <li><strong>{summary.badges}</strong> {summary.badges === 1 ? "badge" : "badges"}</li>
      <li><strong>{summary.owned}</strong> caught</li>
      <li><strong>{summary.hours}:{String(summary.minutes).padStart(2, "0")}</strong> played</li>
    </ul>
  );
}

type Screen = "intro" | "saves" | "settings";

/** A change to one slot in the list, shown at once while it's stored. */
const patch = (index: SlotIndex, id: string, change: Partial<SlotMeta>): SlotIndex => ({
  slots: index.slots.map((s) => (s.id === id ? { ...s, ...change } : s)),
});

export function SavesDev() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [status, setStatus] = useState("Loading…");
  const [index, setIndex] = useState<SlotIndex | null>(null);
  const [views, setViews] = useState<Map<string, SlotView>>(new Map());
  const [screen, setScreen] = useState<Screen>("intro");
  /** The slot whose game is loaded behind the menu (one not made yet, for a player with none). */
  const [behind, setBehind] = useState<string | null>(null);
  const [menu, setMenu] = useState(true);
  const [busy, setBusy] = useState(false);
  /** The game behind has drawn its world, and the list's details have been read. */
  const [worldReady, setWorldReady] = useState(false);
  const [viewsReady, setViewsReady] = useState(false);
  const [loaderGone, setLoaderGone] = useState(false);
  const onWorldReady = useCallback(() => setWorldReady(true), []);
  /** A slot just made from the list: its name is being typed. */
  const [naming, setNaming] = useState<string | null>(null);

  const loadViews = useCallback(async (sha1: string, idx: SlotIndex) => {
    const all = await Promise.all(idx.slots.map(async (m) => [m.id, await viewOf(sha1, m)] as const));
    setViews(new Map(all));
  }, []);

  useEffect(() => {
    (async () => {
      const rom = (await fetchDevRom()) ?? (await loadStoredRom());
      if (!rom) return setStatus("No ROM: load one in the app first."), setViewsReady(true), setWorldReady(true);
      const check = await checkRom(rom);
      if (!check.ok) return setStatus(check.reason), setViewsReady(true), setWorldReady(true);
      const sha1 = await romKey(rom);
      const idx = await loadSlots(sha1);
      setCart({ rom, header: check.header, sha1 });
      setIndex(idx);
      setBehind(lastPlayedSlot(idx)?.id ?? newSlotId());
      await loadViews(sha1, idx);
      setViewsReady(true);
    })();
  }, [loadViews]);

  /** Copying and making slots wait for each other; renames and the bin show at once. */
  const act = async (change: () => Promise<unknown>) => {
    if (!cart || busy) return;
    setBusy(true);
    try {
      await change();
      const idx = await loadSlots(cart.sha1);
      setIndex(idx);
      await loadViews(cart.sha1, idx);
    } finally {
      setBusy(false);
    }
  };
  const quick = (id: string, change: Partial<SlotMeta>, store: (sha1: string) => Promise<unknown>) => {
    if (!cart) return;
    setIndex((idx) => idx && patch(idx, id, change));
    void store(cart.sha1).catch((err) => console.warn("[pokeHD] couldn't update the save slots", err));
  };

  /** Plays a slot: the game behind is it already (Resume), or switches to it. */
  const play = (id: string) => {
    if (!cart) return;
    void markPlayed(cart.sha1, id).catch(() => {});
    setIndex((idx) => idx && patch(idx, id, { playedAt: Date.now() }));
    setBehind(id);
    setMenu(false);
  };

  const last = index && lastPlayedSlot(index);
  const live = useMemo(() => index?.slots.filter((s) => s.deletedAt === undefined) ?? [], [index]);
  const binned = index?.slots.filter((s) => s.deletedAt !== undefined) ?? [];
  const viewFor = (id: string) => views.get(id) ?? EMPTY;

  // One loading screen, the app's own, until the menu can show over a finished world; then it
  // fades out as the menu fades in.
  const shown = worldReady && viewsReady;
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setLoaderGone(true), LOADING_FADE_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  return (
    <>
      {!loaderGone && <LoadingScreen leaving={shown} />}
      {cart && behind && (
        <Suspense>
          <Game key={behind} rom={cart.rom} romKey={slotKey(cart.sha1, behind)} header={cart.header} onForget={() => setMenu(true)} held={menu} onReady={onWorldReady} />
        </Suspense>
      )}
      {menu && shown && (
        <div className="start-screen saves-screen" data-look="ball">
          <div className="start-panel saves-panel">
            <i className="hd-corner tl" />
            <i className="hd-corner tr" />
            <i className="hd-corner bl" />
            <i className="hd-corner br" />
            {/* Scrolls inside the panel, so the corners stand clear of its edge. */}
            <div className="saves-scroll">
              {!cart || !index ? (
                <p className="start-title start-wait">{status}</p>
              ) : screen === "intro" ? (
                <Intro
                  last={last ?? null}
                  view={last ? viewFor(last.id) : EMPTY}
                  count={live.length}
                  onResume={() => last && play(last.id)}
                  onNew={() => void act(async () => play((await createSlot(cart.sha1, undefined, fetch, behind ?? undefined)).id))}
                  onSaves={() => setScreen("saves")}
                  onSettings={() => setScreen("settings")}
                />
              ) : screen === "saves" ? (
                <SaveList
                  live={live}
                  binned={binned}
                  viewFor={viewFor}
                  busy={busy}
                  naming={naming}
                  onBack={() => setScreen("intro")}
                  onPlay={play}
                  onNew={() =>
                    void act(async () => {
                      const slot = await createSlot(cart.sha1);
                      setNaming(slot.id);
                    })
                  }
                  onCopy={(m) => void act(() => duplicateSlot(cart.sha1, m.id, `${title(m, viewFor(m.id))} (copy)`))}
                  onRename={(id, name) => {
                    setNaming(null);
                    const trimmed = name.trim();
                    const meta = index.slots.find((s) => s.id === id);
                    if ((meta?.name ?? "") === trimmed) return;
                    quick(id, trimmed ? { name: trimmed } : { name: undefined }, (sha1) => renameSlot(sha1, id, trimmed));
                  }}
                  onBin={(id) => quick(id, { deletedAt: Date.now() }, (sha1) => binSlot(sha1, id))}
                  onUnbin={(id) => quick(id, { deletedAt: undefined }, (sha1) => unbinSlot(sha1, id))}
                />
              ) : (
                <>
                  <p className="start-title">Settings</p>
                  <p className="start-sub">The Pokédex menu's settings panel goes here once it's built, so both places share one.</p>
                  <button type="button" className="start-button" onClick={() => setScreen("intro")}>Back</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

interface IntroProps {
  last: SlotMeta | null;
  view: SlotView;
  count: number;
  onResume(): void;
  onNew(): void;
  onSaves(): void;
  onSettings(): void;
}

function Intro({ last, view, count, onResume, onNew, onSaves, onSettings }: IntroProps) {
  return (
    <>
      {last ? (
        <>
          <p className="start-title">Welcome back{view.summary ? `, ${decodeText(view.summary.name)}` : ""}!</p>
          <Facts summary={view.summary} />
          <button type="button" className="start-button primary" onClick={onResume} data-testid="intro-resume">
            Resume
          </button>
          <p className="saves-when">
            {last.name ? `${last.name} · ` : ""}
            {view.pointAt ? `right where you left off, ${ago(view.pointAt)}` : `from the last save, played ${ago(last.playedAt)}`}
          </p>
        </>
      ) : (
        <>
          <p className="start-title">Hello there!</p>
          <p className="start-sub">A world of adventure is waiting.</p>
          <button type="button" className="start-button primary" onClick={onNew}>Start my adventure</button>
        </>
      )}
      <div className="start-row saves-intro-row">
        <button type="button" className="start-button" onClick={onSaves} data-testid="intro-saves">
          Saves{count > 1 ? ` (${count})` : ""}
        </button>
        <button type="button" className="start-button" onClick={onSettings}>Settings</button>
      </div>
    </>
  );
}

/** A save's name, typed over in place: it's stored when the field is left or Enter is pressed. */
function NameField({ meta, view, focus, onDone }: { meta: SlotMeta; view: SlotView; focus: boolean; onDone(name: string): void }) {
  return (
    <input
      className="saves-name saves-name-input"
      defaultValue={meta.name ?? ""}
      placeholder={view.summary ? decodeText(view.summary.name) : "Name your adventure"}
      aria-label="Name"
      maxLength={40}
      autoFocus={focus}
      enterKeyHint="done"
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      onBlur={(e) => onDone(e.currentTarget.value)}
    />
  );
}

interface ListProps {
  live: SlotMeta[];
  binned: SlotMeta[];
  viewFor(id: string): SlotView;
  busy: boolean;
  /** A slot just made: its card opens with the name ready to type. */
  naming: string | null;
  onBack(): void;
  onPlay(id: string): void;
  onNew(): void;
  onCopy(meta: SlotMeta): void;
  onRename(id: string, name: string): void;
  onBin(id: string): void;
  onUnbin(id: string): void;
}

function SaveList({ live, binned, viewFor, busy, naming, onBack, onPlay, onNew, onCopy, onRename, onBin, onUnbin }: ListProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const [binning, setBinning] = useState<string | null>(null);
  const [showBin, setShowBin] = useState(false);
  const open = naming ?? picked;
  // Newest played first; a slot just made goes to the top.
  const sorted = [...live].sort((a, b) => (b.id === naming ? 1 : 0) - (a.id === naming ? 1 : 0) || b.playedAt - a.playedAt || b.createdAt - a.createdAt);

  return (
    <div className="saves-list" aria-busy={busy}>
      <div className="saves-head">
        <button type="button" className="saves-back" onClick={onBack} aria-label="Back">‹</button>
        <p className="start-title">Saves</p>
      </div>
      <ul>
        {sorted.map((meta) => {
          const id = meta.id;
          const view = viewFor(id);
          const meta_ = (
            <span className="saves-meta">
              {view.summary ? `${plural(view.summary.badges, "badge")} · ${view.summary.owned} caught · ` : ""}
              {ago(meta.playedAt)}
              {view.cloudOnly ? " · in the cloud" : ""}
            </span>
          );
          return (
            <li key={id} className="saves-card" data-open={open === id}>
              {open === id ? (
                <div className="saves-card-main">
                  <NameField key={`${id}:${meta.name ?? ""}`} meta={meta} view={view} focus={naming === id} onDone={(name) => onRename(id, name)} />
                  {meta_}
                </div>
              ) : (
                <button type="button" className="saves-card-main" onClick={() => { setPicked(id); setBinning(null); }}>
                  <span className="saves-name">{title(meta, view)}</span>
                  {meta_}
                </button>
              )}
              {open === id &&
                (binning === id ? (
                  <div className="saves-confirm">
                    <p>Put this adventure in the bin? It stays there, and you can bring it back any time.</p>
                    <div className="start-row">
                      <button type="button" className="start-button" onClick={() => setBinning(null)}>Keep it</button>
                      <button type="button" className="start-button" onClick={() => { onBin(id); setBinning(null); setPicked(null); }}>Put in bin</button>
                    </div>
                  </div>
                ) : (
                  <div className="saves-actions">
                    <button type="button" className="start-button primary" onClick={() => onPlay(id)}>Play</button>
                    <div className="start-row">
                      <button type="button" className="start-button" disabled={busy} onClick={() => onCopy(meta)}>Copy</button>
                      <button type="button" className="start-button" onClick={() => setBinning(id)}>Bin</button>
                    </div>
                  </div>
                ))}
            </li>
          );
        })}
      </ul>
      <button type="button" className="start-button saves-new" disabled={busy} onClick={onNew}>+ New adventure</button>
      {binned.length > 0 && (
        <div className="saves-bin">
          <button type="button" className="start-link" onClick={() => setShowBin(!showBin)}>
            {showBin ? "Hide the bin" : `The bin (${binned.length})`}
          </button>
          {showBin && (
            <ul>
              {binned.map((meta) => {
                const view = viewFor(meta.id);
                return (
                  <li key={meta.id} className="saves-card binned">
                    <span className="saves-card-main">
                      <span className="saves-name">{title(meta, view)}</span>
                      <span className="saves-meta">{view.summary ? `${plural(view.summary.badges, "badge")} · ${view.summary.owned} caught` : "Not started"}</span>
                    </span>
                    <button type="button" className="start-button" onClick={() => onUnbin(meta.id)}>Bring back</button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
