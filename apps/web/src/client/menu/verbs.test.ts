// Where the menu goes after using an item on a Pokémon (QA bug 28): out of battle, back to the
// item list as the game's bag does, never the team still asking "on which Pokémon?".
import { describe, expect, it, vi } from "vitest";
import type { MenuEnv } from "./env.tsx";
import type { Item, MenuActions, MenuModel, Moment, Mon } from "./model.ts";
import type { Nav } from "./nav.tsx";
import { monVerbs } from "./verbs.ts";

const POTION: Item = { id: 0x14, name: "POTION", kind: "Healing", count: 1, text: "" };
const TM34: Item = { id: 0xc9 + 33, name: "TM34", kind: "Machines", count: 1, text: "" };
const mon: Mon = { key: "a", dex: 5, name: "CHARMELEON", level: 17, hp: 13, maxHp: 52, moves: [] };

function setup(moment: Moment = "explore") {
  const actions = { useItem: vi.fn(() => ""), teach: vi.fn(() => "") } as unknown as MenuActions;
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
