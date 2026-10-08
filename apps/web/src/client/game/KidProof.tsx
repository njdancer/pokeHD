// Kid-proofing (p1-kidproof): the game is mostly played by a young child on a phone, so the
// moments that can lose progress get big, clear questions, and the settings that can lose it
// sit behind a grown-ups check.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { SaveSummary } from "@pokehd/emu";
import { describeSave } from "../saves/history.ts";
import "./kid-proof.css";

/** How long "Erase it" must be held. A tap from a mashing thumb isn't enough. */
const HOLD_MS = 2000;

interface EraseProps {
  /** The save the game is about to replace. */
  old: SaveSummary | null;
  onAnswer(erase: boolean): void;
}

/**
 * Shown instead of the game's small "The older file will be erased to save. Okay?". Keeping
 * the old adventure is one big tap; erasing it means holding a smaller button.
 */
export function EraseConfirm({ old, onAnswer }: EraseProps) {
  const [held, setHeld] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  const stop = () => {
    clearInterval(timer.current);
    setHeld(0);
  };
  const start = () => {
    const began = performance.now();
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      const t = (performance.now() - began) / HOLD_MS;
      if (t < 1) return setHeld(t);
      clearInterval(timer.current);
      onAnswer(true);
    }, 30);
  };
  useEffect(() => () => clearInterval(timer.current), []);

  return (
    <div className="kid-overlay" role="alertdialog" aria-labelledby="erase-title" aria-describedby="erase-text">
      <div className="kid-card">
        <h2 id="erase-title">Save over your old adventure?</h2>
        <p id="erase-text">
          Saving this new game will replace {old ? <strong>{describeSave(old)}</strong> : "the old save"}.
          {" "}A copy is kept in Settings, under Grown-ups, if you change your mind.
        </p>
        <button type="button" className="kid-big" onClick={() => onAnswer(false)} autoFocus>
          Keep my old adventure
        </button>
        <button
          type="button"
          className="kid-hold"
          style={{ ["--held" as string]: held }}
          onPointerDown={start}
          onPointerUp={stop}
          onPointerLeave={stop}
          onPointerCancel={stop}
          onContextMenu={(e) => e.preventDefault()}
        >
          {held > 0 ? "Keep holding…" : "Hold to erase it and save"}
        </button>
      </div>
    </div>
  );
}

/** A small "Saved" note that fades out, shown when an autosave lands. */
export function SavedToast({ shownAt }: { shownAt: number }) {
  return (
    <div key={shownAt} className="saved-toast" role="status">
      <span aria-hidden="true">✓</span> Saved
    </div>
  );
}

/** A sum a young child can't do yet but a grown-up can at a glance. */
function newQuestion(): { text: string; answer: number } {
  const a = 6 + Math.floor(Math.random() * 4);
  const b = 3 + Math.floor(Math.random() * 6);
  return { text: `${a} × ${b}`, answer: a * b };
}

/**
 * Grown-ups only: the children are shown once the sum is answered, until the panel closes.
 * Not security, just enough that a curious child doesn't wander in.
 */
export function GrownUps({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [question, setQuestion] = useState(newQuestion);
  const [value, setValue] = useState("");
  const [wrong, setWrong] = useState(false);

  const check = (e: FormEvent) => {
    e.preventDefault();
    if (Number(value) === question.answer) return setUnlocked(true);
    setWrong(true);
    setValue("");
    setQuestion(newQuestion());
  };

  if (unlocked) {
    return (
      <section className="grown-ups">
        <h2>Grown-ups</h2>
        {children}
      </section>
    );
  }
  if (!open) {
    return (
      <div className="row">
        <button type="button" onClick={() => setOpen(true)}>Grown-ups…</button>
      </div>
    );
  }
  return (
    <form className="row grown-ups-gate" onSubmit={check}>
      <label>
        Grown-ups only: what is {question.text}?{" "}
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          size={4}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={wrong}
          autoFocus
        />
      </label>
      <button type="submit">OK</button>
      {wrong && <span role="status">Not quite. Try this one.</span>}
    </form>
  );
}
