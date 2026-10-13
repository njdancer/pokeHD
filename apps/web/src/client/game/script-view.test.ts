import type { ScreenText } from "@pokehd/emu";
import type { Message } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { newScriptView, SCRIPT_MIN_SHOWN_FRAMES, SCRIPT_UNFIT_FRAMES, scriptTap, scriptView, type ScriptView } from "./script-view.ts";

const box = { x: 0, y: 12, width: 20, height: 6, lines: [] };
const screen = (lines: [string, string]) => ({ dialog: { box, lines, state: "waiting" }, menus: [], boxes: [box] }) as unknown as ScreenText;

// Oak's dream (OaksLabOakThatWasMyDreamText): its first line fills the box to the border.
const dream: Message = {
  pages: [
    { lines: ["To make a complete", "guide on all the"], wait: "arrow", next: "scroll" },
    { lines: ["guide on all the", "POKéMON in the"], wait: "arrow", next: "scroll" },
    { lines: ["POKéMON in the", "world..."], wait: "arrow" },
    { lines: ["That was my dream!", ""], wait: "arrow" },
    { lines: ["But, I'm too old!", "I can't do it!"], wait: "end" },
  ],
  ending: "done",
};

describe("scriptView", () => {
  it("shows a message whose lines fill the box, and one whose last letter is under the ▼", () => {
    const ref: { current: ScriptView | null } = { current: newScriptView(25, dream) };
    const released: number[] = [];
    for (let f = 0; f < 3 * SCRIPT_UNFIT_FRAMES; f++) {
      expect(scriptView(ref, screen(["To make a complete", "guide on all the"]), true, (id) => released.push(id))).toEqual({
        lines: ["To make a complete", "guide on all the", "POKéMON in the", "world..."],
      });
    }
    // An 18-letter second line with the ▼ over its last letter.
    expect(scriptView(ref, screen(["", "That was my dream"]), true, (id) => released.push(id))).not.toBeNull();
    expect(released).toEqual([]);
  });

  it("gives a message the game's box doesn't show back to the game, so taps reach the game", () => {
    const ref: { current: ScriptView | null } = { current: newScriptView(25, dream) };
    const released: number[] = [];
    const other = screen(["Something else", "entirely"]);
    // A frame or two of the last message's words is fine.
    for (let f = 0; f < SCRIPT_UNFIT_FRAMES; f++) expect(scriptView(ref, other, true, (id) => released.push(id))).toBeNull();
    expect(released).toEqual([]);
    expect(ref.current).not.toBeNull();
    // For longer, the page isn't showing it: the game's own waits take over.
    expect(scriptView(ref, other, true, (id) => released.push(id))).toBeNull();
    expect(released).toEqual([25]);
    expect(ref.current).toBeNull();
  });

  // The nurse (DisplayPokemonCenterDialogue_): "OK. We'll need your POKéMON." ends with no wait of
  // its own, and the game keeps it on screen through HealParty and the healing machine.
  it("keeps a message the player has read up while the game's box still shows it (QA bug 19)", () => {
    const need: Message = { pages: [{ lines: ["OK. We'll need", "your POKéMON."], wait: "end" }], ending: "done" };
    const ref: { current: ScriptView | null } = { current: newScriptView(7, need) };
    const shown = screen(["OK. We'll need", "your POKéMON."]);
    const lines = ["OK. We'll need", "your POKéMON."];
    expect(scriptView(ref, shown, true, () => {})).toEqual({ lines });
    ref.current!.closed = true;
    // Seconds of the healing machine: the box stays, with the message's words.
    for (let f = 0; f < 300; f++) expect(scriptView(ref, shown, true, () => {})).toEqual({ lines });
    // The game is done with it, but its box still shows it: still up.
    ref.current!.ended = true;
    expect(scriptView(ref, shown, true, () => {})).toEqual({ lines });
    // The next message clears the box: the read one goes.
    expect(scriptView(ref, screen(["Thank you!", ""]), true, () => {})).toBeNull();
    expect(ref.current).toBeNull();
  });
});

describe("scriptTap", () => {
  const fainted: Message = { pages: [{ lines: ["Enemy PIDGEY", "fainted!"], wait: "arrow", next: "end" }], ending: "prompt" };
  const show = (ref: { current: ScriptView | null }, lines: [string, string], frames: number) => {
    for (let f = 0; f < frames; f++) scriptView(ref, screen(lines), true, () => {});
  };

  // QA bug 26: "Enemy PIDGEY fainted!" follows "CHARMANDER used SCRATCH!" with no tap between.
  it("reads on only once the game would have printed the box at the player's text speed", () => {
    const ref: { current: ScriptView | null } = { current: newScriptView(3, fainted, 3) };
    // 20 letters at medium speed (3 frames each).
    expect(ref.current!.readyAt).toBe(60);
    show(ref, ["Enemy PIDGEY", "fainted!"], 2);
    expect(scriptTap(ref.current)).toBe("wait"); // meant for the message before
    show(ref, ["Enemy PIDGEY", "fainted!"], 32);
    expect(scriptTap(ref.current)).toBe("wait"); // mid-print: the Game Boy would ignore it too
    expect(ref.current!.closed).toBe(false);
    show(ref, ["Enemy PIDGEY", "fainted!"], 26);
    expect(scriptTap(ref.current)).toBe("close");
    expect(ref.current!.closed).toBe(true);
    // Read: further taps go nowhere while the game finishes it.
    expect(scriptTap(ref.current)).toBe("wait");
    ref.current!.ended = true;
    expect(scriptTap(ref.current)).toBe("none");
    expect(scriptTap(null)).toBe("none");
  });

  it("counts only frames the page showed the box", () => {
    const ref: { current: ScriptView | null } = { current: newScriptView(3, fainted, 3) };
    // The HD text can't show it (another screen's up): those frames don't count.
    for (let f = 0; f < 5; f++) scriptView(ref, screen(["Enemy PIDGEY", "fainted!"]), false, () => {});
    expect(ref.current!.shown).toBe(0);
  });

  it("still waits a few frames when the game prints at once", () => {
    const ref: { current: ScriptView | null } = { current: newScriptView(3, fainted, 0) };
    expect(ref.current!.readyAt).toBe(SCRIPT_MIN_SHOWN_FRAMES);
    expect(scriptTap(ref.current)).toBe("wait");
    show(ref, ["Enemy PIDGEY", "fainted!"], SCRIPT_MIN_SHOWN_FRAMES);
    expect(scriptTap(ref.current)).toBe("close");
  });

  it("gives each box of a long message its own time, so mashing can't skip one unseen", () => {
    const ref: { current: ScriptView | null } = { current: newScriptView(25, dream, 1) };
    const [first, second] = ref.current!.boxes;
    expect(ref.current!.readyAt).toBe(first!.join("").length);
    show(ref, ["To make a complete", "guide on all the"], ref.current!.readyAt);
    expect(scriptTap(ref.current)).toBe("next");
    expect(ref.current!.index).toBe(1);
    expect(ref.current!.readyAt).toBe(second!.join("").length);
    expect(scriptTap(ref.current)).toBe("wait");
    expect(ref.current!.index).toBe(1);
  });
});
