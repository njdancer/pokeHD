import { describe, expect, it } from "vitest";
import { MessageLog, pageInput, type PageInputFacts } from "./qa-signals.ts";

const facts = (f: Partial<PageInputFacts> = {}): PageInputFacts => ({
  mode: "overworld", inWorld: true, dialog: null, menu: false, pageHolds: false, game: "overworld", battleAsk: false, sheet: false, acting: false, ...f,
});

describe("pageInput", () => {
  it("is ready for a message with its ▼, a menu, the HD battle menu and the page's sheets", () => {
    expect(pageInput(facts({ dialog: "waiting", game: "button", pageHolds: true }))).toEqual({ ready: true, on: "message" });
    expect(pageInput(facts({ menu: true, game: null }))).toEqual({ ready: true, on: "menu" });
    expect(pageInput(facts({ mode: "battle", battleAsk: true, game: "menu" }))).toEqual({ ready: true, on: "battle-menu" });
    expect(pageInput(facts({ sheet: true, game: null }))).toEqual({ ready: true, on: "sheet" });
  });

  it("waits while a message prints, or is held with no ▼ (the page answers the game's waits)", () => {
    expect(pageInput(facts({ dialog: "printing", pageHolds: true, game: "button" }))).toEqual({ ready: false, why: "printing" });
    // "used TACKLE!" through the move's animation: read, kept up, a tap does nothing.
    expect(pageInput(facts({ mode: "battle", dialog: "idle", pageHolds: true, game: null }))).toEqual({ ready: false, why: "message-held" });
    expect(pageInput(facts({ mode: "battle", dialog: "idle", game: null }))).toEqual({ ready: false, why: "message-held" });
  });

  it("takes the game's own wait for A with no ▼ (the stats box after a level)", () => {
    expect(pageInput(facts({ mode: "battle", dialog: "idle", game: "button" }))).toEqual({ ready: true, on: "message" });
  });

  it("doesn't take the game's menu wait for a menu the page stands in for", () => {
    expect(pageInput(facts({ mode: "battle", game: "menu" }))).toEqual({ ready: false, why: "battle" });
  });

  it("is free in the world only where the game's overworld loop reads the pad", () => {
    expect(pageInput(facts())).toEqual({ ready: true, on: "free" });
    expect(pageInput(facts({ game: null }))).toEqual({ ready: false, why: "busy" });
    // Before the world: Oak flying in, the game starting behind the page.
    expect(pageInput(facts({ inWorld: false, game: null }))).toEqual({ ready: false, why: "busy" });
    expect(pageInput(facts({ inWorld: false, game: null, dialog: "waiting", pageHolds: true }))).toEqual({ ready: true, on: "message" });
    expect(pageInput(facts({ acting: true }))).toEqual({ ready: false, why: "acting" });
  });
});

describe("MessageLog", () => {
  const read = (log: MessageLog, after = 0) => {
    const boxes: string[] = [];
    let group = -1;
    for (const l of log.since(after)) {
      if (l.group === group) boxes[boxes.length - 1] += ` ${l.text}`;
      else boxes.push(l.text);
      group = l.group;
    }
    return boxes;
  };

  it("keeps battle messages the game moves past by itself, in order (QA bug 65)", () => {
    const log = new MessageLog();
    log.show(["Enemy BULBASAUR", "used GROWL!"], true);
    log.show(["Enemy BULBASAUR", "used GROWL!"], true);
    log.show(["But, it failed!", ""], true);
    log.show(["SQUIRTLE", "used TACKLE!"], true);
    // A new box that shares a line with the last isn't a scroll.
    log.show(["Enemy BULBASAUR", "used TACKLE!"], true);
    expect(read(log)).toEqual(["Enemy BULBASAUR used GROWL!", "But, it failed!", "SQUIRTLE used TACKLE!", "Enemy BULBASAUR used TACKLE!"]);
  });

  it("reads a scrolling box as one message, and skips words still printing", () => {
    const log = new MessageLog();
    log.show(["Hello there!", "Welcome to the"], false);
    log.show(["Hello there!", "Welcome to the"], true);
    log.show(["Welcome to the", "world of"], true);
    log.show(["world of", "POKéMON!"], true);
    expect(read(log)).toEqual(["Hello there! Welcome to the world of POKéMON!"]);
  });

  it("goes on with a box whose second line comes later, and a last letter the ▼ hid", () => {
    const log = new MessageLog();
    log.show(["SQUIRTLE"], true);
    log.show(["SQUIRTLE", "used TACKLE"], true);
    log.show(["SQUIRTLE", "used TACKLE!"], true);
    expect(read(log)).toEqual(["SQUIRTLE used TACKLE!"]);
  });

  it("logs the same message twice when the box closed between", () => {
    const log = new MessageLog();
    log.show(["But, it failed!"], true);
    const seq = log.seq;
    log.show(null, true);
    log.show(["But, it failed!"], true);
    expect(read(log)).toEqual(["But, it failed!", "But, it failed!"]);
    expect(read(log, seq)).toEqual(["But, it failed!"]);
  });
});
