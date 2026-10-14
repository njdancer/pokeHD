// The QA stream's overlay (/dev/stream/overlay, framed by StreamHost at /dev/stream): Haiku plays pokeHD in the game gap while the
// overlay shows its thoughts and taps, its chat with Opus, the bug tracker, and the team and
// badges from the game itself. A port of the approved design (qa-stream v3, "Side Stage").
// The stage is 1920×1080, scaled to fit the window (1:1 at 1920×1080, for OBS).
// URL options: ?bus=http://localhost:4545 (the harness's event bus), ?game=/?stats&qa (the game
// in the gap, read through the host page: same origin, so the overlay can read its team),
// ?handle=@someone (shown in the header; Nick's by default, ?handle= hides it).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GameSnapshot, TeamMon } from "@pokehd/emu";
import { MAP_NAMES } from "@pokehd/rom";
import { useBus } from "./bus.ts";
import type { ActionEvent, ActionKind, Bug, ChatEvent, ChatTag, StreamMode, ThoughtEvent } from "./events.ts";
import { badgePictures, monPic, useGameSnapshot, useRom } from "./game.ts";
import { BUS, HANDLE, useFit, useFonts } from "./stage.ts";
import "./stream.css";

/** How long the mode change's slide takes (the stage's .7s transitions, plus a little). */
const SETTLE_MS = 760;

/** "ROUTE_1" → "Route 1", "REDS_HOUSE_2F" → "Reds House 2F", for when the bus hasn't said where the player is. */
function mapName(map: number): string {
  const name = MAP_NAMES[map];
  if (!name) return "";
  return name
    .toLowerCase()
    .split("_")
    .map((w) => (/^\d+f$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

const playTimeOf = (s: GameSnapshot) => `${s.playTime.hours}:${String(s.playTime.minutes).padStart(2, "0")}`;

export function StreamPage() {
  useFonts();
  const scale = useFit();
  const bus = useBus(BUS);
  const rom = useRom();
  // The game is the host page's (StreamHost), beside this frame.
  const frame = useMemo(() => ({ current: parent !== window ? (parent.document.getElementById("game") as HTMLIFrameElement | null) : null }), []);
  const game = useGameSnapshot(frame);
  const stage = useRef<HTMLDivElement>(null);
  const mode: StreamMode = bus.status?.mode === "talk" ? "talk" : "play";
  const [settled, setSettled] = useState(mode);

  // Lists show whole rows only: once the slide between modes is over, and whenever they change.
  useEffect(() => {
    const t = setTimeout(() => setSettled(mode), SETTLE_MS);
    return () => clearTimeout(t);
  }, [mode]);
  useLayoutEffect(() => {
    if (stage.current) trim(stage.current, settled === mode);
  });
  // The bug tracker is as tall as its bugs; the player card takes the rest of the column.
  useLayoutEffect(() => {
    const qs = stage.current;
    const bugs = qs?.querySelector<HTMLElement>(".qs-bugs");
    if (!qs || !bugs) return;
    const fit = () => qs.style.setProperty("--bugs-h", `${bugs.offsetHeight}px`);
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(bugs);
    return () => watch.disconnect();
  }, []);
  useEffect(() => {
    if (!document.fonts) return;
    void document.fonts.ready.then(() => stage.current && trim(stage.current, true));
  }, []);

  const map = bus.status?.map || (game ? mapName(game.map) : "");
  const playTime = bus.status?.playTime || (game ? playTimeOf(game) : "");

  return (
    <div className="qs-shell">
      <div className="qs-fit" style={{ transform: `translate(-50%,-50%) scale(${scale})` }}>
        <div className="qs" ref={stage} data-mode={mode}>
          <div data-gap>
          </div>

          <header className="qs-card qs-head">
            <div className="qs-logo" />
            <div className="qs-titles">
              <h1 className="qs-title">
                Claude QA's <b>pokeHD</b>
              </h1>
              <div className="qs-sub">
                <span className="qs-h">Haiku 5.5 plays</span> · <span className="qs-o">Opus 5.5 fixes</span>
              </div>
            </div>
            <div className="qs-headright">
              <div className="qs-pillrow">
                <span className="qs-paused-pill">
                  <i />
                  PAUSED
                </span>
                <span className="qs-live">
                  <i />
                  LIVE
                </span>
              </div>
              <div className="qs-links">
                {HANDLE && <span>{HANDLE}</span>}
                <span>github.com/njdancer/pokeHD</span>
              </div>
            </div>
          </header>


          <section className="qs-card qs-stream">
            <span className="qs-ball qs-tr" />
            <div className="qs-streamhead">
              <span className="qs-who">Haiku</span>
              {bus.connected && mode === "play" && (
                <span className="qs-dots">
                  <i />
                  <i />
                  <i />
                </span>
              )}
              <span className="qs-label" style={{ marginLeft: "auto" }}>
                {turnLabel(bus.status?.turn)}
              </span>
            </div>
            <Feed feed={bus.feed} connected={bus.connected} />
          </section>

          <Thread chat={bus.chat} />

          <Chat chat={bus.chat} />

          <section className="qs-card qs-info">
            <span className="qs-place">{map || "—"}</span>
            <Badges rom={rom} badges={game?.badges ?? 0} known={!!game} />
            <Stats game={game} playTime={playTime} />
            <Party rom={rom} team={game?.team ?? []} />
          </section>

          <BugTracker bugs={bus.bugs} />
        </div>
      </div>
    </div>
  );
}

function turnLabel(turn: number | undefined): string {
  const parts: string[] = [];
  if (turn !== undefined) parts.push(`Turn ${turn.toLocaleString("en-US")}`);
  return parts.join(" · ");
}

/**
 * Hides rows that don't fit whole: the oldest feed rows and chat from the top, the lowest bugs
 * from the bottom. While the stage slides between modes (`bugsToo` false) every bug shows, as the
 * design does, and the list is trimmed again when it settles.
 */
function trim(stage: HTMLElement, bugsToo: boolean) {
  for (const el of stage.querySelectorAll(".qs-cut")) el.classList.remove("qs-cut");
  for (const list of stage.querySelectorAll<HTMLElement>(".qs-flow, .qs-thread, .qs-chat")) {
    const rows = [...list.children] as HTMLElement[];
    // Rows measure from the list when it is positioned (the chat), else from the card around it.
    const top = (row: HTMLElement) => (row.offsetParent === list ? row.offsetTop : row.offsetTop - list.offsetTop);
    for (let i = 0; i < rows.length - 1; i++) if (top(rows[i]!) < -1) rows[i]!.classList.add("qs-cut");
  }
  if (!bugsToo) return;
  const bl = stage.querySelector<HTMLElement>(".qs-bl");
  if (!bl) return;
  const bugs = [...bl.children] as HTMLElement[];
  const limit = bl.offsetTop + bl.clientHeight;
  for (let j = bugs.length - 1; j > 0; j--) if (bugs[j]!.offsetTop + bugs[j]!.offsetHeight > limit + 1) bugs[j]!.classList.add("qs-cut");
}

const ICON: Record<ActionKind, string> = {
  tap: "☝",
  joystick: "✥",
  wait: "◷",
  screenshot: "◫",
  contact_sheet: "▦",
  notebook: "✎",
  report_bug: "✱",
  message: "✉",
};

function actionIcon(a: ActionEvent): string {
  if (a.kind === "joystick") return /[↑↓←→↖↗↘↙]/.exec(a.label)?.[0] ?? ICON.joystick;
  return ICON[a.kind];
}

function Feed({ feed, connected }: { feed: (ThoughtEvent | ActionEvent)[]; connected: boolean }) {
  const lastThought = feed.findLastIndex((f) => f.t === "thought");
  if (!feed.length) {
    return (
      <ol className="qs-flow">
        <li className="qs-none">{connected ? "Haiku is getting ready to play." : "Waiting for the player to join…"}</li>
      </ol>
    );
  }
  return (
    <ol className="qs-flow">
      {feed.map((f, i) => {
        if (f.t === "thought") {
          return (
            <li key={`t${f.id}`} className={i === lastThought ? "qs-t qs-now" : "qs-t"}>
              {f.text}
            </li>
          );
        }
        const newest = i === feed.length - 1;
        const cls = newest ? "qs-a qs-new" : i < lastThought ? "qs-a qs-old" : "qs-a";
        return (
          <li key={`a${f.id}`} className={cls}>
            <span className="qs-ic">{actionIcon(f)}</span>
            {f.label}
            {newest && <> <span className="qs-tagnew">NOW</span></>}
          </li>
        );
      })}
    </ol>
  );
}

const CHIP: Record<ChatTag, [string, string]> = {
  bug: ["qs-c-bug", "Bug"],
  fixed: ["qs-c-fix", "Fixed"],
  harness: ["qs-c-har", "Harness"],
  question: ["qs-c-q", "Question"],
  note: ["qs-c-note", "Note"],
  prompt: ["qs-c-prompt", "Prompt"],
};

/** A message's chip: its tag, or "Bug #n" for an untagged message about a bug. */
function chipOf(m: ChatEvent): [string, string] | null {
  if (m.tag === "bug" || (!m.tag && m.bug !== undefined)) return [CHIP.bug[0], m.bug !== undefined ? `Bug #${m.bug}` : CHIP.bug[1]];
  if (!m.tag) return null;
  const chip = CHIP[m.tag];
  return m.tag === "fixed" && m.bug !== undefined ? [chip[0], `Fixed #${m.bug}`] : chip;
}

/**
 * The conversation while Haiku plays (most of Opus's replies arrive then): a compact card under
 * the feed with the latest messages, newest at the bottom, each clamped to a few lines. In talk
 * mode it makes way for the full chat.
 */
function Thread({ chat }: { chat: ChatEvent[] }) {
  const shown = chat.slice(-6);
  return (
    <section className="qs-card qs-threadcard" aria-label="Haiku and Opus, latest messages">
      <span className="qs-ball qs-tr" />
      <div className="qs-streamhead">
        <span className="qs-who qs-h">Haiku</span>
        <span className="qs-amp">&amp;</span>
        <span className="qs-who qs-o">Opus</span>
        <span className="qs-label" style={{ marginLeft: "auto" }}>
          Dev chat
        </span>
      </div>
      <ol className="qs-thread">
        {shown.length === 0 && <li className="qs-none">No messages yet.</li>}
        {shown.map((m, i) => {
          const haiku = m.from === "player";
          const chip = chipOf(m);
          return (
            <li key={m.id} className={`qs-tm ${haiku ? "qs-from-haiku" : "qs-from-opus"}${i === shown.length - 1 ? " qs-latest" : ""}`}>
              <span className="qs-av">{haiku ? "H" : "O"}</span>
              <p className="qs-tmtext">
                {chip && <span className={`qs-chip ${chip[0]}`}>{chip[1]}</span>}
                {m.text}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** `at` as the harness writes it (ms, or seconds since the epoch), as "12:41", or "just now". */
function timeOf(at: number, now: number): string {
  const ms = at < 1e12 ? at * 1000 : at;
  if (now - ms < 60_000) return "just now";
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function useNow(every: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [every]);
  return now;
}

function Chat({ chat }: { chat: ChatEvent[] }) {
  const now = useNow(15_000);
  const shown = chat.slice(-8);
  return (
    <section className="qs-chat" aria-label="Haiku and Opus conversation">
      {shown.map((m, i) => {
        const haiku = m.from === "player";
        const chip = chipOf(m);
        return (
          <div key={m.id} className={`qs-msg ${haiku ? "qs-from-haiku" : "qs-from-opus"}${i === shown.length - 1 ? " qs-latest" : ""}`}>
            <div className="qs-av">{haiku ? "H" : "O"}</div>
            <div className="qs-bubble">
              <div className="qs-meta">
                {haiku ? "Haiku" : "Opus"} {chip && <span className={`qs-chip ${chip[0]}`}>{chip[1]}</span>}
                <span className="qs-time">{timeOf(m.at, now)}</span>
              </div>
              {m.text}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function Badges({ rom, badges, known }: { rom: Uint8Array | null; badges: number; known: boolean }) {
  const pictures = useMemo(() => (rom ? badgePictures(rom) : null), [rom]);
  let count = 0;
  for (let i = 0; i < 8; i++) if (badges & (1 << i)) count++;
  return (
    <div className="qs-badgerow">
      <span className="qs-label">Badges</span>
      <span className="qs-badges">
        {Array.from({ length: 8 }, (_, i) =>
          pictures ? (
            <img key={i} className={`qs-badge${badges & (1 << i) ? " qs-got" : ""}`} src={pictures[i]} alt="" />
          ) : (
            <i key={i} className="qs-badge-none" />
          ),
        )}
      </span>
      <b>
        {known ? count : "–"}
        <small>/8</small>
      </b>
    </div>
  );
}

/** Poké, Great, Ultra, Master and Safari Balls. */
const BALLS = new Set([0x01, 0x02, 0x03, 0x04, 0x08]);

function Stats({ game, playTime }: { game: GameSnapshot | null; playTime: string }) {
  const balls = game?.bag.reduce((n, b) => n + (BALLS.has(b.item) ? b.quantity : 0), 0) ?? 0;
  return (
    <div className="qs-stats">
      <span>
        <b>₽{game ? game.money.toLocaleString("en-US") : "–"}</b>
      </span>
      <span>
        Balls <b>{game ? balls : "–"}</b>
      </span>
      <span>
        Play <b className="qs-time">{playTime || "0:00"}</b>
      </span>
    </div>
  );
}

function Party({ rom, team }: { rom: Uint8Array | null; team: TeamMon[] }) {
  return (
    <div className="qs-party">
      {Array.from({ length: 6 }, (_, i) => {
        const mon = team[i];
        if (!mon) return <div key={i} className="qs-slot qs-empty" />;
        const pic = rom ? monPic(rom, mon.species) : null;
        const f = mon.maxHp ? Math.max(0, Math.min(1, mon.hp / mon.maxHp)) : 0;
        return (
          <div key={i} className={`qs-slot${i === 0 ? " qs-lead" : ""}${mon.hp === 0 ? " qs-fainted" : ""}`}>
            <span className="qs-pic">{pic && <img src={pic} alt="" />}</span>
            <div className="qs-slotbody">
              <div className="qs-s1">
                <span className="qs-name">{mon.nick}</span>
              </div>
              <div className="qs-s2">
                <span className="qs-lv">Lv {mon.level}</span>
                <span className="qs-hp">
                  <i className={f <= 0.2 ? "qs-crithp" : f <= 0.5 ? "qs-lowhp" : ""} style={{ width: `${f * 100}%` }} />
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BugTracker({ bugs }: { bugs: Bug[] }) {
  const real = bugs.filter((b) => b.status !== "wontfix");
  const fixed = real.filter((b) => b.status === "fixed").length;
  // The list is what's still to do; the strip's colour is its severity.
  const open = real.filter((b) => b.status !== "fixed");
  return (
    <section className="qs-card qs-bugs">
      <span className="qs-ball qs-tr" />
      <div className="qs-labelrow">
        <span className="qs-label">Bug tracker</span>
        <span className="qs-label qs-tally">
          <b>{fixed}</b>/{real.length} fixed
        </span>
      </div>
      <ol className="qs-bl">
        {open.length === 0 && <li className="qs-none">{real.length ? "All fixed." : "No bugs found yet."}</li>}
        {open.map((b) => (
          <li key={b.id} className="qs-bug" data-sev={b.severity}>
            <div className="qs-btitle">
              <span className="qs-id">#{b.id}</span> {b.title}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
