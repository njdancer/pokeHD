// The HD battle menu (p2-tapfirst): what the player chooses in a battle, as big buttons at the
// bottom of the screen where thumbs are, in place of the Game Boy's FIGHT / PKMN / ITEM / RUN box
// and its move list. The game asks (BattleMenus in @pokehd/emu) and waits; a tap answers, and
// the game's own code carries on from there with its own rules and messages.
//
// Two layouts for Nick to pick from (battle-menu-flag.ts):
// - `moves`: the moves up front, one tap a turn, with Pokémon, Bag and Run underneath.
// - `classic`: the game's four choices first; Fight opens the moves.
// Keys and gamepads move a highlight and press it (`bindKeys`).
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { BattleAnswer, BattleAsk, MoveChoice } from "@pokehd/emu";
import { typeName } from "@pokehd/rom";
import { niceName } from "../dex/catalogue.ts";
import { TYPE_COLOURS } from "../menu/parts.tsx";
import type { BattleMenuLayout } from "./battle-menu-flag.ts";
import "./battle-menu.css";

export type BattleKey = "up" | "down" | "left" | "right" | "a" | "b";

interface Props {
  ask: BattleAsk;
  rom: Uint8Array;
  layout: BattleMenuLayout;
  /** The player's Pokémon's name, for "What will SQUIRTLE do?". */
  who: string | null;
  onAnswer(answer: BattleAnswer): void;
  /** Takes the menu's key handler while it's up (null once it goes): the page sends it the player's buttons. */
  bindKeys(handler: ((key: BattleKey) => void) | null): void;
}

interface Choice {
  id: string;
  row: number;
  col: number;
  /** Columns it spans in a row of `cols`. */
  wide?: boolean;
  run(): void;
  node: ReactNode;
  className: string;
  dim?: boolean;
  label: string;
}

export function BattleMenu({ ask, rom, layout, who, onAnswer, bindKeys }: Props) {
  // Classic: the four choices, or the moves after Fight.
  const [fighting, setFighting] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  // One answer per question (the page mounts a new menu for the next, by its id).
  const [answered, setAnswered] = useState(false);
  const answer = (a: BattleAnswer) => {
    if (answered) return;
    setAnswered(true);
    onAnswer(a);
  };

  const moveChoices = (moves: readonly MoveChoice[], pick: (i: number) => BattleAnswer): Choice[] =>
    moves.map((m, i) => ({
      id: `move${i}`,
      row: i >> 1,
      col: i & 1,
      run: () => answer(pick(i)),
      label: niceName(m.name),
      className: "bm-move",
      // The game decides what happens (it says "No PP left!"); the button only looks spent.
      dim: m.disabled || m.pp === 0,
      node: <MoveFace move={m} rom={rom} />,
    }));
  const action = (id: string, label: string, row: number, col: number, run: () => void, icon: ReactNode): Choice => ({
    id, row, col, run, label, className: `bm-action bm-${id}`, node: <><span className="bm-icon" aria-hidden="true">{icon}</span>{label}</>,
  });

  let title: string;
  let choices: Choice[];
  let back: (() => void) | null = null;
  if (ask.kind === "moves") {
    title = ask.purpose === "mimic" ? "Copy which move?" : ask.purpose === "item" ? "Which move?" : who ? `What will ${who} use?` : "Which move?";
    choices = moveChoices(ask.moves, (i) => ({ move: i }));
    if (ask.cancel) back = () => answer(null);
  } else if (ask.safari) {
    title = "What will you do?";
    choices = [
      action("ball", `Ball ×${ask.balls}`, 0, 0, () => answer({ choice: "ball" }), <BallIcon />),
      action("bait", "Bait", 0, 1, () => answer({ choice: "bait" }), "🍖"),
      action("rock", "Rock", 1, 0, () => answer({ choice: "rock" }), "🪨"),
      action("run", "Run", 1, 1, () => answer({ choice: "run" }), <RunIcon />),
    ];
  } else if (layout === "classic" && !fighting) {
    title = who ? `What will ${who} do?` : "What will you do?";
    choices = [
      action("fight", "Fight", 0, 0, () => {
        setFighting(true);
        // The highlight follows keys only; a tap leaves none.
        if (focus) setFocus("move0");
      }, <FightIcon />),
      action("pkmn", "Pokémon", 0, 1, () => answer({ choice: "pkmn" }), <BallIcon />),
      action("item", "Bag", 1, 0, () => answer({ choice: "item" }), <BagIcon />),
      action("run", "Run", 1, 1, () => answer({ choice: "run" }), <RunIcon />),
    ];
  } else {
    title = who ? `What will ${who} do?` : "What will you do?";
    choices = moveChoices(ask.moves, (i) => ({ fight: i }));
    if (layout === "classic") back = () => {
      setFighting(false);
      if (focus) setFocus("fight");
    };
    else {
      const row = Math.ceil(ask.moves.length / 2);
      choices.push(
        { ...action("pkmn", "Pokémon", row, 0, () => answer({ choice: "pkmn" }), <BallIcon />), className: "bm-action bm-small bm-pkmn" },
        { ...action("item", "Bag", row, 1, () => answer({ choice: "item" }), <BagIcon />), className: "bm-action bm-small bm-item" },
        { ...action("run", "Run", row, 2, () => answer({ choice: "run" }), <RunIcon />), className: "bm-action bm-small bm-run" },
      );
    }
  }

  // Keys: the arrows move the highlight between neighbours, A presses it, B goes back.
  useEffect(() => {
    bindKeys((key) => {
      const at = choices.find((c) => c.id === focus);
      if (key === "b") return back?.();
      if (key === "a") return at ? at.run() : setFocus(choices[0]?.id ?? null);
      if (!at) return setFocus(choices[0]?.id ?? null);
      const next = neighbour(choices, at, key);
      if (next) setFocus(next.id);
    });
    return () => bindKeys(null);
  });

  // The player's HD card sits above the menu (game.css).
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const style = document.documentElement.style;
    const observer = new ResizeObserver(() => style.setProperty("--bm-height", `${el.offsetHeight}px`));
    observer.observe(el);
    return () => {
      observer.disconnect();
      style.removeProperty("--bm-height");
    };
  }, []);

  const rows = groupRows(choices);
  return (
    <div ref={root} className="battle-menu" data-testid="battle-menu" data-layout={layout}>
      <div className="bm-panel">
        <div className="bm-title">
          {back && (
            <button type="button" className="bm-back" aria-label="Back" onClick={back}>
              ‹
            </button>
          )}
          <span>{title}</span>
        </div>
        {rows.map((row, r) => (
          <div key={r} className={`bm-row cols-${row.length > 2 ? 3 : 2}`}>
            {row.map((c) => (
              <button
                key={c.id}
                type="button"
                className={[c.className, c.dim && "dim", focus === c.id && "focused"].filter(Boolean).join(" ")}
                disabled={answered}
                aria-label={c.label}
                data-testid={`battle-${c.id}`}
                onClick={c.run}
              >
                {c.node}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function MoveFace({ move, rom }: { move: MoveChoice; rom: Uint8Array }) {
  const type = typeName(rom, move.type);
  return (
    <>
      <span className="bm-move-name">{niceName(move.name)}</span>
      <span className="bm-move-info">
        <span className="bm-type" style={{ background: TYPE_COLOURS[type] ?? "#9a9a7a" }}>{niceName(type)}</span>
        {move.pp !== null && (
          <span className="bm-pp">
            {move.pp}/{move.maxPp}
          </span>
        )}
      </span>
    </>
  );
}

function groupRows(choices: readonly Choice[]): Choice[][] {
  const rows: Choice[][] = [];
  for (const c of choices) (rows[c.row] ??= []).push(c);
  return rows.filter(Boolean).map((r) => r.sort((a, b) => a.col - b.col));
}

/** The choice next to `at` in the direction of `key`, by where they sit on screen. */
function neighbour(choices: readonly Choice[], at: Choice, key: BattleKey): Choice | undefined {
  const span = (c: Choice) => {
    const cols = choices.filter((o) => o.row === c.row).length;
    return (c.col + 0.5) / cols;
  };
  if (key === "left" || key === "right") {
    const row = choices.filter((c) => c.row === at.row).sort((a, b) => a.col - b.col);
    return row[row.indexOf(at) + (key === "left" ? -1 : 1)];
  }
  const rows = [...new Set(choices.map((c) => c.row))].sort((a, b) => a - b);
  const target = rows[rows.indexOf(at.row) + (key === "up" ? -1 : 1)];
  if (target === undefined) return undefined;
  const x = span(at);
  return choices.filter((c) => c.row === target).sort((a, b) => Math.abs(span(a) - x) - Math.abs(span(b) - x))[0];
}

const INK = "#3e2a1c";
const s = { stroke: INK, strokeWidth: 2, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

function BallIcon() {
  return (
    <svg viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="11" fill="#fbfbfb" {...s} />
      <path d="M5 16a11 11 0 0 1 22 0z" fill="#e8473b" {...s} />
      <circle cx="16" cy="16" r="3.6" fill="#fbfbfb" {...s} />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg viewBox="0 0 32 32">
      <path d="M11 11V9a5 5 0 0 1 10 0v2" fill="none" {...s} />
      <rect x="6" y="11" width="20" height="16" rx="4" fill="#d9a35b" {...s} />
      <rect x="12" y="16" width="8" height="5" rx="1.5" fill="#f6e2b8" {...s} />
    </svg>
  );
}

function RunIcon() {
  return (
    <svg viewBox="0 0 32 32">
      <path d="M6 16h16m-6-7 7 7-7 7" fill="none" {...s} strokeWidth={3} />
      <path d="M25 7v18" fill="none" {...s} strokeWidth={3} />
    </svg>
  );
}

function FightIcon() {
  return (
    <svg viewBox="0 0 32 32">
      <path d="M16 3l3.5 8.5L28 13l-6.5 6 2 9L16 23.5 8.5 28l2-9L4 13l8.5-1.5z" fill="#f2c94c" {...s} />
    </svg>
  );
}
