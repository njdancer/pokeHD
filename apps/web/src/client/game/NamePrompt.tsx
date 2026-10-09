// Names typed on the device's own keyboard (tap-first UI). When the game asks for a name (Oak
// asking the player's and the rival's, or a nickname), this asks instead and Controls in
// @pokehd/emu types the answer into the game's naming screen. A signed-in player already has a
// name, the one Nick invited them with, so Oak checks it rather than asking from scratch.
import { useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { flushSync } from "react-dom";
import type { NameAsk } from "@pokehd/emu";
import { defaultNames, monName, NAME_MAX, nameProblem, NAME_ALPHABET } from "@pokehd/rom";
import type { UiLook } from "./ui-look.ts";
import "./text-overlay.css";
import "./name-prompt.css";

interface Props {
  ask: NameAsk;
  rom: Uint8Array;
  /** The signed-in player's name, if any: Oak offers it for the player's own. */
  accountName: string | null;
  look: UiLook;
  /** The name to type into the game; empty keeps a Pokémon's own name; null uses the game's screen. */
  onAnswer(name: string | null): void;
}

/** The name with what the game can't write left out, cut to fit (a starting point to edit). */
const fitName = (name: string, max: number) => [...name].filter((c) => NAME_ALPHABET.includes(c)).slice(0, max).join("").trim();

export function NamePrompt({ ask, rom, accountName, look, onAnswer }: Props) {
  const max = NAME_MAX[ask.kind];
  const species = ask.kind === "mon" && ask.species !== undefined ? monName(rom, ask.species) : "";
  const offered = ask.kind === "player" && accountName && !nameProblem(accountName.trim(), max) ? accountName.trim() : null;
  const [typing, setTyping] = useState(!offered);
  const [value, setValue] = useState(() => (ask.kind === "player" && accountName ? fitName(accountName, max) : ""));
  const input = useRef<HTMLInputElement>(null);
  const suggestions = useMemo(() => (ask.kind === "mon" ? [] : defaultNames(rom, ask.kind)), [rom, ask.kind]);
  const name = value.trim();
  const problem = name ? nameProblem(name, max) : null;
  const oak = ask.kind !== "mon";

  const startTyping = () => {
    // Focus inside the tap itself, so a phone opens its keyboard.
    flushSync(() => setTyping(true));
    input.current?.focus();
    input.current?.select();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (problem || (!name && ask.kind !== "mon")) return;
    onAnswer(name);
  };

  const question =
    ask.kind === "player"
      ? offered
        ? "What should I call you, then?"
        : accountName
          ? `It says here your name is ${accountName}, but that won't fit. What should I call you?`
          : "First, what is your name?"
      : ask.kind === "rival"
        ? "This is my grandson. Erm, what is his name again?"
        : `What will you call ${species}?`;

  // Oak checking the name the player was invited with: his own message box and a choice box, in
  // the places the game puts them, so it reads as the next line of his speech.
  if (!typing && offered) {
    return (
      <div className="hd-text name-check" data-look={look} data-testid="name-prompt">
        <div className="hd-text-stage">
          <div className="hd-box menu active name-check-choices" style={tiles(10, 4, 10, 7)}>
            <Corners />
            <button type="button" className="hd-choice" onClick={() => onAnswer(offered)}>
              <span className="hd-cursor selected" aria-hidden />
              That's me!
            </button>
            <button type="button" className="hd-choice" onClick={startTyping}>
              <span className="hd-cursor" aria-hidden />
              Change it
            </button>
          </div>
          <div className="hd-box dialog name-check-line" style={tiles(0, 11, 20, 7)}>
            <Corners />
            <p><span>It says here your name is <strong>{offered}</strong>. Is that right?</span></p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="name-prompt" data-look={look} data-testid="name-prompt">
      <form className="name-panel" onSubmit={submit}>
        <Corners />
        {oak && <div className="name-speaker">PROF. OAK</div>}
        {
          <>
            <p className="name-line">{question}</p>
            <div className="name-field">
              <input
                ref={input}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={species || "Name"}
                aria-label={ask.kind === "mon" ? "Nickname" : ask.kind === "rival" ? "Rival's name" : "Your name"}
                aria-invalid={!!problem}
                autoFocus
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="words"
                spellCheck={false}
                enterKeyHint="done"
                maxLength={max + 4}
                data-testid="name-input"
              />
              <span className="name-count" aria-hidden>{[...name].length}/{max}</span>
            </div>
            {problem && <p className="name-problem" role="alert">{problem}</p>}
            {suggestions.length > 0 && (
              <div className="name-suggestions">
                {suggestions.map((s) => (
                  <button key={s} type="button" className="name-chip" onClick={() => setValue(s)}>{s}</button>
                ))}
              </div>
            )}
            <div className="name-actions">
              <button type="submit" className="name-button primary" disabled={!!problem || (!name && ask.kind !== "mon")}>
                {ask.kind === "mon" && !name ? `Keep ${species || "its name"}` : "OK"}
              </button>
              {offered && <button type="button" className="name-button" onClick={() => onAnswer(offered)}>Keep {offered}</button>}
            </div>
          </>
        }
        <button type="button" className="name-gameboy" onClick={() => onAnswer(null)}>Use the Game Boy keyboard</button>
      </form>
    </div>
  );
}

/** A box at the game's tile positions on the 20×18 screen, as the HD text layer places them. */
const tiles = (x: number, y: number, width: number, height: number): CSSProperties => ({
  left: `${(x / 20) * 100}%`,
  top: `${(y / 18) * 100}%`,
  width: `${(width / 20) * 100}%`,
  height: `${(height / 18) * 100}%`,
});

function Corners() {
  return (
    <>
      <i className="hd-corner tl" />
      <i className="hd-corner tr" />
      <i className="hd-corner bl" />
      <i className="hd-corner br" />
    </>
  );
}
