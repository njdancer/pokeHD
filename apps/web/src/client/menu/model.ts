// What the Pokédex menu shows and what it can ask the game to do (p2-menu). The design page
// (/dev/menu) fills these from sample data; the real build fills them from WRAM, the journal and
// the room, and answers `MenuActions` through the FFI hooks (handoff: dex-menu/handoff.md).

/** What the game is doing while the menu is up: decides which actions are offered. */
export type Moment = "explore" | "talk" | "wild" | "trainer" | "fainted" | "pc" | "shop";

/** The field moves besides CUT that a Pokémon can use from the team screen (the game's StartMenu_Pokemon). */
export type FieldMove = "FLY" | "SURF" | "STRENGTH" | "FLASH" | "DIG" | "TELEPORT" | "SOFTBOILED";

export const inBattle = (m: Moment) => m === "wild" || m === "trainer" || m === "fainted";

/**
 * Which of the team is out in battle: the game's own index (wPlayerMonNumber) when it's known,
 * else the leader, which is who a battle starts with (QA bug 58).
 */
export const battleMonOf = (model: Pick<MenuModel, "team" | "battleMon">): number => (model.battleMon !== undefined && model.battleMon < model.team.length ? model.battleMon : 0);

export type Status = "PSN" | "BRN" | "SLP" | "PAR" | "FRZ";

export interface Move {
  name: string;
  /** The move's type, for its colour. */
  type: string;
  pp: number;
  maxPp: number;
}

/** A Pokémon in the party or a box. */
export interface Mon {
  /** Stable while it stays in the party, for React keys and drag and drop. */
  key: string;
  dex: number;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  status?: Status;
  moves: Move[];
}

/** "Boosts": used on a Pokémon but not medicine (evolution stones, vitamins, RARE CANDY, PP UP). */
export type ItemKind = "Healing" | "Boosts" | "Balls" | "Travel" | "Battle" | "Machines" | "Key";
export const ITEM_KINDS: ItemKind[] = ["Healing", "Boosts", "Balls", "Travel", "Battle", "Machines", "Key"];

/** Something in the bag, or something the player once had (`count` 0). */
export interface Item {
  /** The game's item ID. */
  id: number;
  name: string;
  kind: ItemKind;
  /** Undefined for key items, which never run out. */
  count?: number;
  /** "Cut" for HM01. */
  sub?: string;
  /** Plain words a child can follow. */
  text: string;
  /** Where to buy it, where it was found: encyclopedia facts, from the journal and ROM. */
  buy?: string;
  found?: string;
  /** The game's own price (GetItemPrice), for a sale's sum; none for things the Mart won't take. */
  price?: number;
  /** Half the price, as the Mart pays. */
  sell?: number;
  /** Once owned, now used up or handed over. */
  gone?: string;
  /** A place to show on the map. */
  place?: string;
}

export interface Friend {
  id: string;
  name: string;
  online: boolean;
  where: string;
  colour: string;
  /** A gift waiting from them. */
  gift?: string;
}

export type PersonKind = "Leader" | "Trainer" | "Helper" | "Townsfolk";

/** Someone met in the game (journal), named and pictured from the ROM. */
export interface Person {
  key: string;
  name: string;
  kind: PersonKind;
  place: string;
  /** "Beaten", "Not beaten yet", "Met". */
  status: string;
  beaten?: boolean;
  /** What they said the first time, as the text box showed it. */
  said?: string;
  /** What they did for you, in a line. */
  note?: string;
  /** A trainer class's battle picture, or an overworld sprite. */
  picture: { trainer: number } | { sprite: number };
}

export interface Stat {
  value: string;
  label: string;
  sub?: string;
}

export interface First {
  title: string;
  text: string;
  when: string;
  place: string;
  dex?: number;
}

export interface Checkpoint {
  place: string;
  when: string;
}

export interface GameOptions {
  speed: "Fast" | "Medium" | "Slow";
  animations: boolean;
  style: "Shift" | "Set";
}

export interface AppOptions {
  sound: boolean;
  readAloud: boolean;
  gameBoyScreen: boolean;
}

export interface Trainer {
  name: string;
  id: number;
  money: number;
  played: string;
  badges: boolean[];
}

/** What the Map tab's layers show, from the journal: where things happened, in steps on a map. */
export interface MapLayers {
  encounters: { dex: number; map: string; x: number; y: number; how: "caught" | "seen" | "battled"; text: string; today?: boolean }[];
  finds: { item: string; map: string; x: number; y: number; text: string; today?: boolean }[];
  checkpoints: { place: string; map: string; x: number; y: number; when: string; today?: boolean }[];
  /** Friends playing now, by friend ID: their map's name and step. */
  friendsAt: Record<string, [map: string, x: number, y: number]>;
  /** Outdoor maps walked, in the order first visited; from `todayFrom` on, today. */
  trail: string[];
  todayFrom: number;
  /** Places (town map names) only partly explored. */
  partly: ReadonlySet<string>;
}

/** How a Pokémon grows: moves by level (0 = knows it from the start) and its evolution line. */
export interface Learns {
  moves: [name: string, level: number][];
  /** Pokédex numbers with how each step happens between them: [7, "Level 16", 8, …]. */
  grows: (number | string)[];
}

/** Everything the menu shows. */
export interface MenuModel {
  trainer: Trainer;
  team: Mon[];
  box: Mon[];
  bag: Item[];
  /** Items had once and run out of (journal). */
  past: Item[];
  seen: ReadonlySet<number>;
  owned: ReadonlySet<number>;
  /** Not caught, but the game is showing their full page (Oak's starters): shown in full too. */
  onShow?: ReadonlySet<number>;
  people: Person[];
  friends: Friend[];
  /** Places visited (town map names), for the map's fog and the Index. */
  visited: ReadonlySet<string>;
  /** Where the player is now. */
  here: { place: string; map: number; x: number; y: number };
  stats: Stat[];
  firsts: First[];
  checkpoints: Checkpoint[];
  savedAgo: string;
  options: GameOptions;
  app: AppOptions;
  /** The battle opponent, in a battle. */
  enemy?: { dex: number; name: string; level: number; trainer?: string };
  /** In a battle, which of the team is out (its index): not always the leader (QA bug 58). */
  battleMon?: number;
  /** Steps of Repel left. */
  repel: number;
  biking: boolean;
  surfing: boolean;
  /** What the game's own checks allow where the player stands (see items.ts). */
  field: {
    /** An Escape Rope works here (ItemUseEscapeRope). */
    escapeRope: boolean;
    /** The game lets the player get on the bike here (IsBikeRidingAllowed, and not surfing). */
    bike: boolean;
    /** Outside, where FLY and TELEPORT work (CheckIfInOutsideMap: a town, a route, the plateau). */
    outside: boolean;
    /** The towns FLY can go to: those visited (wTownVisitedFlag), by town map. */
    flyTo: { map: number; name: string }[];
  };
  layers: MapLayers;
  learns(dex: number): Learns | undefined;
  /** Whether this Pokémon can learn the TM or HM (the ROM's flags in the real game). */
  canLearn(dex: number, item: number): boolean;
}

/**
 * What the menu asks of the game. Each one is a game routine called at a safe point (or the
 * answer to the game's own menu routine), never button presses. Returns a line to show the player.
 */
export interface MenuActions {
  useItem(item: number, mon?: number): string;
  makeLeader(mon: number): string;
  moveMon(from: number, to: number): void;
  moveMove(mon: number, from: number, to: number): void;
  moveItem(from: number, to: number): void;
  sendOut(mon: number): string;
  throwBall(item: number): string;
  teach(item: number, mon: number): string;
  /** The field move CUT by this Pokémon, on what the player faces (the game's UsedCut). */
  cut(mon: number): string;
  /** Another field move by this Pokémon (StartMenu_Pokemon's branch): FLY to a town map, SOFTBOILED onto a team member. */
  fieldMove(mon: number, move: FieldMove, on?: { to?: number; target?: number }): string;
  deposit(mon: number): string;
  withdraw(box: number): string;
  buy(item: number, count: number): string;
  sell(item: number, count: number): string;
  gift(friend: string, what: { item: number } | { mon: number }): string;
  ask(friend: string, what: "trade" | "battle"): string;
  save(): string;
  setOption<K extends keyof GameOptions>(key: K, value: GameOptions[K]): void;
  setApp<K extends keyof AppOptions>(key: K, value: AppOptions[K]): void;
  goBack(checkpoint: number): string;
  /** Ends a game request (PC, Mart, battle Team/Bag) without choosing: the game's own Cancel. */
  cancel(): void;
}

/** A game request answered by a sheet over the game, not the dex. */
export type Request =
  | { kind: "battle-team" }
  | { kind: "battle-bag" }
  | { kind: "fainted" }
  | { kind: "deposit" }
  | { kind: "withdraw" }
  | { kind: "buy"; stock: { id: number; name: string; price: number; kind: ItemKind }[] }
  | { kind: "sell" }
  /** Proposals at /dev/menu: the Mart's and Bill's PC's whole visit as one sheet (Counters.tsx). */
  | { kind: "mart"; stock: { id: number; name: string; price: number; kind: ItemKind }[]; look: "menu" | "tabs" }
  | { kind: "pc"; look: "menu" | "tabs" };
