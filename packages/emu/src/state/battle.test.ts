import { existsSync, readFileSync } from "node:fs";
import { SYMBOLS } from "@pokehd/rom";
import { beforeAll, describe, expect, it } from "vitest";
import { Button, GameBoy } from "../core.ts";
import { playIntro } from "../testing.ts";
import { BattleDecoder, battleTransition, decodeBattleState, monStatus } from "./battle-decode.ts";
import { BATTLE_SCREEN_WATCHES, BattleScreenReader, type BattleScreen, type BattleScreenWatched } from "./battle-screen.ts";
import {
  BATTLE_STRUCT_LENGTH,
  BATTLE_WATCHES,
  PARTY_MON_LENGTH,
  type BattlePhase,
  type BattleState,
  type BattleWatched,
} from "./battle.ts";

const ROM_PATH = new URL("../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../generated/sameboy.wasm", import.meta.url);
const hasRom = existsSync(ROM_PATH);

// constants/pokemon_constants.asm, move_constants.asm and trainer_constants.asm
const BULBASAUR = 0x99;
const SQUIRTLE = 0xb1;
const TACKLE = 0x21;
const GROWL = 0x2d;
const TAIL_WHIP = 0x27;
const RIVAL1 = 0x19;
const PALLET_TOWN = 0x00;
const REDS_HOUSE_1F = 0x25;
const OAKS_LAB = 0x28;
const DOJO = 5; // TILESET_NAMES: Oak's lab uses the DOJO tileset

/** Zeroed watch buffers outside a battle, with no animation playing. */
function blank(): BattleWatched {
  const watched = {} as BattleWatched;
  for (const [name, [, length]] of Object.entries(BATTLE_WATCHES)) {
    watched[name as keyof BattleWatched] = new Uint8Array(length);
  }
  watched.animationSound[0] = 0xff;
  return watched;
}

/** A battle_struct: species, HP, status, level, max HP. */
function struct(species: number, hp: number, maxHp: number, status = 0): Uint8Array {
  const s = new Uint8Array(BATTLE_STRUCT_LENGTH);
  s[0] = species;
  s.set([hp >> 8, hp & 0xff], 1);
  s[4] = status;
  s[14] = 5;
  s.set([maxHp >> 8, maxHp & 0xff], 15);
  return s;
}

/** Writes a party's count and each member's HP and status. */
function party(block: Uint8Array, members: [hp: number, status?: number][]): void {
  block[0] = members.length;
  members.forEach(([hp, status = 0], i) => {
    const at = 8 + i * PARTY_MON_LENGTH;
    block.set([hp >> 8, hp & 0xff], at + 1);
    block[at + 4] = status;
  });
}

function trainerBattle(): BattleWatched {
  const w = blank();
  w.inBattle[0] = 2;
  w.opponent[0] = 200 + RIVAL1;
  w.playerMon.set(struct(SQUIRTLE, 20, 20));
  w.enemyMon.set(struct(BULBASAUR, 19, 20));
  party(w.playerParty, [[20]]);
  party(w.enemyParty, [[19], [0], [7, 1 << 6]]);
  return w;
}

describe("battleTransition", () => {
  it("is the way into a trainer battle once the opponent is set, before wIsInBattle", () => {
    const w = blank();
    expect(battleTransition(w)).toBeNull();
    w.opponent[0] = 200 + RIVAL1;
    expect(battleTransition(w)).toBe("in");
    w.inBattle[0] = 2;
    expect(battleTransition(w)).toBeNull();
  });

  it("leaves a link battle's versus screen alone", () => {
    const w = blank();
    w.opponent[0] = 200 + RIVAL1;
    w.linkState[0] = 4;
    expect(battleTransition(w)).toBeNull();
  });

  it("is the way out while the overworld reloads the map after a battle", () => {
    const w = blank();
    w.statusFlags4[0] = 1 << 5;
    expect(battleTransition(w)).toBe("out");
    w.statusFlags4[0] = ~(1 << 5) & 0xff;
    expect(battleTransition(w)).toBeNull();
  });
});

describe("decodeBattleState", () => {
  it("is null outside a battle", () => {
    expect(decodeBattleState(blank())).toBeNull();
  });

  it("decodes both sides and the teams", () => {
    const state = decodeBattleState(trainerBattle())!;
    expect(state).toMatchObject({ type: "trainer", trainerClass: RIVAL1, variant: "normal", outcome: null });
    expect(state.player.mon).toMatchObject({ species: SQUIRTLE, level: 5, hp: 20, maxHp: 20, status: "ok" });
    expect(state.enemy.mon).toMatchObject({ species: BULBASAUR, hp: 19 });
    expect(state.enemy.team).toEqual(["ok", "fainted", "status"]);
  });

  it("reads status bits", () => {
    expect([0, 3, 1 << 3, 1 << 4, 1 << 5, 1 << 6].map(monStatus)).toEqual([
      "ok",
      "sleep",
      "poison",
      "burn",
      "freeze",
      "paralysis",
    ]);
  });

  it("tells the phases apart", () => {
    const w = trainerBattle();
    const phase = () => decodeBattleState(w)!.phase;
    expect(phase()).toBe("message");
    w.tileMap[13 * 20 + 9] = 0xed; // ▶ by FIGHT
    expect(phase()).toBe("menu");
    w.animationId[0] = TACKLE;
    w.animationSound[0] = 0x49;
    expect(phase()).toBe("animation");
    expect(decodeBattleState(w)!.animation).toEqual({ id: TACKLE, isMove: true, by: "player" });
    w.animationSound[0] = 0xff;
    w.subanimation[0] = 0x68; // a silent subanimation
    expect(phase()).toBe("animation");
    w.subanimation[0] = 0;
    w.animationSound[0] = 0xff;
    w.enemyMon.set([0, 0], 1);
    expect(phase()).toBe("faint");
    party(w.enemyParty, [[0]]);
    expect(phase()).toBe("end");
    expect(decodeBattleState(w)!.outcome).toBe("win");
    w.firstMonsNotOutYet[0] = 1;
    expect(phase()).toBe("intro");
  });

  it("ends a wild battle when the wild Pokémon faints", () => {
    const w = trainerBattle();
    w.inBattle[0] = 1;
    w.enemyMon.set([0, 0], 1);
    expect(decodeBattleState(w)).toMatchObject({ type: "wild", phase: "end", outcome: "win", trainerClass: null });
    expect(decodeBattleState(w)!.enemy.team).toEqual([]);
  });

  it("reads a lost battle and a link battle", () => {
    const w = trainerBattle();
    w.inBattle[0] = 0xff;
    expect(decodeBattleState(w)).toMatchObject({ type: "trainer", outcome: "lose", phase: "end" });
    w.inBattle[0] = 2;
    w.linkState[0] = 4;
    expect(decodeBattleState(w)!.type).toBe("link");
  });
});

describe("BattleDecoder", () => {
  it("holds the intro from the transition until both Pokémon are out", () => {
    const d = new BattleDecoder();
    expect(d.decode(blank())).toBeNull();
    const w = trainerBattle();
    expect(d.decode(w)!.phase).toBe("intro"); // the transition, before StartBattle
    w.firstMonsNotOutYet[0] = 1;
    expect(d.decode(w)!.phase).toBe("intro");
    w.firstMonsNotOutYet[0] = 0;
    expect(d.decode(w)!.phase).toBe("message");
  });

  it("trusts the intro flag when it starts mid-battle", () => {
    expect(new BattleDecoder().decode(trainerBattle())!.phase).toBe("message");
    const w = trainerBattle();
    w.firstMonsNotOutYet[0] = 1;
    expect(new BattleDecoder().decode(w)!.phase).toBe("intro");
  });

  it("ignores the intro flag once the intro is over", () => {
    const d = new BattleDecoder();
    const w = trainerBattle();
    w.firstMonsNotOutYet[0] = 1;
    d.decode(blank());
    d.decode(w);
    w.firstMonsNotOutYet[0] = 0;
    expect(d.decode(w)!.phase).toBe("message");
    w.firstMonsNotOutYet[0] = 1; // the trainer AI switching Pokémon
    expect(d.decode(w)!.phase).toBe("message");
  });

  it("ignores wAnimSoundID until it has read $ff or changed", () => {
    const d = new BattleDecoder();
    const w = trainerBattle();
    w.animationId[0] = 1;
    w.animationSound[0] = 0; // power-on value
    expect(d.decode(w)).toMatchObject({ phase: "message", animation: null });
    expect(d.decode(w)!.animation).toBeNull();
    w.animationSound[0] = 0x49; // the first animation's first sound
    expect(d.decode(w)!.phase).toBe("animation");
  });
});

/** A move and both sides' HP once it has played out. */
interface Turn {
  by: "player" | "enemy";
  move: number;
  hp: [player: number, enemy: number];
}

describe.skipIf(!hasRom)("decoding the first rival battle", () => {
  let gb: GameBoy;
  const states: (BattleState | null)[] = [];
  /** The battle screen alongside each state, null outside the battle. */
  const screens: (BattleScreen | null)[] = [];
  /** battleTransition and whether the window is up, each frame from the rival's challenge on. */
  const between: { transition: ReturnType<typeof battleTransition>; window: boolean; inBattle: boolean }[] = [];

  const read = (name: keyof typeof SYMBOLS) => gb.read(SYMBOLS[name].address);
  const where = () => [read("wCurMap"), read("wXCoord"), read("wYCoord")];
  const frame = (buttons = 0) => {
    gb.setButtons(buttons);
    gb.runFrame();
  };
  /** A pulse of `button` every 8 frames, held for 2. */
  const mash = (i: number, button = Button.A) => frame(i % 8 < 2 ? button : 0);

  /** Holds `button` until `done` holds with the player standing still, then lets go. */
  function walk(button: number, done: (map: number, x: number, y: number) => boolean): void {
    for (let i = 0; !(done(...(where() as [number, number, number])) && read("wWalkCounter") === 0); i++) {
      if (i > 1200) throw new Error(`Stuck at ${where()}`);
      frame(button);
    }
    frame();
    frame();
  }

  /** Mashes A through text and scripts until the player has been free to move for `frames`. */
  function untilFree(frames = 60, limit = 20_000): void {
    const free = () => read("hWY") >= 144 && read("wJoyIgnore") === 0 && read("wWalkCounter") === 0;
    for (let i = 0, run = 0; run < frames; i++) {
      if (i > limit) throw new Error(`Never free at ${where()}`);
      frame(run === 0 && i % 8 < 2 ? Button.A : 0);
      run = free() ? run + 1 : 0;
    }
  }

  /** True when the screen shows YES (charmap $98 $84 $92). */
  function showsYes(): boolean {
    const tiles = gb.readBytes(SYMBOLS.wTileMap.address, 20 * 18);
    return tiles.some((t, i) => t === 0x98 && tiles[i + 1] === 0x84 && tiles[i + 2] === 0x92);
  }

  beforeAll(async () => {
    gb = await GameBoy.create({ rom: readFileSync(ROM_PATH), wasmBinary: readFileSync(WASM_PATH) });
    playIntro(gb);
    untilFree(10);
    // Red's room → downstairs → Pallet Town → the north edge, where Oak stops the player.
    walk(Button.Right, (_, x) => x === 5);
    walk(Button.Up, (_, __, y) => y === 1);
    walk(Button.Right, (map) => map === REDS_HOUSE_1F);
    walk(Button.Down, (_, __, y) => y === 7);
    walk(Button.Left, (_, x) => x === 3);
    walk(Button.Down, (map) => map === PALLET_TOWN);
    walk(Button.Right, (_, x) => x === 10);
    walk(Button.Up, () => read("hWY") < 144);
    untilFree(120);
    expect(where()).toEqual([OAKS_LAB, 5, 3]);
    // Squirtle's ball is on the table at (7, 3): yes to Squirtle, no to a nickname.
    walk(Button.Down, (_, __, y) => y === 4);
    walk(Button.Right, (_, x) => x === 7);
    for (let i = 0; i < 8; i++) frame(Button.Up);
    for (let i = 0, answers = 0; answers < 2; i++) {
      if (i > 3000) throw new Error("No yes/no prompt");
      if (!showsYes()) {
        mash(i);
        continue;
      }
      for (let f = 0; f < 10; f++) frame();
      for (let f = 0; f < 2; f++) frame(answers === 0 ? Button.A : Button.B);
      for (let f = 0; f < 30; f++) frame();
      answers++;
    }
    untilFree(120);
    expect(read("wPartyCount")).toBe(1);
    // The rival challenges the player on the way out, at y = 6. Mash A through the battle: the
    // battle menu, the move list and every text box all start on the first choice.
    walk(Button.Left, (_, x) => x === 5);
    const decoder = new BattleDecoder();
    const reader = new BattleScreenReader();
    const decode = () => {
      const watched = {} as BattleWatched;
      for (const [name, [address, length]] of Object.entries(BATTLE_WATCHES)) {
        watched[name as keyof BattleWatched] = gb.readBytes(address, length);
      }
      const state = decoder.decode(watched);
      between.push({ transition: battleTransition(watched), window: read("hWY") < 144, inBattle: watched.inBattle[0] !== 0 });
      states.push(state);
      const screen = { tileMap: watched.tileMap } as BattleScreenWatched;
      for (const [name, [address, length]] of Object.entries(BATTLE_SCREEN_WATCHES)) {
        screen[name as keyof typeof BATTLE_SCREEN_WATCHES] = gb.readBytes(address, length);
      }
      screens.push(state ? reader.read(screen) : null);
    };
    for (let i = 0; read("wIsInBattle") === 0; i++) {
      if (i > 3000) throw new Error("No battle");
      mash(i, i % 16 < 8 ? Button.A : Button.Down);
      decode();
    }
    for (let i = 0; states.at(-1) !== null; i++) {
      if (i > 10_000) throw new Error("The battle never ended");
      mash(i);
      decode();
    }
    // Back in the lab, until the window first goes down.
    for (let i = 0; between.at(-1)!.window; i++) {
      if (i > 600) throw new Error("The map never came back");
      frame();
      decode();
    }
  }, 120_000);

  const battle = () => states.filter((s) => s !== null);
  /** The phases in order, with repeats collapsed. */
  const phases = () =>
    battle()
      .map((s) => s.phase)
      .filter((p, i, all) => p !== all[i - 1]);

  it("starts as a trainer battle against the rival in Oak's lab", () => {
    expect(states.findIndex((s) => s !== null)).toBeGreaterThan(0);
    expect(battle()[0]).toMatchObject({
      type: "trainer",
      variant: "normal",
      trainerClass: RIVAL1,
      phase: "intro",
      arena: { mapId: OAKS_LAB, tileset: DOJO, onWater: false },
    });
  });

  it("tells the trainer transition and the way back from the rest of the overworld", () => {
    const start = between.findIndex((f) => f.inBattle);
    const end = between.findLastIndex((f) => f.inBattle) + 1;
    // The spiral runs with the window up, between the rival's words and wIsInBattle.
    const into = between.slice(0, start);
    const spiral = into.findLastIndex((f) => f.transition !== "in") + 1;
    expect(start - spiral).toBeGreaterThan(60);
    expect(into.slice(spiral).some((f) => f.window)).toBe(true);
    // Before it, the rival's words: no transition while his text box is up.
    expect(into.slice(0, spiral).every((f) => f.transition === null)).toBe(true);
    expect(between.slice(start, end).every((f) => f.transition === null)).toBe(true);
    // Out: every frame from the end of the battle until the window goes down.
    const out = between.slice(end);
    expect(out.length).toBeGreaterThan(5);
    expect(out.slice(0, -1).every((f) => f.transition === "out")).toBe(true);
  });

  it("decodes both first Pokémon once the intro is over", () => {
    const first = battle().find((s) => s.phase !== "intro")!;
    expect(first.player).toMatchObject({
      mon: { species: SQUIRTLE, level: 5, hp: 20, maxHp: 20, status: "ok", moves: [TACKLE, TAIL_WHIP, 0, 0] },
      team: ["ok"],
    });
    expect(first.enemy).toMatchObject({
      mon: { species: BULBASAUR, level: 5, hp: 20, maxHp: 20, status: "ok", moves: [TACKLE, GROWL, 0, 0] },
      team: ["ok"],
    });
  });

  it("plays the send-out animations during the intro", () => {
    const intro = battle().filter((s) => s.phase === "intro");
    const animations = new Set(intro.flatMap((s) => (s.animation ? [s.animation.id] : [])));
    expect(animations.size).toBeGreaterThan(0);
    for (const id of animations) expect(id).toBeGreaterThan(0xa5);
  });

  it("goes from the intro through menus, moves and a faint to the end", () => {
    const seq = phases();
    expect(seq[0]).toBe("intro");
    expect(seq.slice(1)).not.toContain("intro");
    expect(seq.slice(-2)).toEqual(["faint", "end"]);
    expect(seq.filter((p) => p === "end")).toHaveLength(1);
    const middle = new Set<BattlePhase>(seq.slice(1, -2));
    expect(middle).toEqual(new Set(["menu", "message", "animation"]));
    expect(battle().at(-1)).toMatchObject({ outcome: "win", enemy: { mon: { hp: 0 }, team: ["fainted"] } });
  });

  it("reads the battle screen: both pictures and HUDs at the menu, sprites as Pokémon come out", () => {
    const atMenu = states.flatMap((s, i) => (s?.phase === "menu" ? [screens[i]!] : []));
    expect(atMenu.length).toBeGreaterThan(0);
    for (const screen of atMenu) {
      expect(screen).toMatchObject({ battle: true, huds: { enemy: true, player: true } });
      expect(screen.enemy && screen.player).toBeTruthy();
    }
    const intro = states.flatMap((s, i) => (s?.phase === "intro" ? [screens[i]!] : []));
    expect(intro.some((screen) => screen.objects.length > 0)).toBe(true);
    // Once shown, the battle screen stays the battle screen: no full-screen menu in this battle.
    const shown = screens.filter((screen) => screen !== null);
    expect(shown.slice(shown.findIndex((screen) => screen.battle)).every((screen) => screen.battle)).toBe(true);
    // The player's trainer slides away before the Pokémon comes out.
    expect(intro.some((screen) => screen.player && screen.player.dx < 0)).toBe(true);
    // The last faint: the enemy's picture goes, then the rival slides back in.
    const end = states.flatMap((s, i) => (s?.phase === "end" && screens[i]!.battle ? [screens[i]!] : []));
    const gone = end.findIndex((screen) => screen.enemy === null);
    expect(gone).toBeGreaterThanOrEqual(0);
    expect(end.slice(gone).some((screen) => screen.enemy !== null)).toBe(true);
  });

  it("decodes each move and both sides' HP after it", () => {
    // Moves in order, split into turns by the battle menu. A turn has at most one move a side: a
    // missed TACKLE or a GROWL that can't lower Attack any more has no animation.
    const turns: Turn[][] = [];
    const all = battle();
    all.forEach((s, i) => {
      const prev = all[i - 1];
      if (s.phase === "menu" && prev?.phase !== "menu") turns.push([]);
      if (s.animation?.isMove && s.animation.id !== prev?.animation?.id) {
        turns.at(-1)!.push({ by: s.animation.by, move: s.animation.id, hp: [0, 0] });
      }
      const last = turns.at(-1)?.at(-1);
      if (last && s.player.mon && s.enemy.mon && s.phase !== "end") last.hp = [s.player.mon.hp, s.enemy.mon.hp];
    });
    const P = (move: number, player: number, enemy: number): Turn => ({ by: "player", move, hp: [player, enemy] });
    const E = (move: number, player: number, enemy: number): Turn => ({ by: "enemy", move, hp: [player, enemy] });
    const T = TACKLE;
    const G = GROWL;
    expect(turns.filter((t) => t.length)).toEqual([
      [E(G, 20, 20), P(T, 20, 15)],
      [E(G, 20, 15), P(T, 20, 13)],
      [E(T, 17, 13), P(T, 17, 11)],
      [E(G, 17, 11)],
      [E(G, 17, 11), P(T, 17, 10)],
      [E(T, 14, 10), P(T, 14, 9)],
      [E(G, 14, 9), P(T, 14, 8)],
      [E(G, 14, 8), P(T, 14, 7)],
      [E(T, 11, 7), P(T, 11, 6)],
      [P(T, 11, 5)],
      [E(T, 7, 5), P(T, 7, 4)],
      [P(T, 7, 3)],
      [P(T, 7, 0)],
    ]);
  });
});
