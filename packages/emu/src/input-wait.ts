// Whether the game is waiting for the player's buttons, from where the CPU is at the end of a
// frame (no hooks: it only reads the registers and the stack). For scripted play (the QA harness
// acts the moment the game takes input, with no clock to guess at), never for the game itself.
//
// - `button`: in WaitForTextScrollButtonPress, or ManualTextScroll around it: the game waits for A
//   or B under a message, or under its own boxes with no ▼ (the stats box after a level).
//   ScriptText's held waits count too (DelayFrame returning to the wait), though there the page
//   decides when a tap reads on.
// - `menu`: in HandleMenuInput: a menu waits for a choice.
// - `overworld`: at the top of OverworldLoop with the player free: no step under way, no joypad
//   ignored, no scripted movement. JoypadOverworld reads the pad next.
import { SYMBOLS } from "@pokehd/rom";
import type { GameBoy } from "./core.ts";

export type GameInputWait = "button" | "menu" | "overworld";

/** Bytes of stack looked through for a return address: the waits' calls nest a few deep (Joypad's homecall, the VBlank handler). */
export const INPUT_WAIT_STACK = 32;

const BUTTON: [number, number] = [SYMBOLS.WaitForTextScrollButtonPress.address, SYMBOLS.Multiply.address];
const MENU: [number, number] = [SYMBOLS.HandleMenuInput.address, SYMBOLS.PlaceMenuCursor.address];
const DELAY_FRAME: [number, number] = [SYMBOLS.DelayFrame.address, SYMBOLS.LoadGBPal.address];
/** Where OverworldLoop's two `call DelayFrame`s return to (each call is three bytes). */
const OVERWORLD_RETURNS = [SYMBOLS.OverworldLoop.address + 3, SYMBOLS.OverworldLoopLessDelay.address + 3];
/** wStatusFlags5: BIT_SCRIPTED_NPC_MOVEMENT, BIT_DISABLE_JOYPAD, BIT_SCRIPTED_MOVEMENT_STATE. */
const SCRIPTED = (1 << 0) | (1 << 5) | (1 << 7);

/** The overworld's own gates on the player's input, read from WRAM. */
export interface OverworldGates {
  walkCounter: number;
  joyIgnore: number;
  statusFlags5: number;
  simulatedJoypad: number;
}

const inRange = (a: number, [from, to]: [number, number]) => a >= from && a < to;

/** `gameInputWait` on what it reads: the program counter, the stack from SP, and the gates. */
export function classifyInputWait(pc: number, stack: Uint8Array, gates: OverworldGates): GameInputWait | null {
  const words: number[] = [];
  for (let i = 0; i + 1 < stack.length; i += 2) words.push(stack[i]! | (stack[i + 1]! << 8));
  const anywhere = (range: [number, number]) => inRange(pc, range) || words.some((w) => inRange(w, range));
  if (anywhere(BUTTON)) return "button";
  if (anywhere(MENU)) return "menu";
  // Halted in DelayFrame, called from the top of the loop; or just woken from it, at the VBlank
  // interrupt (a frame ends there), its return into DelayFrame on top.
  const caller = inRange(pc, DELAY_FRAME) ? words[0] : inRange(words[0] ?? -1, DELAY_FRAME) ? words[1] : undefined;
  if (caller !== undefined && OVERWORLD_RETURNS.includes(caller)) {
    const free = gates.walkCounter === 0 && gates.joyIgnore === 0 && !(gates.statusFlags5 & SCRIPTED) && gates.simulatedJoypad === 0;
    return free ? "overworld" : null;
  }
  return null;
}

/** Where the game is waiting for the player's buttons this frame, if it is (call between frames). */
export function gameInputWait(gb: GameBoy): GameInputWait | null {
  const { pc, sp } = gb.registers;
  return classifyInputWait(pc, gb.readBytes(sp, INPUT_WAIT_STACK), {
    walkCounter: gb.read(SYMBOLS.wWalkCounter.address),
    joyIgnore: gb.read(SYMBOLS.wJoyIgnore.address),
    statusFlags5: gb.read(SYMBOLS.wStatusFlags5.address),
    simulatedJoypad: gb.read(SYMBOLS.wSimulatedJoypadStatesIndex.address),
  });
}
