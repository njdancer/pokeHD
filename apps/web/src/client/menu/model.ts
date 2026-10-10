// What the Pokédex menu shows and what it can ask the game to do (p2-menu). The design page
// (/dev/menu) fills these from sample data; the real build fills them from WRAM, the journal and
// the room, and answers `MenuActions` through the FFI hooks (handoff: dex-menu/handoff.md).

/** What the game is doing while the menu is up: decides which actions are offered. */
export type Moment = "explore" | "talk" | "wild" | "trainer" | "fainted" | "pc" | "shop";

export const inBattle = (m: Moment) => m === "wild" || m === "trainer" || m === "fainted";

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

export type ItemKind = "Healing" | "Balls" | "Travel" | "Battle" | "Machines" | "Key";
export const ITEM_KINDS: ItemKind[] = ["Healing", "Balls", "Travel", "Battle", "Machines", "Key"];

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
  /** Steps of Repel left. */
  repel: number;
  biking: boolean;
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
  | { kind: "sell" };
