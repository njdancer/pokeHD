// Where the menu goes after using an item on a Pokémon (QA bug 28): out of battle, back to the
// item list as the game's bag does, never the team still asking "on which Pokémon?".
import { describe, expect, it, vi } from "vitest";
import type { MenuEnv } from "./env.tsx";
import type { Item, MenuActions, MenuModel, Moment, Mon } from "./model.ts";
import type { Nav } from "./nav.tsx";
import { heals, ID, itemVerbs, monVerbs, onMon } from "./verbs.ts";

const POTION: Item = { id: 0x14, name: "POTION", kind: "Healing", count: 1, text: "" };
const TM34: Item = { id: 0xc9 + 33, name: "TM34", kind: "Machines", count: 1, text: "" };
const mon: Mon = { key: "a", dex: 5, name: "CHARMELEON", level: 17, hp: 13, maxHp: 52, moves: [] };

function setup(moment: Moment = "explore") {
  const actions = { useItem: vi.fn(() => ""), teach: vi.fn(() => ""), cut: vi.fn(() => "") } as unknown as MenuActions;
  const model = { team: [mon], bag: [POTION, TM34] } as unknown as MenuModel;
  const env = { model, moment, actions, toast: vi.fn() } as unknown as MenuEnv;
  const nav: Nav = { depth: 4, sheet: false, go: vi.fn(), back: vi.fn(), replace: vi.fn(), reset: vi.fn(), tab: vi.fn(), close: vi.fn() };
  return { env, nav, actions };
}

describe("monVerbs after a pick from the bag", () => {
  it("uses the item, then goes back to the item list", () => {
    const { env, nav, actions } = setup();
    monVerbs(env, nav, 0, { use: POTION.id })[0]!.run!();
    expect(actions.useItem).toHaveBeenCalledWith(POTION.id, 0);
    expect(nav.reset).toHaveBeenCalledWith();
    expect(nav.back).not.toHaveBeenCalled();
  });

  it("teaches the machine, then goes back to the item list", () => {
    const { env, nav, actions } = setup();
    env.model.canLearn = () => true;
    monVerbs(env, nav, 0, { teach: TM34.id })[0]!.run!();
    expect(actions.teach).toHaveBeenCalledWith(TM34.id, 0);
    expect(nav.reset).toHaveBeenCalledWith();
  });

  it("in battle, closes for the battle to carry on", () => {
    const { env, nav } = setup("wild");
    monVerbs(env, nav, 0, { use: POTION.id })[0]!.run!();
    expect(nav.close).toHaveBeenCalled();
    expect(nav.reset).not.toHaveBeenCalled();
  });
});

// The field items follow the game's own checks where the player stands (QA: the Escape Rope was
// greyed out "Inside caves" in Mt. Moon, exactly where ItemUseEscapeRope lets it work).
describe("itemVerbs for the field items", () => {
  const ROPE: Item = { id: ID.ESCAPE_ROPE, name: "ESCAPE ROPE", kind: "Travel", count: 1, text: "" };
  const BIKE: Item = { id: ID.BICYCLE, name: "BICYCLE", kind: "Key", text: "" };
  function at(field: MenuModel["field"], moment: Moment = "explore", biking = false) {
    const s = setup(moment);
    Object.assign(s.env.model, { field, biking, bag: [ROPE, BIKE] });
    return { ...s, nav: { ...s.nav, sheet: moment !== "explore" } };
  }

  it("uses an Escape Rope where the game lets it work", () => {
    const { env, nav, actions } = at({ escapeRope: true, bike: true });
    const [v] = itemVerbs(env, nav, ROPE);
    expect(v!.off).toBeUndefined();
    v!.run!();
    expect(actions.useItem).toHaveBeenCalledWith(ID.ESCAPE_ROPE);
    expect(nav.close).toHaveBeenCalled();
  });

  it("greys the Escape Rope out elsewhere and in battle", () => {
    const town = at({ escapeRope: false, bike: true });
    expect(itemVerbs(town.env, town.nav, ROPE)[0]!.off).toBe("Only in caves and dungeons");
    const wild = at({ escapeRope: true, bike: true }, "wild");
    expect(itemVerbs(wild.env, wild.nav, ROPE)[0]!.off).toBe("Not in battle");
  });

  it("offers the bike only where cycling is allowed, and getting off anywhere", () => {
    const inside = at({ escapeRope: false, bike: false });
    expect(itemVerbs(inside.env, inside.nav, BIKE)[0]).toMatchObject({ label: "Ride it", off: "No cycling here" });
    const outside = at({ escapeRope: false, bike: true });
    expect(itemVerbs(outside.env, outside.nav, BIKE)[0]!.off).toBeUndefined();
    const riding = at({ escapeRope: false, bike: false }, "explore", true);
    const [off] = itemVerbs(riding.env, riding.nav, BIKE);
    expect(off!.label).toBe("Get off");
    expect(off!.off).toBeUndefined();
  });
});

// QA bug 50: MOON STONE was filed under Healing. It's a boost now, still used on a Pokémon.
describe("itemVerbs for a boost (MOON STONE)", () => {
  const MOON_STONE: Item = { id: 0x0a, name: "MOON STONE", kind: "Boosts", count: 1, text: "" };

  it("is not Healing but still asks which Pokémon", () => {
    expect(heals(MOON_STONE)).toBe(false);
    expect(onMon(MOON_STONE)).toBe(true);
    const { env, nav } = setup();
    const [v] = itemVerbs(env, nav, MOON_STONE);
    expect(v).toMatchObject({ label: "Use it on…", off: undefined });
    v!.run!();
    expect(nav.go).toHaveBeenCalledWith({ k: "team", for: { use: 0x0a } });
  });

  it("uses it on the Pokémon picked first", () => {
    const { env, nav, actions } = setup();
    const [v] = itemVerbs(env, nav, MOON_STONE, { onMon: 0 });
    expect(v!.label).toBe("Use on Charmeleon");
    v!.run!();
    expect(actions.useItem).toHaveBeenCalledWith(0x0a, 0);
  });

  it("is greyed out in battle, as the game refuses it there", () => {
    const { env, nav } = setup("wild");
    expect(itemVerbs(env, { ...nav, sheet: true }, MOON_STONE, { onMon: 0 })[0]!.off).toBe("Not in battle");
  });
});

// QA bug 69: "Use CUT" only ever said there was nothing to cut, without asking the game.
describe("monVerbs for a Pokémon that knows CUT", () => {
  it("asks the game to CUT, then closes so the tree is seen to go", () => {
    const { env, nav, actions } = setup();
    env.model.team[0] = { ...mon, moves: [{ name: "CUT", type: "NORMAL", pp: 30, maxPp: 30 }] };
    const cut = monVerbs(env, nav, 0).find((v) => v.label === "Use CUT")!;
    cut.run!();
    expect(actions.cut).toHaveBeenCalledWith(0);
    expect(env.toast).not.toHaveBeenCalledWith(expect.stringMatching(/nothing to cut/i));
    expect(nav.close).toHaveBeenCalled();
  });
});
