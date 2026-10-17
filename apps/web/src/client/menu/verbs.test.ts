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
  // A key item with no count, on the Travel shelf, as the live model has it (QA bug 72).
  const BIKE: Item = { id: ID.BICYCLE, name: "BICYCLE", kind: "Travel", text: "" };
  function at(field: Pick<MenuModel["field"], "escapeRope" | "bike">, moment: Moment = "explore", biking = false) {
    const s = setup(moment);
    Object.assign(s.env.model, { field: { outside: true, flyTo: [], ...field }, biking, bag: [ROPE, BIKE] });
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

// QA bug 72: the OLD ROD's page had no Use, so fishing was impossible. Every item the start menu's
// ITEM list uses outside battle with no Pokémon to pick goes through the game's own UseItem.
describe("itemVerbs for the field items the game uses from its bag", () => {
  const item = (id: number, name: string, kind: Item["kind"], count?: number): Item => ({ id, name, kind, count, text: "" });
  const ROD = item(ID.OLD_ROD, "OLD ROD", "Travel");
  function at(moment: Moment = "explore") {
    const s = setup(moment);
    Object.assign(s.env.model, { field: { escapeRope: false, bike: true }, biking: false, repel: 0 });
    return { ...s, nav: { ...s.nav, sheet: moment !== "explore" } };
  }

  it("fishes with a rod through UseItem, closing the menu to show it", () => {
    for (const id of [ID.OLD_ROD, ID.GOOD_ROD, ID.SUPER_ROD]) {
      const { env, nav, actions } = at();
      const [v] = itemVerbs(env, nav, { ...ROD, id });
      expect(v).toMatchObject({ label: "Fish" });
      expect(v!.off).toBeUndefined();
      v!.run!();
      expect(actions.useItem).toHaveBeenCalledWith(id);
      expect(nav.close).toHaveBeenCalled();
    }
  });

  it("uses the ITEMFINDER, POKé FLUTE, COIN CASE and every Repel", () => {
    const cases: [Item, boolean][] = [
      [item(ID.ITEMFINDER, "ITEMFINDER", "Travel"), true],
      [item(ID.POKE_FLUTE, "POKé FLUTE", "Travel"), true],
      [item(ID.COIN_CASE, "COIN CASE", "Key"), false],
      [item(ID.REPEL, "REPEL", "Travel", 1), true],
      [item(ID.SUPER_REPEL, "SUPER REPEL", "Travel", 1), true],
      [item(ID.MAX_REPEL, "MAX REPEL", "Travel", 1), true],
    ];
    for (const [it, closes] of cases) {
      const { env, nav, actions } = at();
      const [v] = itemVerbs(env, nav, it);
      expect(v?.off, it.name).toBeUndefined();
      v!.run!();
      expect(actions.useItem, it.name).toHaveBeenCalledWith(it.id);
      expect(nav.close, it.name).toHaveBeenCalledTimes(closes ? 1 : 0);
    }
  });

  it("offers nothing for an item run out of", () => {
    const { env, nav } = at();
    expect(itemVerbs(env, nav, { ...item(ID.SUPER_REPEL, "SUPER REPEL", "Travel"), count: 0, gone: "Used up" })).toEqual([]);
  });

  it("greys them out in battle, and the battle items outside one", () => {
    const wild = at("wild");
    expect(itemVerbs(wild.env, wild.nav, ROD)[0]!.off).toBe("Not in battle");
    const town = at();
    const xAttack = item(0x41, "X ATTACK", "Battle", 1);
    expect(itemVerbs(town.env, town.nav, xAttack)[0]!.off).toBe("Only in battle");
    const [use] = itemVerbs(wild.env, wild.nav, xAttack);
    expect(use).toMatchObject({ label: "Use it", note: "Uses your turn" });
    expect(use!.off).toBeUndefined();
    use!.run!();
    expect(wild.actions.useItem).toHaveBeenCalledWith(0x41);
  });
});

// The field moves besides CUT, from the team screen (the HD UI pass: with the Start menu gone only
// CUT had a way in, so SURF, FLY and STRENGTH were out of reach on a phone).
describe("monVerbs for field moves", () => {
  const move = (name: string) => ({ name, type: "NORMAL", pp: 15, maxPp: 15 });
  const pidgeot: Mon = { key: "p", dex: 18, name: "PIDGEOT", level: 40, hp: 120, maxHp: 120, moves: [move("FLY"), move("TELEPORT")] };
  const blastoise: Mon = { key: "b", dex: 9, name: "BLASTOISE", level: 50, hp: 150, maxHp: 150, moves: [move("SURF"), move("STRENGTH"), move("FLASH"), move("DIG")] };
  const chansey: Mon = { key: "c", dex: 113, name: "CHANSEY", level: 40, hp: 100, maxHp: 300, moves: [move("SOFTBOILED")] };
  function team(badges: boolean[] = Array(8).fill(true), field: Partial<MenuModel["field"]> = {}) {
    const s = setup();
    (s.actions as unknown as { fieldMove: unknown }).fieldMove = vi.fn(() => "");
    Object.assign(s.env.model, {
      team: [blastoise, pidgeot, chansey, mon],
      trainer: { badges },
      surfing: false,
      field: { escapeRope: false, bike: true, outside: true, flyTo: [{ map: 2, name: "Pewter City" }], ...field },
    });
    const verb = (i: number, label: string) => monVerbs(s.env, s.nav, i).find((v) => v.label.startsWith(label));
    return { ...s, verb };
  }

  it("offers each move the Pokémon knows, closing the menu to show it", () => {
    const { verb, actions, nav } = team();
    for (const label of ["Use SURF", "Use STRENGTH", "Use FLASH"]) expect(verb(0, label)?.off, label).toBeUndefined();
    verb(0, "Use SURF")!.run!();
    expect(actions.fieldMove).toHaveBeenCalledWith(0, "SURF");
    expect(nav.close).toHaveBeenCalled();
  });

  it("greys out a move whose badge is missing, and FLY and TELEPORT indoors", () => {
    expect(team(Array(8).fill(false)).verb(0, "Use SURF")!.off).toBe("Needs the Soul Badge");
    const inside = team(undefined, { outside: false });
    expect(inside.verb(1, "Fly")!.off).toBe("Only outside");
    expect(inside.verb(1, "Use TELEPORT")!.off).toBe("Only outside");
    expect(team().verb(0, "Use DIG")!.off).toBe("Only in caves and dungeons");
  });

  it("FLY goes to a list of towns; SOFTBOILED picks who to heal", () => {
    const { verb, nav, actions, env } = team();
    verb(1, "Fly")!.run!();
    expect(nav.go).toHaveBeenCalledWith({ k: "fly", mon: 1 });
    verb(2, "Use SOFTBOILED")!.run!();
    expect(nav.go).toHaveBeenCalledWith({ k: "team", for: { softboiled: 2 } });
    const [heal] = monVerbs(env, nav, 3, { softboiled: 2 });
    expect(heal!.off).toBeUndefined();
    heal!.run!();
    expect(actions.fieldMove).toHaveBeenCalledWith(2, "SOFTBOILED", { target: 3 });
    expect(monVerbs(env, nav, 2, { softboiled: 2 })[0]!.off).toBe("That's the one using it");
  });
});

describe("monVerbs for switching in battle", () => {
  // Charlie's battle: CATERPIE leads, WEEDLE was sent out in its place.
  function battle(battleMon?: number) {
    const s = setup("wild");
    const weedle: Mon = { ...mon, key: "b", dex: 13, name: "WEEDLE" };
    Object.assign(s.env.model, { team: [{ ...mon, name: "CATERPIE", dex: 10 }, weedle], battleMon });
    return { ...s, nav: { ...s.nav, sheet: true } };
  }

  it("lets the leader back in once another was sent out", () => {
    const { env, nav } = battle(1);
    expect(monVerbs(env, nav, 0)[0]!.off).toBeUndefined();
    expect(monVerbs(env, nav, 1)[0]!.off).toBe("Already out");
  });

  it("takes the leader as out when the game hasn't said", () => {
    const { env, nav } = battle();
    expect(monVerbs(env, nav, 0)[0]!.off).toBe("Already out");
    expect(monVerbs(env, nav, 1)[0]!.off).toBeUndefined();
  });
});
