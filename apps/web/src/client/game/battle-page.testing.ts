// For ROM tests: one emulator with the page's side of a battle over it, as Game runs them. Whole
// messages from the script (ScriptText via Controls) read on with a tap on the HD message box, the
// HD battle menu's questions (BattleMenus) and the Pokédex menu's sheets (GameAsks) answered a few
// frames late as across the emulator worker, and each frame's Game Boy screen masked the way Game
// masks it: what's left of it is what the player would see over the HD battle.
import {
  BATTLE_WATCHES, BattleMenus, Button, Controls, GameAsks, GameBoy, OVERWORLD_WATCHES, ScreenTextDecoder, TEXT_WATCHES,
  type AskAnswer, type BattleAnswer, type BattleAsk, type GameAsk, type TextWatched, type Watch,
} from "@pokehd/emu";
import { readGlyphs } from "@pokehd/rom";
import {
  BattleItemUse, BattleMenuCover, BattleTracker, battleCovered, battleText, battleTextShown, maskBattleScreen, partyScreenMessage,
} from "./battle.ts";
import { battleTextFits } from "./hd-text.ts";
import { newScriptView, scriptTap, scriptView, type ScriptView } from "./script-view.ts";

/** Frames between the player's taps on a message: a person reading, not mashing. */
const READ_FRAMES = 40;

export interface BattlePageOptions {
  rom: Uint8Array;
  wasm: Uint8Array;
  /** Frames the page's questions and answers take to cross to the emulator worker and back. */
  lag?: number;
  /** The Pokédex menu's answer to one of the game's own questions (the bag, the party). */
  sheet?: (ask: GameAsk) => AskAnswer;
}

export type BattlePage = Awaited<ReturnType<typeof battlePage>>;

export async function battlePage(state: Uint8Array, { rom, wasm, lag = 0, sheet = () => null }: BattlePageOptions) {
  const gb = await GameBoy.create({ rom, wasmBinary: wasm });
  gb.loadState(state);
  const menus = new BattleMenus(gb, { rom, onAsk: () => {} });
  const itemUse = new BattleItemUse();
  /** The game's questions for the sheets, each answered `lag` frames after it's asked. */
  const sheets: { id: number; ask: GameAsk; in: number }[] = [];
  const asks = new GameAsks(gb, {
    rom,
    busy: () => false,
    onAsk: (id, ask) => {
      sheets.push({ id, ask, in: lag });
    },
  });
  const script: { current: ScriptView | null } = { current: null };
  const controls: Controls = new Controls(gb, {
    setButtons: (m) => gb.setButtons(m),
    script: {
      message: ({ id, message, letterFrames }) => {
        script.current = newScriptView(id, message, letterFrames);
        if (script.current.boxes.length <= 1) controls.readOn(id);
      },
      end: (id) => {
        if (script.current?.id === id) script.current.ended = true;
      },
      press: () => {},
    },
  });
  controls.setScriptText(rom);
  let watches: Record<string, Watch> = {};
  const battles = new BattleTracker(rom, { ...OVERWORLD_WATCHES, ...TEXT_WATCHES, ...BATTLE_WATCHES }, (w) => (watches = w));
  const decoder = new ScreenTextDecoder(readGlyphs(rom));
  const cover = new BattleMenuCover();

  /** The question as the page has it. */
  let asked: { id: number; ask: BattleAsk } | null = null;
  let askAge = 0;
  let sending: { id: number; answer: BattleAnswer; in: number } | null = null;
  const answered = new Set<number>();
  /** What the HD message box shows. */
  let hd: string | null = null;

  /**
   * One frame as Game shows it: the Game Boy pixels left over the HD battle (-1 for the Game Boy
   * screen in front of it), with what the screen read as for a failure, and the HD text.
   */
  const step = () => {
    controls.frame();
    gb.runFrame();
    if (sending && --sending.in < 0) {
      menus.answer(sending.id, sending.answer);
      sending = null;
    }
    const due = sheets[0];
    if (due && --due.in < 0) {
      sheets.shift();
      const answer = sheet(due.ask);
      itemUse.answered(due.ask, answer);
      asks.answer(due.id, answer);
    }
    const asking = menus.asking;
    if (asking && asked?.id !== asking.id && !answered.has(asking.id) && ++askAge > lag) {
      asked = asking;
      askAge = 0;
    }
    const watched = Object.fromEntries(Object.entries(watches).map(([k, [a, n]]) => [k, gb.readBytes(a, n)]));
    const fight = battles.frame(watched);
    hd = null;
    // An item used in the battle: its party screen stays behind the HD battle, but its message.
    const whole = decoder.decode(watched as unknown as TextWatched);
    if (itemUse.using(fight, whole, !!asked)) {
      const text = partyScreenMessage(whole);
      const fits = battleTextFits(text);
      const view = scriptView(script, text, fits, (id) => controls.releaseMessage(id));
      hd = view ? (view.lines ?? []).join(" / ") : fits ? text.boxes.flatMap((b) => b.lines.map((l) => l.text)).join(" / ") : null;
      return { visible: 0, read: "item" };
    }
    const screen = fight.scene === "scene" ? fight.screen : null;
    if (!screen) {
      cover.covering(null, !!asked);
      // The Game Boy's own screen in a battle (a menu, or the way in) shows whole.
      const read = JSON.stringify({ scene: fight.scene, boxes: decoder.decode(watched as unknown as TextWatched).boxes.map((b) => b.lines.map((l) => l.text).join("|")) });
      return { visible: fight.state && fight.scene === "menu" ? -1 : 0, read };
    }
    const onScreen = decoder.decode(battleText(watched as unknown as TextWatched, screen));
    const text = battleTextShown(onScreen);
    const choosing = cover.covering(onScreen, !!asked);
    const fits = !choosing && battleTextFits(text);
    const data = new Uint8ClampedArray(gb.frame);
    maskBattleScreen(data, screen, battleCovered(onScreen, fits, choosing));
    let visible = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]) visible++;
    const view = scriptView(script, text, fits, (id) => controls.releaseMessage(id));
    hd = view ? (view.lines ?? []).join(" / ") : fits ? text.boxes.flatMap((b) => b.lines.map((l) => l.text)).join(" / ") : null;
    const read = JSON.stringify({ boxes: onScreen.boxes.map((b) => [b.x, b.y, b.width, b.height, b.lines.map((l) => l.text).join("|")]), loose: onScreen.loose.map((l) => l.text) });
    return { visible, read };
  };

  /** A tap on the HD message box (Game's textActions.press("A")). */
  const tapMessage = () => {
    const s = script.current;
    const tap = scriptTap(s);
    if (tap === "next" && s!.index === s!.boxes.length - 1) controls.readOn(s!.id);
    if (tap === "close") controls.closeMessage(s!.id);
    if (tap === "none") controls.tap(Button.A);
  };

  /**
   * Plays on, the player tapping each HD message a while after it shows, until `done`: what
   * showed meanwhile.
   */
  const play = (done: () => boolean) => {
    const shown = { leaks: [] as string[], hd: [] as string[] };
    for (let f = 0, reading = 0; !done(); f++) {
      if (f > 3000) throw new Error(`Stuck: ${shown.hd.join(" | ")}`);
      const s = step();
      if (s.visible) shown.leaks.push(`frame ${f}: ${s.read}`);
      if (hd && shown.hd.at(-1) !== hd) shown.hd.push(hd);
      reading = hd && !asked ? reading + 1 : 0;
      if (reading === READ_FRAMES) {
        tapMessage();
        reading = 0;
      }
    }
    return shown;
  };

  /** Answers the HD battle menu's question (the page drops its menu at once), then plays on to the next. */
  const answer = (a: BattleAnswer, done: () => boolean = () => asked !== null) => {
    const id = asked!.id;
    asked = null;
    answered.add(id);
    sending = { id, answer: a, in: lag };
    cover.answered();
    return play(done);
  };
  return { gb, play, answer, asked: () => asked };
}
