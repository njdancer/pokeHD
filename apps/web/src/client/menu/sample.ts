// A sample adventure for the design page: RED in Vermilion City with two badges, the same story
// as the clickable prototype. Names, pictures and Pokédex words still come from the ROM.
import { SPRITE_NAMES, type TrainerClass } from "@pokehd/rom";
import type { Item, MapLayers, MenuModel, Mon, Person } from "./model.ts";

const sprite = (name: string) => ({ sprite: SPRITE_NAMES.indexOf(name) });

function mon(key: string, dex: number, name: string, level: number, hp: number, maxHp: number, moves: [string, string, number][], status?: Mon["status"]): Mon {
  return { key, dex, name, level, hp, maxHp, status, moves: moves.map(([n, type, pp]) => ({ name: n, type, pp, maxPp: pp })) };
}

export const SAMPLE_BAG: Item[] = [
  { id: 0x14, name: "POTION", kind: "Healing", count: 3, sell: 150, text: "Gives one Pokémon 20 HP back.", buy: "₽300 at most Poké Marts", found: "Also lying around on routes" },
  { id: 0x0b, name: "ANTIDOTE", kind: "Healing", count: 1, sell: 50, text: "Cures a Pokémon of poison.", buy: "₽100 at most Poké Marts" },
  { id: 0x04, name: "POKé BALL", kind: "Balls", count: 5, sell: 100, text: "Throw it at a wild Pokémon to catch it. It works better when the Pokémon is weak.", buy: "₽200 at every Poké Mart" },
  { id: 0x1e, name: "REPEL", kind: "Travel", count: 2, sell: 175, text: "Wild Pokémon weaker than your leader stay away for 100 steps.", buy: "₽350 at most Poké Marts" },
  { id: 0x1d, name: "ESCAPE ROPE", kind: "Travel", count: 1, sell: 275, text: "Takes you straight out of a cave.", buy: "₽550 at Poké Marts" },
  { id: 0x06, name: "BICYCLE", kind: "Key", text: "Twice as fast as walking. You can't ride it indoors.", found: "Cerulean Bike Shop, for the BIKE VOUCHER", place: "Cerulean City" },
  { id: 0xc4, name: "HM01", sub: "CUT", kind: "Machines", text: "Teaches CUT, which chops down small trees. It never runs out.", found: "From the S.S. ANNE's captain", place: "Vermilion City" },
  { id: 0x05, name: "TOWN MAP", kind: "Key", text: "Shows the whole region. The Map tab does it better!", found: "From DAISY in Pallet Town", place: "Pallet Town" },
];

export const SAMPLE_PAST: Item[] = [
  { id: 0x46, name: "OAK's PARCEL", kind: "Key", count: 0, text: "A delivery for PROF. OAK.", found: "From the Viridian Poké Mart", gone: "Delivered", place: "Viridian City" },
  { id: 0x3f, name: "S.S.TICKET", kind: "Key", count: 0, text: "Lets you onto the S.S. ANNE.", found: "From BILL on Route 25", gone: "Used", place: "Route 25" },
  { id: 0x2d, name: "BIKE VOUCHER", kind: "Key", count: 0, text: "Swap it for a BICYCLE.", found: "From the Fan Club CHAIRMAN", gone: "Swapped", place: "Vermilion City" },
  { id: 0x13, name: "SUPER POTION", kind: "Healing", count: 0, sell: 350, text: "Gives one Pokémon 50 HP back.", buy: "₽700 at the Vermilion Poké Mart", gone: "None left" },
];

/** Moves by level and how it grows, for the sample team (from the ROM in the real build). */
export const SAMPLE_LEARNS: Record<number, { moves: [string, number][]; grows: (number | string)[] }> = {
  8: { moves: [["Tackle", 0], ["Tail Whip", 0], ["Bubble", 8], ["Water Gun", 15], ["Bite", 24], ["Withdraw", 31], ["Skull Bash", 39], ["Hydro Pump", 47]], grows: [7, "Level 16", 8, "Level 36", 9] },
  16: { moves: [["Gust", 0], ["Sand-Attack", 5], ["Quick Attack", 12], ["Whirlwind", 19], ["Wing Attack", 24], ["Agility", 31], ["Mirror Move", 40]], grows: [16, "Level 18", 17, "Level 36", 18] },
  25: { moves: [["ThunderShock", 0], ["Growl", 0], ["Thunder Wave", 9], ["Quick Attack", 16], ["Swift", 26], ["Agility", 33], ["Thunder", 43]], grows: [25, "Thunder Stone", 26] },
  32: { moves: [["Leer", 0], ["Tackle", 0], ["Horn Attack", 8], ["Double Kick", 12], ["Poison Sting", 17], ["Focus Energy", 23], ["Fury Attack", 30], ["Horn Drill", 38]], grows: [32, "Level 16", 33, "Moon Stone", 34] },
};

/** Journal samples for the layers: where things happened, in steps on a map. */
const ENCOUNTERS: { dex: number; map: string; x: number; y: number; how: "caught" | "seen" | "battled"; text: string; today?: boolean }[] = [
  { dex: 7, map: "PALLET_TOWN", x: 12, y: 12, how: "caught", text: "Your first partner, from PROF. OAK" },
  { dex: 16, map: "ROUTE_1", x: 10, y: 24, how: "caught", text: "Caught at level 3" },
  { dex: 19, map: "ROUTE_1", x: 6, y: 12, how: "caught", text: "Caught at level 4" },
  { dex: 32, map: "ROUTE_22", x: 14, y: 8, how: "caught", text: "Caught at level 4" },
  { dex: 13, map: "ROUTE_2", x: 4, y: 50, how: "seen", text: "Seen near Viridian Forest" },
  { dex: 95, map: "PEWTER_CITY", x: 16, y: 18, how: "battled", text: "BROCK's ONIX. Beaten" },
  { dex: 21, map: "ROUTE_3", x: 20, y: 6, how: "seen", text: "Seen 6 times" },
  { dex: 39, map: "ROUTE_3", x: 40, y: 10, how: "seen", text: "Seen twice" },
  { dex: 27, map: "ROUTE_4", x: 30, y: 8, how: "caught", text: "Caught at level 9" },
  { dex: 121, map: "CERULEAN_CITY", x: 30, y: 20, how: "battled", text: "MISTY's STARMIE. Beaten" },
  { dex: 63, map: "ROUTE_24", x: 10, y: 20, how: "seen", text: "Seen once. It teleported away" },
  { dex: 69, map: "ROUTE_25", x: 20, y: 6, how: "seen", text: "Seen 3 times" },
  { dex: 17, map: "ROUTE_6", x: 10, y: 20, how: "battled", text: "A trainer's PIDGEOTTO", today: true },
  { dex: 96, map: "ROUTE_11", x: 8, y: 8, how: "seen", text: "Seen just now", today: true },
];
const FINDS: { item: string; map: string; x: number; y: number; text: string; today?: boolean }[] = [
  { item: "POTION", map: "ROUTE_1", x: 12, y: 30, text: "Lying on Route 1" },
  { item: "TOWN MAP", map: "PALLET_TOWN", x: 4, y: 5, text: "From DAISY" },
  { item: "HM01", map: "VERMILION_CITY", x: 18, y: 30, text: "From the S.S. ANNE's captain", today: true },
  { item: "BICYCLE", map: "CERULEAN_CITY", x: 13, y: 26, text: "Cerulean Bike Shop", today: true },
];
const CHECKPOINTS: { place: string; map: string; x: number; y: number; when: string; today?: boolean }[] = [
  { place: "Vermilion City", map: "VERMILION_CITY", x: 11, y: 4, when: "10 minutes ago", today: true },
  { place: "Cerulean City", map: "CERULEAN_CITY", x: 19, y: 18, when: "1 hour ago", today: true },
  { place: "Pewter City", map: "PEWTER_CITY", x: 13, y: 26, when: "Yesterday" },
];
const FRIEND_AT: Record<string, [string, number, number]> = { nick: ["CELADON_CITY", 20, 12], sam: ["ROUTE_3", 30, 8] };
const TRAIL = ["PALLET_TOWN", "ROUTE_1", "VIRIDIAN_CITY", "ROUTE_2", "PEWTER_CITY", "ROUTE_3", "ROUTE_4", "CERULEAN_CITY", "ROUTE_5", "ROUTE_6", "VERMILION_CITY"];
const TODAY_FROM = 7;

const SAMPLE_LAYERS: MapLayers = {
  encounters: ENCOUNTERS,
  finds: FINDS,
  checkpoints: CHECKPOINTS,
  friendsAt: FRIEND_AT,
  trail: TRAIL,
  todayFrom: TODAY_FROM,
  partly: new Set(["ROUTE 11"]),
};

export function sampleModel(trainers: readonly TrainerClass[]): MenuModel {
  const trainer = (name: string) => ({ trainer: trainers.findIndex((t) => t.name === name) + 1 });
  const people: Person[] = [
    { key: "oak", name: "Prof. Oak", kind: "Helper", place: "Pallet Town", status: "Met", picture: trainer("PROF.OAK"), said: "Now, RED, which POKéMON do you want?", note: "Gave you SQUIRTLE and this POKéDEX." },
    { key: "mom", name: "Mom", kind: "Helper", place: "Pallet Town", status: "Met", picture: sprite("MOM"), said: "Right. All boys leave home some day.", note: "Heals your team whenever you visit home." },
    { key: "daisy", name: "Daisy", kind: "Helper", place: "Pallet Town", status: "Met", picture: sprite("DAISY"), note: "Your rival's sister. Gave you the TOWN MAP." },
    { key: "brock", name: "Brock", kind: "Leader", place: "Pewter City", status: "Beaten", beaten: true, picture: trainer("BROCK"), said: "I'm BROCK! I'm PEWTER's GYM LEADER!", note: "Rock Pokémon: GEODUDE and ONIX. Gave you the BOULDERBADGE." },
    { key: "misty", name: "Misty", kind: "Leader", place: "Cerulean City", status: "Beaten", beaten: true, picture: trainer("MISTY"), said: "Hi, you're a new face!", note: "Water Pokémon: STARYU and STARMIE. Gave you the CASCADEBADGE." },
    { key: "surge", name: "Lt. Surge", kind: "Leader", place: "Vermilion City", status: "Not beaten yet", picture: trainer("LT.SURGE"), note: "Electric Pokémon. A small tree blocks his gym: CUT it down." },
    { key: "nurse", name: "Nurse Joy", kind: "Helper", place: "Vermilion City", status: "Met", picture: sprite("NURSE"), said: "Welcome to our POKéMON CENTER!", note: "In every Pokémon Center. Heals your team for free." },
    { key: "sailor", name: "Sailor", kind: "Townsfolk", place: "Vermilion City", status: "Met just now", picture: sprite("SAILOR"), said: "The ship's leaving soon. Better hurry!" },
    { key: "bug", name: "Bug Catcher", kind: "Trainer", place: "Route 3", status: "Beaten", beaten: true, picture: trainer("BUG CATCHER"), said: "Hey! You have POKéMON! Come on! Let's battle 'em!" },
    { key: "lass", name: "Lass", kind: "Trainer", place: "Route 3", status: "Beaten", beaten: true, picture: trainer("LASS"), said: "Eek! Did you touch me?" },
    { key: "bill", name: "Bill", kind: "Helper", place: "Route 25", status: "Met", picture: sprite("SUPER_NERD"), note: "Turned into a Pokémon by accident. You helped! Gave you an S.S.TICKET." },
  ];
  return {
    trainer: { name: "RED", id: 31415, money: 3410, played: "6:42", badges: [true, true, false, false, false, false, false, false] },
    team: [
      mon("a", 8, "WARTORTLE", 18, 41, 56, [["TACKLE", "NORMAL", 35], ["TAIL WHIP", "NORMAL", 30], ["BUBBLE", "WATER", 30], ["WATER GUN", "WATER", 25]]),
      mon("b", 16, "PIDGEY", 16, 44, 46, [["GUST", "NORMAL", 35], ["SAND-ATTACK", "NORMAL", 15], ["QUICK ATTACK", "NORMAL", 30]]),
      mon("c", 25, "PIKACHU", 12, 9, 33, [["THUNDERSHOCK", "ELECTRIC", 30], ["GROWL", "NORMAL", 40], ["THUNDER WAVE", "ELECTRIC", 20]], "PSN"),
      mon("d", 32, "NIDORAN♂", 14, 38, 38, [["LEER", "NORMAL", 30], ["TACKLE", "NORMAL", 35], ["HORN ATTACK", "NORMAL", 25], ["DOUBLE KICK", "FIGHTING", 30]]),
    ],
    box: [mon("e", 19, "RATTATA", 6, 21, 21, []), mon("f", 74, "GEODUDE", 10, 30, 30, []), mon("g", 129, "MAGIKARP", 5, 18, 18, []), mon("h", 27, "SANDSHREW", 9, 28, 28, [])],
    bag: SAMPLE_BAG.map((b) => ({ ...b })),
    past: SAMPLE_PAST,
    seen: new Set([1, 7, 8, 10, 11, 12, 13, 16, 17, 19, 21, 25, 27, 32, 35, 39, 41, 56, 63, 66, 69, 74, 95, 96, 120, 121, 129]),
    owned: new Set([7, 8, 10, 16, 19, 25, 27, 32, 74, 129]),
    people,
    friends: [
      { id: "nick", name: "Nick", online: true, where: "Celadon City", colour: "#8e5bb5", gift: "a POTION" },
      { id: "sam", name: "Sam", online: true, where: "Route 3", colour: "#2c8fd6" },
      { id: "gran", name: "Gran", online: false, where: "Played yesterday", colour: "#d0703a" },
    ],
    visited: new Set(["PALLET TOWN", "ROUTE 1", "VIRIDIAN CITY", "ROUTE 22", "ROUTE 2", "VIRIDIAN FOREST", "PEWTER CITY", "ROUTE 3", "MT.MOON", "ROUTE 4", "CERULEAN CITY", "ROUTE 24", "ROUTE 25", "ROUTE 5", "UNDERGROUND PATH", "ROUTE 6", "VERMILION CITY", "ROUTE 11"]),
    here: { place: "VERMILION CITY", map: 5, x: 11, y: 9 },
    stats: [
      { value: "6:42", label: "Played", sub: "over 9 days" },
      { value: "18,204", label: "Steps", sub: "about 9 km" },
      { value: "47", label: "Battles won", sub: "3 lost · ran from 12" },
      { value: "10", label: "Caught", sub: "27 seen" },
      { value: "₽9,850", label: "Earned", sub: "₽6,440 spent" },
      { value: "2 of 8", label: "Badges", sub: "next: LT. SURGE" },
      { value: "31", label: "Wins by WARTORTLE", sub: "your star" },
      { value: "4", label: "Gifts", sub: "2 sent · 2 got" },
    ],
    firsts: [
      { title: "First Pokémon", text: "SQUIRTLE, from PROF. OAK", when: "Day 1", place: "Pallet Town", dex: 7 },
      { title: "First catch", text: "PIDGEY on Route 1", when: "Day 1", place: "Route 1", dex: 16 },
      { title: "First badge", text: "BOULDERBADGE from BROCK", when: "Day 3", place: "Pewter City" },
      { title: "First evolution", text: "SQUIRTLE grew into WARTORTLE", when: "Day 4", place: "Mt.Moon", dex: 8 },
      { title: "First gift", text: "A POTION from Nick", when: "Today", place: "Vermilion City" },
    ],
    checkpoints: [
      { place: "Vermilion City", when: "10 minutes ago" },
      { place: "Cerulean City", when: "1 hour ago" },
      { place: "Mt. Moon", when: "Yesterday" },
    ],
    savedAgo: "2 minutes ago",
    options: { speed: "Fast", animations: true, style: "Shift" },
    app: { sound: true, readAloud: true, gameBoyScreen: false },
    repel: 0,
    biking: false,
    layers: SAMPLE_LAYERS,
    learns: (dex) => SAMPLE_LEARNS[dex],
    canLearn: (dex, item) => item === 0xc4 && (dex === 32 || dex === 1 || dex === 69),
  };
}

export const SAMPLE_STOCK = [
  { id: 0x04, name: "POKé BALL", price: 200, kind: "Balls" as const },
  { id: 0x14, name: "POTION", price: 300, kind: "Healing" as const },
  { id: 0x13, name: "SUPER POTION", price: 700, kind: "Healing" as const },
  { id: 0x0d, name: "ICE HEAL", price: 250, kind: "Healing" as const },
  { id: 0x0e, name: "AWAKENING", price: 200, kind: "Healing" as const },
  { id: 0x1e, name: "REPEL", price: 350, kind: "Travel" as const },
];
