// The menu's actions in the Poké Mart (QA bug 25): the game's thanks for a purchase, taps made
// while the game is still busy with one, and a sheet the game has moved on from.
import type { AskAnswer, GameAsk } from "@pokehd/emu";
import type { Message } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { LiveActions, type LiveHost } from "./live.ts";

describe("LiveActions in the Poké Mart", () => {
  const POTION = 0x14;
  const mart: GameAsk = { kind: "mart", entries: [0x04, POTION] };
  const said = (text: string): Message => ({ pages: [{ lines: text.split("\n"), wait: "end" }], ending: "prompt" }) as Message;
  function shop() {
    const answers: [number, AskAnswer][] = [];
    const notices: string[] = [];
    const host: { current: LiveHost } = {
      current: {
        act: () => Promise.reject(new Error("unused")),
        answer: (id, a) => void answers.push([id, a]),
        notice: (t) => void notices.push(t),
        setApp: () => {},
        game: null,
      },
    };
    return { actions: new LiveActions(new Uint8Array(0), host), answers, notices };
  }
  /** The game's side of one purchase after its list: how many, the price and "OK?", then its thanks. */
  const purchase = (actions: LiveActions, id: number) => {
    expect(actions.asked(id, { kind: "quantity", max: 99, price: 300 })).toBe(true);
    expect(actions.heard(said("POTION?\nThat will be ₽300. OK?"))).toBeNull();
    expect(actions.asked(id + 1, { kind: "yes-no", text: "", yes: "YES", no: "NO" })).toBe(true);
    return actions.heard(said("Here you are!\nThank you!"));
  };

  it("takes the game's thanks as a notice and queues taps made meanwhile", () => {
    const { actions, answers, notices } = shop();
    expect(actions.asked(1, mart)).toBe(false);
    actions.buy(POTION, 1);
    // Two more taps while the game is still on the first purchase.
    actions.buy(POTION, 1);
    actions.buy(POTION, 1);
    expect(purchase(actions, 2)).toBe("reply");
    expect(actions.asked(4, mart)).toBe(true);
    expect(purchase(actions, 5)).toBe("reply");
    expect(actions.asked(7, mart)).toBe(true);
    expect(purchase(actions, 8)).toBe("reply");
    // Nothing queued: the sheet answers the list again.
    expect(actions.asked(10, mart)).toBe(false);
    expect(answers.filter(([, a]) => a && "index" in a)).toEqual([
      [1, { index: 1 }],
      [4, { index: 1 }],
      [7, { index: 1 }],
    ]);
    expect(notices).toEqual(Array(3).fill("Here you are! Thank you!"));
  });

  it("closes the shop's next list when the sheet is closed while the game is busy", () => {
    const { actions, answers } = shop();
    actions.asked(1, mart);
    actions.buy(POTION, 1);
    actions.cancel();
    actions.buy(POTION, 1);
    expect(purchase(actions, 2)).toBe("reply");
    expect(actions.asked(4, mart)).toBe(true);
    expect(answers.at(-1)).toEqual([4, null]);
    // "Is there anything else I can do?": the game has moved on, so a sheet still up goes.
    expect(actions.heard(said("Is there anything\nelse I can do?"))).toBe("away");
    // Back in later, the shop starts afresh.
    expect(actions.asked(5, mart)).toBe(false);
  });

  it("keeps a sheet the game is waiting on", () => {
    const { actions } = shop();
    actions.asked(1, mart);
    expect(actions.heard(said("Hello"))).toBeNull();
    actions.cancel();
    expect(actions.heard(said("Is there anything\nelse I can do?"))).toBe("away");
  });
});
