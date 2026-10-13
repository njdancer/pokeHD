import type { ScreenText } from "@pokehd/emu";
import type { Message } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { newScriptView, SCRIPT_UNFIT_FRAMES, scriptView, type ScriptView } from "./script-view.ts";

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
