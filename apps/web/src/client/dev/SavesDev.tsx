// Prototype of the intro and the save manager (p2-slots, D39), at /dev/saves until Nick picks it.
// First load shows the intro: Resume (the save played last, from its latest resume point), Saves
// (every adventure, to play, copy, rename, bin or bring back, and start new) and Settings (the
// Pokédex menu's panel, once it exists). Playing a save runs the real game on that slot here.
import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { saveSummary, type SaveSummary } from "@pokehd/emu";
import { checkRom, decodeText, type RomHeader } from "@pokehd/rom";
import { fetchDevRom } from "../dev-rom.ts";
import { GameView } from "../GameView.tsx";
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
  renameSlot,
  slotKey,
  unbinSlot,
  type SlotIndex,
  type SlotMeta,
} from "../saves/slots.ts";
import "../game/text-overlay.css";
import "../game/start-screen.css";
import "./saves-dev.css";

const Game = lazy(() => import("../game/Game.tsx").then((m) => ({ default: m.Game })));

interface Cart {
  rom: Uint8Array;
  header: RomHeader;
  sha1: string;
}

/** What a slot holds, as far as this device can tell. */
interface SlotView {
  meta: SlotMeta;
  summary: SaveSummary | null;
  /** Its latest resume point, if any (play since the last save). */
  pointAt: number | null;
  /** The save is only in the cloud so far. */
  cloudOnly: boolean;
}

async function viewOf(sha1: string, meta: SlotMeta): Promise<SlotView> {
  const key = slotKey(sha1, meta.id);
  const local = await loadSave(key).catch(() => null);
  const cloud = local ? null : await fetchCloudSave(key).catch(() => null);
  const sram = local ?? (cloud && cloud !== "signed-out" ? cloud.sram : null);
  const point = await readResumePoint(key).catch(() => null);
  return { meta, summary: sram && saveSummary(sram), pointAt: point?.takenAt ?? null, cloudOnly: !local && !!sram };
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

/** "RED", or the name the player gave it. */
function title(v: SlotView): string {
  if (v.meta.name) return v.meta.name;
  if (v.summary) return decodeText(v.summary.name);
  return "New adventure";
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

export function SavesDev() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [status, setStatus] = useState("Loading…");
  const [index, setIndex] = useState<SlotIndex | null>(null);
  const [views, setViews] = useState<Map<string, SlotView>>(new Map());
  const [screen, setScreen] = useState<Screen>("intro");
  const [playing, setPlaying] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (sha1: string, next?: SlotIndex) => {
    const idx = next ?? (await loadSlots(sha1));
    setIndex(idx);
    const all = await Promise.all(idx.slots.map((m) => viewOf(sha1, m)));
    setViews(new Map(all.map((v) => [v.meta.id, v])));
  }, []);

  useEffect(() => {
    (async () => {
      const rom = (await fetchDevRom()) ?? (await loadStoredRom());
      if (!rom) return setStatus("No ROM: load one in the app first.");
      const check = await checkRom(rom);
      if (!check.ok) return setStatus(check.reason);
      const sha1 = await romKey(rom);
      setCart({ rom, header: check.header, sha1 });
      await refresh(sha1);
    })();
  }, [refresh]);


  /** Runs a change to the list, then shows the result. */
  const act = async (change: () => Promise<unknown>) => {
    if (!cart || busy) return;
    setBusy(true);
    try {
      await change();
      await refresh(cart.sha1);
    } finally {
      setBusy(false);
    }
  };

  const play = async (id: string) => {
    if (!cart) return;
    await markPlayed(cart.sha1, id).catch(() => {});
    setPlaying(id);
  };

  if (cart && playing) {
    return (
      <Suspense>
        <Game rom={cart.rom} romKey={slotKey(cart.sha1, playing)} header={cart.header} onForget={() => setPlaying(null)} />
      </Suspense>
    );
  }

  const last = index && lastPlayedSlot(index);
  const lastView = last ? views.get(last.id) : undefined;
  const live = index?.slots.filter((s) => s.deletedAt === undefined) ?? [];
  const binned = index?.slots.filter((s) => s.deletedAt !== undefined) ?? [];

  return (
    <>
      <GameView />
      <div className="start-screen saves-screen" data-look="ball">
        <div className="start-panel saves-panel">
          <i className="hd-corner tl" />
          <i className="hd-corner tr" />
          <i className="hd-corner bl" />
          <i className="hd-corner br" />
          {!cart || !index ? (
            <p className="start-title start-wait">{status}</p>
          ) : screen === "intro" ? (
            <Intro
              last={lastView ?? null}
              onResume={() => last && void play(last.id)}
              onNew={() => void act(async () => play((await createSlot(cart.sha1)).id))}
              onSaves={() => setScreen("saves")}
              onSettings={() => setScreen("settings")}
              count={live.length}
            />
          ) : screen === "saves" ? (
            <SaveList
              live={live.map((m) => views.get(m.id) ?? { meta: m, summary: null, pointAt: null, cloudOnly: false })}
              binned={binned.map((m) => views.get(m.id) ?? { meta: m, summary: null, pointAt: null, cloudOnly: false })}
              busy={busy}
              onBack={() => setScreen("intro")}
              onPlay={(id) => void play(id)}
              onNew={() => void act(() => createSlot(cart.sha1))}
              onCopy={(v) => void act(() => duplicateSlot(cart.sha1, v.meta.id, `${title(v)} (copy)`))}
              onRename={(id, name) => void act(() => renameSlot(cart.sha1, id, name))}
              onBin={(id) => void act(() => binSlot(cart.sha1, id))}
              onUnbin={(id) => void act(() => unbinSlot(cart.sha1, id))}
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
    </>
  );
}

interface IntroProps {
  last: SlotView | null;
  count: number;
  onResume(): void;
  onNew(): void;
  onSaves(): void;
  onSettings(): void;
}

function Intro({ last, count, onResume, onNew, onSaves, onSettings }: IntroProps) {
  return (
    <>
      {last ? (
        <>
          <p className="start-title">Welcome back{last.summary ? `, ${decodeText(last.summary.name)}` : ""}!</p>
          <Facts summary={last.summary} />
          <button type="button" className="start-button primary" onClick={onResume} data-testid="intro-resume">
            Resume
          </button>
          <p className="saves-when">
            {last.meta.name ? `${last.meta.name} · ` : ""}
            {last.pointAt ? `right where you left off, ${ago(last.pointAt)}` : `from the last save, played ${ago(last.meta.playedAt)}`}
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

interface ListProps {
  live: SlotView[];
  binned: SlotView[];
  busy: boolean;
  onBack(): void;
  onPlay(id: string): void;
  onNew(): void;
  onCopy(v: SlotView): void;
  onRename(id: string, name: string): void;
  onBin(id: string): void;
  onUnbin(id: string): void;
}

function SaveList({ live, binned, busy, onBack, onPlay, onNew, onCopy, onRename, onBin, onUnbin }: ListProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [binning, setBinning] = useState<string | null>(null);
  const [showBin, setShowBin] = useState(false);
  const byPlayed = [...live].sort((a, b) => b.meta.playedAt - a.meta.playedAt);

  return (
    <div className="saves-list" aria-busy={busy}>
      <div className="saves-head">
        <button type="button" className="saves-back" onClick={onBack} aria-label="Back">‹</button>
        <p className="start-title">Saves</p>
      </div>
      <ul>
        {byPlayed.map((v) => {
          const id = v.meta.id;
          return (
            <li key={id} className="saves-card" data-open={open === id}>
              <button type="button" className="saves-card-main" onClick={() => setOpen(open === id ? null : id)}>
                <span className="saves-name">{title(v)}</span>
                <span className="saves-meta">
                  {v.summary ? `${plural(v.summary.badges, "badge")} · ${v.summary.owned} caught · ` : ""}
                  {ago(v.meta.playedAt)}
                  {v.cloudOnly ? " · in the cloud" : ""}
                </span>
              </button>
              {open === id &&
                (renaming === id ? (
                  <form
                    className="saves-rename"
                    onSubmit={(e) => {
                      e.preventDefault();
                      onRename(id, String(new FormData(e.currentTarget).get("name") ?? ""));
                      setRenaming(null);
                    }}
                  >
                    <input name="name" defaultValue={v.meta.name ?? ""} placeholder={v.summary ? decodeText(v.summary.name) : "Name"} maxLength={40} autoFocus />
                    <button type="submit" className="start-button">Save</button>
                  </form>
                ) : binning === id ? (
                  <div className="saves-confirm">
                    <p>Put this adventure in the bin? It stays there, and you can bring it back any time.</p>
                    <div className="start-row">
                      <button type="button" className="start-button" onClick={() => setBinning(null)}>Keep it</button>
                      <button type="button" className="start-button" onClick={() => { onBin(id); setBinning(null); setOpen(null); }}>Put in bin</button>
                    </div>
                  </div>
                ) : (
                  <div className="saves-actions">
                    <button type="button" className="start-button primary" onClick={() => onPlay(id)}>Play</button>
                    <div className="start-row">
                      <button type="button" className="start-button" disabled={busy} onClick={() => onCopy(v)}>Copy</button>
                      <button type="button" className="start-button" onClick={() => setRenaming(id)}>Rename</button>
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
              {binned.map((v) => (
                <li key={v.meta.id} className="saves-card binned">
                  <span className="saves-card-main">
                    <span className="saves-name">{title(v)}</span>
                    <span className="saves-meta">{v.summary ? `${plural(v.summary.badges, "badge")} · ${v.summary.owned} caught` : "Not started"}</span>
                  </span>
                  <button type="button" className="start-button" disabled={busy} onClick={() => onUnbin(v.meta.id)}>Bring back</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
