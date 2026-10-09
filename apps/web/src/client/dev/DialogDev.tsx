// Dev page (/dev/dialog): every message in the game next to how the HD message box joins it, so
// the joining rule can be checked across the whole script. Reads the text from the ROM in the
// browser. URL options: ?rule=peek, ?show=joined|full|differs|all, ?q=search.
import { useEffect, useMemo, useState } from "react";
import { labelDb, sourceUrl } from "@pokehd/rom/explore";
import { fetchDevRom } from "../dev-rom.ts";
import { loadStoredRom } from "../rom-store.ts";
import { dialogTexts, MAX_DIALOG_LINES, RAM_NAME, RAM_NUMBER, type Box, type DialogText, type Page, type Rule, type StopReason } from "./dialog-preview.ts";
import "./dialog-dev.css";

const query = new URLSearchParams(location.search);
type Show = "joined" | "full" | "differs" | "all";
const PAGE_SIZE = 80;

const REASONS: Record<StopReason, string> = {
  sentence: "sentence ends, you tap",
  question: "asks a question, you tap",
  full: "box full, you tap",
  button: "waits for a tap (no ▼)",
  end: "end of the message, you tap",
  done: "end of the message (a tap, a menu or more script follows)",
  code: "end: a routine takes over (mart, nurse…)",
};

const same = (a: Box[], b: Box[]) => a.length === b.length && a.every((x, i) => x.lines.join("\n") === b[i]!.lines.join("\n"));
const joins = (boxes: Box[]) => boxes.some((b) => b.pages.length > 1);
const midSentence = (boxes: Box[]) => boxes.some((b) => b.reason === "full");

/** Placeholders for names and numbers the game fills in. */
function Line({ text }: { text: string }) {
  const parts = text.split(new RegExp(`(${RAM_NAME}|${RAM_NUMBER})`));
  return <>{parts.map((p, i) => (p === RAM_NAME || p === RAM_NUMBER ? <mark key={i}>{p === RAM_NAME ? "name" : "123"}</mark> : p))}</>;
}

/** The game's own page: two lines, and a ▼ if it waits. */
function GamePage({ page }: { page: Page }) {
  return (
    <div className="dd-gb">
      <div><Line text={page.lines[0] || " "} /></div>
      <div><Line text={page.lines[1] || " "} />{page.wait === "arrow" && <span className="dd-arrow">▼</span>}</div>
    </div>
  );
}

/** One HD box, with a mark where the joiner tapped on for the player. */
function HdBox({ box }: { box: Box }) {
  const rows: { text: string; joinedBy?: "scroll" | "page" }[] = [];
  let read: string[] = [];
  box.pages.forEach((page, i) => {
    const lines = page.lines.filter(Boolean);
    let overlap = Math.min(read.length, lines.length);
    while (overlap > 0 && !lines.slice(0, overlap).every((l, k) => l === read[read.length - overlap + k])) overlap--;
    lines.slice(overlap).forEach((text, k) => rows.push(k === 0 && i > 0 ? { text, joinedBy: overlap ? "scroll" : "page" } : { text }));
    read = [...read, ...lines.slice(overlap)];
  });
  return (
    <div className={`dd-hd${box.pressedPastEnd ? " dd-bad" : ""}`}>
      <div className="dd-hd-box">
        {rows.map((r, i) => (
          <div key={i} className={r.joinedBy ? "dd-joined" : undefined} title={r.joinedBy && `tapped on for you (${r.joinedBy === "scroll" ? "the game scrolls" : "the game starts a new page"})`}>
            <Line text={r.text} />
          </div>
        ))}
      </div>
      <div className={`dd-reason dd-${box.reason}`}>
        {box.pressedPastEnd ? "⚠ taps past the end of the message: it would close on its own" : REASONS[box.reason]}
      </div>
    </div>
  );
}

function TextCard({ text, rule }: { text: DialogText; rule: Rule }) {
  const db = labelDb();
  const where = (text.label.file ?? "").replace(/^(data\/)?text\//, "").replace(/\.asm$/, "");
  const name = text.label.name.replace(/^_/, "").replace(/Text$/, "");
  const boxes = text.boxes[rule];
  return (
    <article className="dd-card">
      <header>
        <strong>{name}</strong>
        <a href={sourceUrl(db, text.label)} target="_blank" rel="noreferrer">{where}</a>
        <span>{text.pages.length} game pages → {boxes.length} HD boxes</span>
      </header>
      <div className="dd-cols">
        <div className="dd-col">
          <h4>Game</h4>
          {text.pages.map((p, i) => <GamePage key={i} page={p} />)}
        </div>
        <div className="dd-col">
          <h4>HD</h4>
          {boxes.map((b, i) => <HdBox key={i} box={b} />)}
        </div>
      </div>
    </article>
  );
}

export function DialogDev() {
  const [status, setStatus] = useState("Loading the ROM…");
  const [texts, setTexts] = useState<DialogText[] | null>(null);
  const [rule, setRule] = useState<Rule>(query.get("rule") === "peek" ? "peek" : "current");
  const [show, setShow] = useState<Show>((query.get("show") as Show) ?? "joined");
  const [search, setSearch] = useState(query.get("q") ?? "");
  // How many messages to list, until the filters change.
  const filters = `${rule} ${show} ${search}`;
  const [more, setMore] = useState({ filters, count: PAGE_SIZE });
  const count = more.filters === filters ? more.count : PAGE_SIZE;

  useEffect(() => {
    (async () => {
      const rom = (await loadStoredRom()) ?? (await fetchDevRom());
      if (!rom) return setStatus("No ROM: load one in the game first, then come back.");
      setStatus("Reading the dialog…");
      await new Promise((r) => setTimeout(r, 0));
      setTexts(dialogTexts(rom));
      setStatus("");
    })().catch((e: unknown) => setStatus(String(e)));
  }, []);

  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set("rule", rule);
    url.searchParams.set("show", show);
    if (search) url.searchParams.set("q", search);
    else url.searchParams.delete("q");
    history.replaceState(null, "", url);
  }, [rule, show, search]);

  const stats = useMemo(() => {
    if (!texts) return null;
    const sum = (f: (t: DialogText) => number) => texts.reduce((n, t) => n + f(t), 0);
    const of = (r: Rule) => ({
      boxes: sum((t) => t.boxes[r].length),
      joined: sum((t) => t.boxes[r].filter((b) => b.pages.length > 1).length),
      full: sum((t) => t.boxes[r].filter((b) => b.reason === "full").length),
      past: sum((t) => t.boxes[r].filter((b) => b.pressedPastEnd).length),
    });
    return { texts: texts.length, pages: sum((t) => t.pages.length), current: of("current"), peek: of("peek") };
  }, [texts]);

  const shown = useMemo(() => {
    if (!texts) return [];
    const q = search.trim().toLowerCase();
    return texts.filter((t) => {
      const boxes = t.boxes[rule];
      if (show === "joined" && !joins(boxes)) return false;
      if (show === "full" && !midSentence(boxes) && !boxes.some((b) => b.pressedPastEnd)) return false;
      if (show === "differs" && same(t.boxes.current, t.boxes.peek)) return false;
      if (!q) return true;
      return t.label.name.toLowerCase().includes(q) || (t.label.file ?? "").toLowerCase().includes(q) || t.pages.some((p) => p.lines.join(" ").toLowerCase().includes(q));
    });
  }, [texts, rule, show, search]);

  return (
    <div className="dd">
      <h1>Dialog joining</h1>
      <p className="dd-intro">
        The game's message box shows two lines and stops at a ▼ whenever it is full, even mid-sentence. The HD box holds up to {MAX_DIALOG_LINES}.
        When a page stops before its sentence ends and the next page still fits, we tap on for the player and show the pages together; we stop at
        the end of a sentence, a question, or when the box is full. Lines marked <span className="dd-joined-key">like this</span> were tapped on for you.
        Every message in the game is read from your ROM here, in your browser.
      </p>
      {stats && (
        <table className="dd-stats">
          <thead><tr><th /><th>Taps</th><th>Joined boxes</th><th>Stops mid-sentence (full)</th><th>Taps past the end</th></tr></thead>
          <tbody>
            <tr><th>Game</th><td>{stats.pages}</td><td>–</td><td>–</td><td>–</td></tr>
            {(["current", "peek"] as const).map((r) => (
              <tr key={r} className={r === rule ? "dd-on" : undefined}>
                <th>{r === "current" ? "Now" : "Proposed"}</th>
                <td>{stats[r].boxes}</td><td>{stats[r].joined}</td><td>{stats[r].full}</td><td>{stats[r].past}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="dd-controls">
        <div role="group" aria-label="Rule">
          <button className={rule === "current" ? "on" : ""} onClick={() => setRule("current")}>Now</button>
          <button className={rule === "peek" ? "on" : ""} onClick={() => setRule("peek")}>Proposed</button>
        </div>
        <select value={show} onChange={(e) => setShow(e.target.value as Show)} aria-label="Show">
          <option value="joined">Messages with joins</option>
          <option value="full">Stops mid-sentence or past the end</option>
          <option value="differs">Changed by the proposal</option>
          <option value="all">Every message</option>
        </select>
        <input type="search" placeholder="Search text or place" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <p className="dd-rule">
        {rule === "current"
          ? "Now: the joiner can't tell what comes after a ▼, so it assumes a whole new page (2 more lines). A box of 3 lines therefore stops even when the game would only scroll 1 line, and a message that ends on a line without punctuation (a sign, a number) gets tapped past."
          : "Proposed: the joiner learns what the game does after the ▼ (scroll one line, start a new page, or end the message). A scroll adds 1 line, so 3-line boxes can finish their sentence, and it never taps past the end of a message."}
      </p>
      {status && <p className="dd-status">{status}</p>}
      {texts && <p className="dd-count">{shown.length} messages</p>}
      {shown.slice(0, count).map((t) => <TextCard key={`${t.label.bank}:${t.label.address}`} text={t} rule={rule} />)}
      {shown.length > count && <button className="dd-more" onClick={() => setMore({ filters, count: count + PAGE_SIZE })}>Show more</button>}
    </div>
  );
}
