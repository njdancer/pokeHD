import { encodeText } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { boxesOf, pagesOf } from "./dialog-preview.ts";

const chars = (s: string) => [...encodeText(s, s.length + 1)].slice(0, -1);
const LINE = 0x4f, CONT = 0x55, PARA = 0x51, PROMPT = 0x58, DONE = 0x57;

describe("dialog preview", () => {
  // My name is OAK! / People call me ▼ (scroll) the POKéMON PROF! ▼ (new page) Is that so? done
  const rom = new Uint8Array([
    0x00, ...chars("My name is OAK!"), LINE, ...chars("People call me"), CONT, ...chars("the PROF!"),
    PARA, ...chars("Are you a boy"), LINE, ...chars("or a girl?"), DONE,
  ]);

  it("models the game's two-line message box", () => {
    const { pages, ending } = pagesOf(rom, 0);
    expect(ending).toBe("done");
    expect(pages).toEqual([
      { lines: ["My name is OAK!", "People call me"], wait: "arrow", next: "scroll" },
      { lines: ["People call me", "the PROF!"], wait: "arrow", next: "page" },
      { lines: ["Are you a boy", "or a girl?"], wait: "end" },
    ]);
  });

  it("joins pages with the real joiner", () => {
    const { pages, ending } = pagesOf(rom, 0);
    const boxes = boxesOf(pages, ending);
    expect(boxes.map((b) => [b.lines, b.reason])).toEqual([
      [["My name is OAK!", "People call me", "the PROF!"], "sentence"],
      [["Are you a boy", "or a girl?"], "done"],
    ]);
  });

  it("taps past a message ending without punctuation unless told it ends", () => {
    const sign = new Uint8Array([0x00, ...chars("INDIGO PLATEAU"), PROMPT]);
    const { pages, ending } = pagesOf(sign, 0);
    expect(boxesOf(pages, ending)[0]!.pressedPastEnd).toBe(true);
    expect(boxesOf(pages, ending, "peek")[0]!.pressedPastEnd).toBeUndefined();
  });
});
