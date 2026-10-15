// What a Pokémon or an item can do right now, given the game's moment and why it was picked.
// The rules are the game's (balls only in wild battles, no bike indoors…); these only decide what
// to offer, the game's own routines still decide what happens.
import { inBattle, type FieldMove, type Item, type Mon } from "./model.ts";
import { niceItem, niceMon, type MenuEnv } from "./env.tsx";
import type { Nav, Purpose } from "./nav.tsx";
import type { VerbSpec } from "./ui.tsx";

export const ID = {
  POKE_BALL: 4,
  TOWN_MAP: 5,
  BICYCLE: 6,
  ANTIDOTE: 0x0b,
  SUPER_POTION: 0x13,
  POTION: 0x14,
  ESCAPE_ROPE: 0x1d,
  REPEL: 0x1e,
  POKE_DOLL: 0x33,
  SUPER_REPEL: 0x38,
  MAX_REPEL: 0x39,
  COIN_CASE: 0x45,
  ITEMFINDER: 0x47,
  POKE_FLUTE: 0x49,
  OLD_ROD: 0x4c,
  GOOD_ROD: 0x4d,
  SUPER_ROD: 0x4e,
  HM01: 0xc4,
  TM01: 0xc9,
} as const;

const REPELS = new Set<number>([ID.REPEL, ID.SUPER_REPEL, ID.MAX_REPEL]);
/**
 * Field items whose ItemUsePtrTable routine works outside battle with no Pokémon to pick, beyond
 * the ones with their own rules below (Repels, Escape Rope, Bicycle, Town Map). The ones in
 * UsableItems_CloseMenu close the menu, so what they do is seen (QA bug 72: the rods had no Use).
 */
const FIELD_USE: Record<number, { label: string; note?: string; close: boolean }> = {
  [ID.OLD_ROD]: { label: "Fish", note: "Face the water first", close: true },
  [ID.GOOD_ROD]: { label: "Fish", note: "Face the water first", close: true },
  [ID.SUPER_ROD]: { label: "Fish", note: "Face the water first", close: true },
  [ID.ITEMFINDER]: { label: "Use it", note: "Looks for hidden items nearby", close: true },
  [ID.POKE_FLUTE]: { label: "Play it", close: true },
  [ID.COIN_CASE]: { label: "Count the coins", close: false },
};

export const heals = (it: Item) => it.kind === "Healing";
/** Used on a Pokémon: medicine, and the boosts (stones, vitamins, RARE CANDY), which the game refuses in battle. */
export const onMon = (it: Item) => heals(it) || it.kind === "Boosts";
const notNow = (it: Item, battle: boolean) => (battle && it.kind === "Boosts" ? "Not in battle" : undefined);
export const isMachine = (it: Item) => it.id >= ID.HM01;

/** Who can learn what: the model's answer (the ROM's TM/HM flags in the real game). */
export const canLearn = (env: MenuEnv, m: Mon, item: number) => env.model.canLearn(m.dex, item);

function done(env: MenuEnv, nav: Nav, line: string, close = false) {
  env.toast(line);
  if (close) nav.close();
}

export function monVerbs(env: MenuEnv, nav: Nav, i: number, purpose?: Purpose): VerbSpec[] {
  const { model, moment, actions } = env;
  const m = model.team[i]!;
  const battle = inBattle(moment);
  // Used or taught from the bag: as in the game, back to the item list (the bag's root), not the
  // team still asking "on which Pokémon?" for an item that may be gone.
  if (purpose && "use" in purpose) {
    const it = model.bag.find((b) => b.id === purpose.use)!;
    return [{ label: `Use ${niceItem(it.name)} on ${niceMon(m.name)}`, note: battle ? "Uses your turn" : undefined, run: () => (done(env, nav, actions.useItem(it.id, i), battle), battle || nav.reset()) }];
  }
  if (purpose && "teach" in purpose)
    return [{ label: `Teach it to ${niceMon(m.name)}`, off: canLearn(env, m, purpose.teach) ? undefined : `${niceMon(m.name)} can't learn it`, run: () => (done(env, nav, actions.teach(purpose.teach, i)), nav.reset()) }];
  if (purpose && "softboiled" in purpose) {
    const user = model.team[purpose.softboiled]!;
    return [{ label: `Give ${niceMon(m.name)} some of ${niceMon(user.name)}'s HP`, off: i === purpose.softboiled ? "That's the one using it" : m.hp === 0 ? "Fainted" : m.hp >= m.maxHp ? "Already healthy" : undefined, run: () => (done(env, nav, actions.fieldMove(purpose.softboiled, "SOFTBOILED", { target: i })), nav.reset({ k: "mon", i: purpose.softboiled })) }];
  }
  if (purpose && "giftTo" in purpose) {
    const f = model.friends.find((x) => x.id === purpose.giftTo)!;
    return [{ label: `Send ${niceMon(m.name)} to ${f.name}`, off: model.team.length < 2 ? "Keep one with you" : undefined, run: () => (done(env, nav, actions.gift(f.id, { mon: i })), nav.reset({ k: "friend", id: f.id })) }];
  }
  if (moment === "fainted") return [{ label: `Send out ${niceMon(m.name)}`, off: m.hp === 0 ? "Fainted" : undefined, run: () => done(env, nav, actions.sendOut(i), true) }];
  if (moment === "pc") return [{ label: "Put it in the PC", off: model.team.length < 2 ? "Keep one with you" : undefined, run: () => done(env, nav, actions.deposit(i), true) }];
  if (battle && !nav.sheet) return [{ label: "Choose on the battle screen", off: "Just looking in battle" }];
  if (battle) {
    if (i === 0) return [{ label: "In battle now", off: "Already out" }];
    return [
      { label: `Send out ${niceMon(m.name)}`, note: "Uses your turn", off: m.hp === 0 ? "Fainted" : undefined, run: () => done(env, nav, actions.sendOut(i), true) },
      { label: "Use an item on it", alt: true, run: () => nav.go({ k: "bag", for: { onMon: i } }) },
    ];
  }
  const v: VerbSpec[] = [];
  if (i > 0) v.push({ label: "Make it the leader", run: () => (done(env, nav, actions.makeLeader(i)), nav.replace({ k: "mon", i: 0 })) });
  // The game's own CUT on what the player faces; the menu closes so the tree is seen to go, and
  // what the game says comes back as a notice (QA bug 69: this only ever said "nothing to cut").
  if (m.moves.some((x) => x.name === "CUT")) v.push({ label: "Use CUT", alt: true, run: () => done(env, nav, actions.cut(i), true) });
  for (const move of FIELD_MOVES) if (m.moves.some((x) => x.name === move)) v.push(fieldVerb(env, nav, i, move));
  v.push({ label: "Use an item on it", alt: true, run: () => nav.go({ k: "bag", for: { onMon: i } }) });
  return v;
}

/** StartMenu_Pokemon's field moves after CUT, in its order. */
const FIELD_MOVES: FieldMove[] = ["FLY", "SURF", "STRENGTH", "FLASH", "DIG", "TELEPORT", "SOFTBOILED"];
/** The badge each needs (StartMenu_Pokemon's checks): its index in the model's badges, and its name. */
const FIELD_BADGE: Partial<Record<FieldMove, [number, string]>> = { FLASH: [0, "Boulder Badge"], FLY: [2, "Thunder Badge"], STRENGTH: [3, "Rainbow Badge"], SURF: [4, "Soul Badge"] };

/**
 * A field move from the team screen. The menu closes so what it does is seen, and what the game
 * says comes back as a notice; the game's own checks decide (no water ahead, a dungeon for DIG).
 * Only what the menu can tell for sure is greyed out first: a missing badge, FLY and TELEPORT indoors.
 */
function fieldVerb(env: MenuEnv, nav: Nav, i: number, move: FieldMove): VerbSpec {
  const { model, actions } = env;
  const m = model.team[i]!;
  const badge = FIELD_BADGE[move];
  const needs = badge && !model.trainer.badges[badge[0]] ? `Needs the ${badge[1]}` : undefined;
  const act = () => done(env, nav, actions.fieldMove(i, move), true);
  switch (move) {
    case "FLY":
      return { label: "Fly somewhere", alt: true, off: needs ?? (model.field.outside ? undefined : "Only outside"), run: () => nav.go({ k: "fly", mon: i }) };
    case "SURF":
      return { label: model.surfing ? "Stop surfing" : "Use SURF", note: model.surfing ? "Face the land first" : "Face the water first", alt: true, off: needs, run: act };
    case "STRENGTH":
      return { label: "Use STRENGTH", note: "Then push boulders", alt: true, off: needs, run: act };
    case "FLASH":
      return { label: "Use FLASH", note: "Lights up dark caves", alt: true, off: needs, run: act };
    case "DIG":
      return { label: "Use DIG", note: "Back to the last Pokémon Center", alt: true, off: model.field.escapeRope ? undefined : "Only in caves and dungeons", run: act };
    case "TELEPORT":
      return { label: "Use TELEPORT", note: "Back to the last Pokémon Center", alt: true, off: model.field.outside ? undefined : "Only outside", run: act };
    case "SOFTBOILED":
      return { label: "Use SOFTBOILED on…", note: "Gives a fifth of its HP", alt: true, off: m.hp * 5 <= m.maxHp ? "Not healthy enough" : undefined, run: () => nav.go({ k: "team", for: { softboiled: i } }) };
  }
}

/** What the Mart buys back: not key items (IsKeyItem) nor HMs (IsItemHM, priceless), only what has a price. */
export const sellable = (it: Item) => it.kind !== "Key" && !!it.sell && !(it.id >= ID.HM01 && it.id < ID.TM01);

export function itemVerbs(env: MenuEnv, nav: Nav, it: Item, purpose?: Purpose): VerbSpec[] {
  const { model, moment, actions } = env;
  const battle = inBattle(moment);
  // Run out of (the journal's past items, count 0). Not "no count": key items have none, and the
  // ones shelved under Travel (BICYCLE, the rods, ITEMFINDER, POKé FLUTE) were taken for run out
  // and offered nothing (QA bug 72).
  if (it.count === 0 && !isMachine(it)) return [];
  if (moment === "shop" && nav.sheet)
    return sellable(it) ? [{ label: "Sell some", note: `₽${it.sell!.toLocaleString("en")} each`, run: () => nav.replace({ k: "sell", id: it.id }) }] : [{ label: "Can't sell this", off: "Important" }];
  if (purpose && "giftTo" in purpose) {
    const f = model.friends.find((x) => x.id === purpose.giftTo)!;
    return it.kind === "Key" ? [{ label: "Can't send this", off: "Important" }] : [{ label: `Send one to ${f.name}`, run: () => (done(env, nav, actions.gift(f.id, { item: it.id })), nav.reset({ k: "friend", id: f.id })) }];
  }
  if (purpose && "onMon" in purpose) {
    const m = model.team[purpose.onMon]!;
    return onMon(it) ? [{ label: `Use on ${niceMon(m.name)}`, note: battle && !notNow(it, battle) ? "Uses your turn" : undefined, off: notNow(it, battle), run: () => (done(env, nav, actions.useItem(it.id, purpose.onMon), battle), battle || nav.reset({ k: "mon", i: purpose.onMon })) }] : [{ label: "Not for Pokémon", off: "—" }];
  }
  if (battle && !nav.sheet) return [{ label: "Choose on the battle screen", off: "Just looking in battle" }];
  if (onMon(it)) return [{ label: "Use it on…", note: battle && !notNow(it, battle) ? "Uses your turn" : undefined, off: notNow(it, battle), run: () => nav.go({ k: "team", for: { use: it.id } }) }];
  if (it.kind === "Balls")
    return battle ? [{ label: "Throw it", note: moment === "trainer" ? "The trainer will block it" : "Uses your turn", run: () => done(env, nav, actions.throwBall(it.id), true) }] : [{ label: "Throw it", off: "In a wild battle" }];
  // The battle items (X ATTACK, GUARD SPEC., DIRE HIT, POKé DOLL…): the game says "not the time"
  // outside one; in one, the battle's bag uses them, a turn's worth.
  if (it.kind === "Battle")
    return battle ? [{ label: "Use it", note: it.id === ID.POKE_DOLL && moment === "trainer" ? "Only gets you out of wild battles" : "Uses your turn", run: () => done(env, nav, actions.useItem(it.id), true) }] : [{ label: "Use it", off: "Only in battle" }];
  const field = FIELD_USE[it.id];
  if (field) return battle ? [{ label: field.label, off: "Not in battle" }] : [{ label: field.label, note: field.note, run: () => done(env, nav, actions.useItem(it.id), field.close) }];
  if (REPELS.has(it.id)) return battle ? [{ label: "Use it", off: "Not in battle" }] : [{ label: model.repel ? `Use it (${model.repel} steps left)` : "Use it", run: () => done(env, nav, actions.useItem(it.id), true) }];
  // ItemUseEscapeRope: only where the map's tileset is in EscapeRopeTilesets (caves, forests,
  // buildings like Silph Co.), never in a battle or Agatha's room.
  if (it.id === ID.ESCAPE_ROPE)
    return battle ? [{ label: "Use it", off: "Not in battle" }] : model.field.escapeRope ? [{ label: "Use it", note: "Back to the last Pokémon Center", run: () => done(env, nav, actions.useItem(it.id), true) }] : [{ label: "Use it", off: "Only in caves and dungeons" }];
  // ItemUseBicycle: getting off works anywhere; getting on only where IsBikeRidingAllowed says, not surfing.
  if (it.id === ID.BICYCLE)
    return battle ? [{ label: "Ride it", off: "Not in battle" }] : model.biking ? [{ label: "Get off", run: () => done(env, nav, actions.useItem(it.id), true) }] : [{ label: "Ride it", off: model.field.bike ? undefined : "No cycling here", run: () => done(env, nav, actions.useItem(it.id), true) }];
  if (isMachine(it)) return battle ? [{ label: "Teach it to…", off: "Not in battle" }] : [{ label: "Teach it to…", run: () => nav.go({ k: "team", for: { teach: it.id } }) }];
  if (it.id === ID.TOWN_MAP) return [{ label: "Open the map", run: () => nav.tab("map") }];
  return [];
}
