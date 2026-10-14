// What a Pokémon or an item can do right now, given the game's moment and why it was picked.
// The rules are the game's (balls only in wild battles, no bike indoors…); these only decide what
// to offer, the game's own routines still decide what happens.
import { inBattle, type Item, type Mon } from "./model.ts";
import { niceItem, niceMon, type MenuEnv } from "./env.tsx";
import type { Nav, Purpose } from "./nav.tsx";
import type { VerbSpec } from "./ui.tsx";

export const ID = { POKE_BALL: 4, TOWN_MAP: 5, BICYCLE: 6, ANTIDOTE: 0x0b, SUPER_POTION: 0x13, POTION: 0x14, ESCAPE_ROPE: 0x1d, REPEL: 0x1e, HM01: 0xc4 } as const;

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
  if (m.moves.some((x) => x.name === "CUT")) v.push({ label: "Use CUT", alt: true, run: () => done(env, nav, "There's nothing to cut here") });
  v.push({ label: "Use an item on it", alt: true, run: () => nav.go({ k: "bag", for: { onMon: i } }) });
  return v;
}

export function itemVerbs(env: MenuEnv, nav: Nav, it: Item, purpose?: Purpose, count = 1): VerbSpec[] {
  const { model, moment, actions } = env;
  const battle = inBattle(moment);
  if (!it.count && it.kind !== "Key" && !isMachine(it)) return [];
  if (moment === "shop" && nav.sheet)
    return it.kind === "Key" || !it.sell ? [{ label: "Can't sell this", off: "Important" }] : [{ label: `Sell ${count} for ₽${(it.sell * count).toLocaleString()}`, run: () => (done(env, nav, actions.sell(it.id, count)), nav.reset()) }];
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
  if (it.id === ID.REPEL) return battle ? [{ label: "Use it", off: "Not in battle" }] : [{ label: model.repel ? `Use it (${model.repel} steps left)` : "Use it", run: () => done(env, nav, actions.useItem(it.id), true) }];
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
