// The game with no page and no picture, for the movement eval: the real emulator core in Node,
// placed anywhere on any map, walked with the joystick the way the page walks it (walk.ts's
// walkPath, frame by frame), and described with the same text the live player gets after a
// joystick turn (walkNote, then the text map, then the buttons). Battles are switched off and
// nothing presses A, so a walk is only a walk.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Button, decodeOverworldState, GameBoy, OVERWORLD_WATCHES, ScreenTextDecoder, TEXT_WATCHES, type OverworldWatched, type TextWatched } from "@pokehd/emu";
import { setParty } from "@pokehd/emu/testing";
import { parseWorld, readGlyphs, stitchOverworld, SYMBOLS, type MapData, type StitchedWorld, type WorldData } from "@pokehd/rom";
import { describeGameBoyText, mapName } from "../game/outcome.ts";
import type { StateLite } from "../game/screen-read.ts";
import { blockerAt, buildTextMap, type View } from "../game/textmap.ts";
import type { Direction, Move } from "../game/types.ts";
import { countSteps, DIRS, interruption, stallFrames, walkNote, type Stop } from "../game/walk.ts";

export const DEFAULT_ROM = fileURLToPath(new URL("../../../../rom/pokeblue.gb", import.meta.url));
const WASM = new URL("../../../../packages/emu/src/generated/sameboy.wasm", import.meta.url);

/** WRAM the generated symbol table leaves out (addresses from pokeblue.sym). */
const W = {
  wDestinationWarpID: 0xd42f,
  wSpritePlayerStateData1FacingDirection: 0xc109,
  wEventFlags: 0xd747,
  /** NUM_EVENTS / 8. */
  eventBytes: 0xa00 / 8,
};
/** wStatusFlags4's BIT_NO_BATTLES: NewBattle starts nothing while it's set. */
const NO_BATTLES = 1 << 4;
const FACING_CODE: Record<Direction, number> = { down: 0x0, up: 0x4, left: 0x8, right: 0xc };
const BUTTON: Record<Direction, number> = { up: Button.Up, down: Button.Down, left: Button.Left, right: Button.Right };

/** The buttons line of an overworld result in the live game (the page's own layout, 528×1000). */
export const PAD_LINES = "Buttons: [Pokédex] at (502,40)\nPad: joystick in the area (0,630)–(264,1000), [B] at (393,937), [A] at (477,890)";

export interface RomData {
  bytes: Uint8Array;
  world: WorldData;
  stitched: StitchedWorld;
  decoder: ScreenTextDecoder;
}

export function loadRomData(path = DEFAULT_ROM): RomData {
  const bytes = new Uint8Array(readFileSync(path));
  const world = parseWorld(bytes);
  return { bytes, world, stitched: stitchOverworld(world), decoder: new ScreenTextDecoder(readGlyphs(bytes)) };
}

export interface Place {
  map: number;
  x: number;
  y: number;
  facing?: Direction;
}

/** What a joystick turn did, for the scorer (the player only sees `text`). */
export interface WalkResult {
  text: string;
  asked: number;
  walked: number;
  stop: Stop | null;
  /** Steps the game actually took, frames walking included (ledge hops count 2). */
  frames: number;
  /** Map changes along the way (a warp or a connection), in order. */
  maps: number[];
  /** Text that came up and was cleared (only joystick here, so the harness clears it). */
  textSeen: string | null;
  /** Every cell the player stood on or stepped into on the starting map, in order. */
  cells: { x: number; y: number }[];
  startMap: number;
}

export interface SimOptions {
  /** Set every story event flag, so map scripts treat the story as done (fewer cutscenes in the way). */
  eventsDone?: boolean;
  /** Event flags to set (EVENT_* numbers from constants/event_constants.asm), e.g. trainers beaten. */
  events?: number[];
}

export class Sim {
  readonly gb: GameBoy;
  readonly rom: RomData;
  frames = 0;
  #base: Uint8Array;

  private constructor(gb: GameBoy, rom: RomData, base: Uint8Array) {
    this.gb = gb;
    this.rom = rom;
    this.#base = base;
  }

  /** A fresh game played to the overworld (the new game's first frame in Red's room), with battles off. */
  static async create(rom: RomData, opts: SimOptions = {}): Promise<Sim> {
    const gb = await GameBoy.create({ rom: rom.bytes, wasmBinary: new Uint8Array(readFileSync(WASM)) });
    const sim = new Sim(gb, rom, new Uint8Array());
    sim.#intro();
    // One strong Pokémon, so a battle the eval can't switch off (a scripted one) is over in a few
    // taps of A: MEWTWO (0x83) at level 100.
    setParty(gb, rom.bytes, [{ species: 0x83, level: 100 }]);
    if (opts.eventsDone) for (let i = 0; i < W.eventBytes; i++) gb.write(W.wEventFlags + i, 0xff);
    // All eight badges: gates and guards that check them stand aside.
    gb.write(SYMBOLS.wObtainedBadges.address, 0xff);
    // NewBattle (home/overworld.asm, 0:0683) checks BIT_NO_BATTLES, which map loads clear
    // (reload_tiles.asm): set it right as NewBattle reads it, so no wild or sighted-trainer battle
    // starts in between the per-frame sets.
    gb.addHook({ bank: 0, address: 0x0683 }, (g) => g.write(SYMBOLS.wStatusFlags4.address, g.read(SYMBOLS.wStatusFlags4.address) | NO_BATTLES));
    sim.#base = gb.saveState();
    return sim;
  }

  #intro(): void {
    const gb = this.gb;
    let reached = false;
    const remove = gb.addHook("OverworldLoop", () => (reached = true));
    for (let frame = 0; !reached && frame < 20_000; frame++) {
      const press = frame % 64 < 8 ? Button.Down : frame % 512 < 8 ? Button.Start : Button.A;
      this.#frame(frame % 8 < 2 ? press : 0);
    }
    remove();
    for (let i = 0; i < 60; i++) this.#frame(0);
  }

  #frame(buttons: number): void {
    const gb = this.gb;
    gb.setButtons(buttons);
    gb.runFrame();
    this.frames++;
    const flags = SYMBOLS.wStatusFlags4.address;
    const f = gb.read(flags);
    if (!(f & NO_BATTLES)) gb.write(flags, f | NO_BATTLES);
  }

  state(): StateLite {
    const watched = Object.fromEntries(Object.entries(OVERWORLD_WATCHES).map(([k, [a, n]]) => [k, this.gb.readBytes(a, n)])) as OverworldWatched;
    const s = decodeOverworldState(watched);
    return { mode: s.mode, mapId: s.mapId, fade: s.fade, player: { ...s.player }, npcs: s.npcs.map((n) => ({ ...n })) };
  }

  /**
   * Puts the player at `place` from the saved start, loading the map the way the game loads one
   * (EnterMap, from the overworld loop), then lets it settle. `lastMap` is where an indoor map's
   * exits lead (wLastMap).
   */
  teleport(place: Place, lastMap?: number, opts: SimOptions = {}): StateLite {
    const gb = this.gb;
    gb.loadState(this.#base);
    if (opts.eventsDone) for (let i = 0; i < W.eventBytes; i++) gb.write(W.wEventFlags + i, 0xff);
    for (const e of opts.events ?? []) gb.write(W.wEventFlags + (e >> 3), gb.read(W.wEventFlags + (e >> 3)) | (1 << (e & 7)));
    const map = this.rom.world.maps[place.map];
    if (!map) throw new Error(`No map ${place.map}`);
    let done = false;
    const remove = gb.addHook("OverworldLoop", (g) => {
      if (done) return;
      done = true;
      const w = map.widthBlocks;
      // event_displacement (macros/coords.asm): the view's top-left block in wOverworldMap.
      const view = SYMBOLS.wOverworldMap.address + 7 + w + (w + 6) * (place.y >> 1) + (place.x >> 1);
      g.write(SYMBOLS.wCurMap.address, place.map);
      g.write(SYMBOLS.wCurrentTileBlockMapViewPointer.address, view & 0xff);
      g.write(SYMBOLS.wCurrentTileBlockMapViewPointer.address + 1, view >> 8);
      g.write(SYMBOLS.wYCoord.address, place.y);
      g.write(SYMBOLS.wXCoord.address, place.x);
      g.write(SYMBOLS.wYBlockCoord.address, place.y & 1);
      g.write(SYMBOLS.wXBlockCoord.address, place.x & 1);
      g.write(W.wDestinationWarpID, 0xff);
      if (lastMap !== undefined) g.write(SYMBOLS.wLastMap.address, lastMap);
      g.write(W.wSpritePlayerStateData1FacingDirection, FACING_CODE[place.facing ?? "down"]);
      g.setRegisters({ pc: SYMBOLS.EnterMap.address });
    });
    for (let i = 0; !done && i < 600; i++) this.#frame(0);
    remove();
    this.#settle(true);
    return this.state();
  }

  /** Runs until the player stands still with no fade for a while (as the driver's settle does). */
  #settle(warped: boolean): StateLite {
    const calm = warped ? 60 : 30;
    let quiet = 0;
    let last = "";
    for (let i = 0; i < 600; i++) {
      this.#frame(0);
      const s = this.state();
      const sig = `${s.mode},${s.mapId},${s.player.x},${s.player.y},${s.fade},${!!s.player.step}`;
      quiet = sig === last && !s.player.step && s.fade === 0 ? quiet + 1 : 0;
      last = sig;
      if (quiet >= calm) return s;
    }
    return this.state();
  }

  /** Text on the Game Boy screen now (a dialog the walk ran into). */
  screenText(): string {
    const watched = Object.fromEntries(Object.entries(TEXT_WATCHES).map(([k, [a, n]]) => [k, this.gb.readBytes(a, n)])) as TextWatched;
    return describeGameBoyText(this.rom.decoder.decode(watched).boxes);
  }

  /** Taps through text until the window closes (the player has no A here; the harness clears it). */
  #clearText(): void {
    for (let i = 0; i < 3000 && this.state().mode === "dialog"; i++) this.#frame(i % 16 < 2 ? Button.B : 0);
    this.#settle(false);
  }

  /**
   * Fights a battle that started anyway (the game started one from a script, not NewBattle) by
   * tapping A until it's over: the eval is about walking. Returns whether there was one.
   */
  #fightThrough(): boolean {
    if (this.state().mode !== "battle") return false;
    for (let i = 0; i < 12_000 && this.gb.read(SYMBOLS.wIsInBattle.address) !== 0; i++) this.#frame(i % 16 < 2 ? Button.A : 0);
    for (let i = 0; i < 3000 && this.state().mode !== "overworld"; i++) this.#frame(i % 16 < 2 ? Button.A : 0);
    this.#settle(false);
    return true;
  }

  /** The text map around the player now, with the legend (what a result shows after a plain move). */
  textMap(s = this.state(), view?: View): string {
    return buildTextMap(this.rom.world, this.rom.stitched, s, view);
  }

  /**
   * One joystick turn: holds each leg's direction and turns (or lets go) on the frame the leg's
   * last step begins, as walkPath does in the page; stops when the game takes over (text, a new
   * map), or when no step starts for `stallFrames`. Then settles and describes the screen.
   */
  joystick(moves: Move[]): WalkResult {
    const runs = moves.map((m) => ({ direction: m.direction, steps: Math.max(1, Math.min(20, Math.round(m.tiles))) }));
    const total = runs.reduce((n, r) => n + r.steps, 0);
    const first = this.state();
    const startFrames = this.frames;
    const stepFrames = (first.player as { transport?: string }).transport === "bike" ? 8 : 16;
    const stall = stallFrames(stepFrames);
    const at = (s: StateLite) => {
      const step = s.player.step as { dx?: number; dy?: number } | null;
      return { x: s.player.x + (step?.dx ?? 0), y: s.player.y + (step?.dy ?? 0) };
    };
    const trail: StateLite[] = [first];
    const maps: number[] = [];
    let leg = 0;
    let base = at(first);
    let best = 0;
    let lastActive = this.frames;
    let key = "";
    let end: "done" | Stop = "done";
    let held = BUTTON[runs[0]!.direction];
    // The thumb takes a few frames to slide out from the centre before the game sees a direction.
    for (let i = 0; i < 2; i++) this.#frame(0);
    for (let guard = 0; ; guard++) {
      this.#frame(held);
      const s = this.state();
      const h = at(s);
      const k = `${s.mapId},${h.x},${h.y}`;
      if (k !== key) {
        key = k;
        trail.push(s);
      }
      if (s.mapId !== first.mapId) {
        end = "map";
        break;
      }
      if (s.mode === "battle") {
        end = "battle";
        break;
      }
      if (s.mode === "dialog") {
        end = "text";
        break;
      }
      const l = { ...DIRS[runs[leg]!.direction], steps: runs[leg]!.steps };
      const progress = Math.max(0, (h.x - base.x) * l.dx + (h.y - base.y) * l.dy);
      if (progress > best || s.player.step || s.fade !== 0) lastActive = this.frames;
      best = Math.max(best, progress);
      if (best >= l.steps) {
        leg++;
        const next = runs[leg];
        if (!next) break;
        held = BUTTON[next.direction];
        base = { x: base.x + l.dx * l.steps, y: base.y + l.dy * l.steps };
        best = 0;
        lastActive = this.frames;
        continue;
      }
      if (this.frames - lastActive > stall) {
        end = "blocked";
        break;
      }
      if (guard > 20_000) {
        end = "stalled";
        break;
      }
    }
    leg = Math.min(leg, runs.length - 1);
    const after = this.#settle(end === "map");
    trail.push(after);
    let textSeen: string | null = null;
    let to = after;
    const fought = this.#fightThrough();
    if (fought) to = this.state();
    if (to.mode === "dialog") {
      textSeen = this.screenText();
      this.#clearText();
      to = this.state();
    }
    for (const s of trail) if (maps.at(-1) !== s.mapId && s.mapId !== first.mapId) maps.push(s.mapId);
    const why = interruption(first, after) ?? (end === "done" ? null : end);
    const stoppedGoing = runs[leg]!.direction;
    const blocker = why === "blocked" ? blockerAt(this.rom.world, this.rom.stitched, to, DIRS[stoppedGoing]) : null;
    const walked = countSteps(trail);
    const note = walkNote({ asked: total, walked, stop: why, direction: stoppedGoing, blocker });
    const parts = [note];
    if (to.mapId !== first.mapId) parts.push(`You're now in ${mapName(to.mapId)}.`);
    if (fought) parts.push("(A battle started, and the harness fought it for you: this drill is only about walking.)");
    if (textSeen) parts.push(`${textSeen}\n(The text was closed for you.)`);
    parts.push(this.textMap(to), PAD_LINES);
    const cells = [first, ...trail, to].filter((s) => s.mapId === first.mapId).map((s) => ({ x: s.player.x, y: s.player.y }));
    return { text: parts.filter(Boolean).join("\n"), asked: total, walked, stop: why, frames: this.frames - startFrames, maps, textSeen, cells, startMap: first.mapId };
  }

  /** The opening screen description for an episode, as the live player sees one after a warp. */
  opening(): string {
    const s = this.state();
    return `You're in ${mapName(s.mapId)}.\n${this.textMap(s)}\n${PAD_LINES}`;
  }
}

export type { MapData };
