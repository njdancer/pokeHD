// For ROM tests: one emulator with the page's side of a battle over it, as Game runs them. Whole
// messages from the script (ScriptText via Controls) read on with a tap on the HD message box, the
// HD battle menu's questions (BattleMenus) and the Pokédex menu's sheets (GameAsks) answered a few
// frames late as across the emulator worker, and each frame's Game Boy screen masked the way Game
// masks it: what's left of it is what the player would see over the HD battle. The game's questions
// go through the menu's LiveActions first, as in Game: one it was told the answer to up front (the
// bag's "Use POTION on GEODUDE": the party question after the bag's) never reaches a sheet.
import {
  BATTLE_WATCHES, BattleMenus, Button, Controls, GameAsks, GameBoy, gameInputWait, OVERWORLD_WATCHES, ScreenTextDecoder, TEXT_WATCHES,
  type AskAnswer, type BattleAnswer, type BattleAsk, type GameAsk, type ScreenText, type TextWatched, type Watch,
} from "@pokehd/emu";
import { readGlyphs } from "@pokehd/rom";
import { LiveActions, type LiveHost } from "../menu/live.ts";
import {
  BattleItemUse, BattleMenuCover, BattleTracker, battleCovered, battleText, battleTextShown, maskBattleScreen, partyScreenMessage,
} from "./battle.ts";
import { battleTextFits } from "./hd-text.ts";
import { newScriptView, scriptTap, scriptView, withScriptState, type ScriptView } from "./script-view.ts";
import { MessageLog, pageInput, type BoxState } from "./qa-signals.ts";

/** Frames between the player's taps on a message: a person reading, not mashing. */
const READ_FRAMES = 40;
/** Frames from a message's ▼ to the tap of a player who waits for it. */
const CUE_FRAMES = 10;
/** Frames a player who waits for the ▼ waits with none before tapping anyway. */
const STILL_FRAMES = 120;

export interface BattlePageOptions {
  rom: Uint8Array;
  wasm: Uint8Array;
  /** Frames the page's questions and answers take to cross to the emulator worker and back. */
  lag?: number;
  /** The Pokédex menu's answer to one of the game's own questions (the bag, the party). */
  sheet?: (ask: GameAsk) => AskAnswer;
  /**
   * The bag's "Use ITEM on MON" (verbs.ts): the bag's question answered with the item and the
   * Pokémon's queued for the party question that follows (LiveActions.useItem), as the HD bag
   * does in a battle. Without it each question shows its sheet (`sheet`).
   */
  bag?: { item: number; mon: number };
}

export type BattlePage = Awaited<ReturnType<typeof battlePage>>;

export async function battlePage(state: Uint8Array, { rom, wasm, lag = 0, sheet = () => null, bag }: BattlePageOptions) {
  const gb = await GameBoy.create({ rom, wasmBinary: wasm });
  gb.loadState(state);
  const menus = new BattleMenus(gb, { rom, onAsk: () => {} });
  const itemUse = new BattleItemUse();
  /** The game's questions for the sheets, as the page has them. */
  const sheets: { id: number; ask: GameAsk }[] = [];
  /** Every question the game asked, sheet or not. */
  const gameAsks: GameAsk[] = [];
  /** The page's answers, reaching the game `lag` frames later. */
  const replies: { id: number; answer: AskAnswer; in: number }[] = [];
  /** The game's last question (Game's lastAskRef), for what its answer starts. */
  let lastAsk: { id: number; ask: GameAsk } | null = null;
  // Game's liveGame.answer: the menu's every answer, a sheet's or a queued one.
  const host: { current: LiveHost } = {
    current: {
      act: () => Promise.reject(new Error("No menu actions on a battle page")),
      answer: (id, answer) => {
        if (lastAsk?.id === id) itemUse.answered(lastAsk.ask, answer);
        replies.push({ id, answer, in: lag });
      },
      notice: () => {},
      setApp: () => {},
      game: null,
    },
  };
  const live = new LiveActions(rom, host);
  const asks = new GameAsks(gb, {
    rom,
    busy: () => false,
    // Game's onAsk: the question is the last one, then the menu may already know its answer.
    onAsk: (id, ask) => {
      gameAsks.push(ask);
      lastAsk = { id, ask };
      if (!live.asked(id, ask)) sheets.push({ id, ask });
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
  /** The HD message box shows its ▼ (Game's withScriptState): a tap reads on. */
  let more = false;
  /** The HD message box shows the whole message (Game's scriptShownRef). */
  let scriptShown = false;
  /** What Game gives ?stats (qa-signals.ts): every line the box showed, and the box and menus now. */
  const log = new MessageLog();
  let box: { dialog: BoxState | null; menu: boolean } = { dialog: null, menu: false };
  const observe = (text: ScreenText, view: { lines: string[] | null } | null) => {
    const shown = view ? withScriptState(text, script.current) : text.shown ? text : null;
    const dialog = shown?.dialog ?? null;
    log.show(view?.lines ?? dialog?.lines ?? null, !!view || dialog?.state !== "printing");
    box = { dialog: dialog?.state ?? null, menu: !!shown?.menus.some((m) => m.active) };
  };

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
    // A sheet the page shows is answered at once: the round trip is in `replies`.
    for (let due = sheets.shift(); due; due = sheets.shift()) {
      if (bag && due.ask.kind === "items") live.useItem(bag.item, bag.mon);
      else {
        live.answered();
        host.current.answer(due.id, sheet(due.ask));
      }
    }
    const reply = replies[0];
    if (reply && --reply.in < 0) {
      replies.shift();
      asks.answer(reply.id, reply.answer);
    }
    const asking = menus.asking;
    if (asking && asked?.id !== asking.id && !answered.has(asking.id) && ++askAge > lag) {
      asked = asking;
      askAge = 0;
    }
    const watched = Object.fromEntries(Object.entries(watches).map(([k, [a, n]]) => [k, gb.readBytes(a, n)]));
    const fight = battles.frame(watched);
    hd = null;
    more = false;
    scriptShown = false;
    // An item used in the battle: its party screen stays behind the HD battle, but its message.
    const whole = decoder.decode(watched as unknown as TextWatched);
    if (itemUse.using(fight, whole, !!asked)) {
      const text = partyScreenMessage(whole);
      const fits = battleTextFits(text);
      const view = scriptView(script, text, fits, (id) => controls.releaseMessage(id));
      hd = view ? (view.lines ?? []).join(" / ") : fits ? text.boxes.flatMap((b) => b.lines.map((l) => l.text)).join(" / ") : null;
      more = (view ? withScriptState(text, script.current) : fits ? text : null)?.dialog?.state === "waiting";
      scriptShown = !!view;
      observe(text, view);
      return { visible: 0, read: "item" };
    }
    const screen = fight.scene === "scene" ? fight.screen : null;
    if (!screen) {
      cover.covering(null, !!asked);
      observe(decoder.decode(watched as unknown as TextWatched), null);
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
    more = (view ? withScriptState(text, script.current) : fits ? text : null)?.dialog?.state === "waiting";
    scriptShown = !!view;
    observe(text, view);
    const read = JSON.stringify({ boxes: onScreen.boxes.map((b) => [b.x, b.y, b.width, b.height, b.lines.map((l) => l.text).join("|")]), loose: onScreen.loose.map((l) => l.text) });
    return { visible, read };
  };

  /** A tap on the HD message box (Game's textActions.press("A")). */
  const tapMessage = () => {
    const s = scriptShown ? script.current : null;
    const tap = scriptTap(s);
    if (tap === "next" && s!.index === s!.boxes.length - 1) controls.readOn(s!.id);
    if (tap === "close") controls.closeMessage(s!.id);
    if (tap === "none") controls.tap(Button.A);
    return tap;
  };

  /**
   * Plays on, the player tapping each HD message a while after it shows, until `done`: what
   * showed meanwhile, and each tap with what it did. `cue`: the player taps a little after the
   * box shows its ▼, and otherwise only once nothing has changed for a while (the game's own
   * waits with no ▼, as under the stats box after a level), rather than every so often.
   */
  const play = (done: () => boolean, { cue = false } = {}) => {
    const shown = { leaks: [] as string[], hd: [] as string[], taps: [] as { hd: string; message: number | null; more: boolean; tap: string }[] };
    for (let f = 0, reading = 0, still = 0, last = ""; !done(); f++) {
      if (f > 3000) throw new Error(`Stuck: ${shown.hd.join(" | ")}`);
      const s = step();
      if (s.visible) shown.leaks.push(`frame ${f}: ${s.read}`);
      if (hd && shown.hd.at(-1) !== hd) shown.hd.push(hd);
      const now = `${hd}#${more}#${script.current?.id}`;
      still = now === last ? still + 1 : 0;
      last = now;
      reading = hd && !asked && (more || !cue) ? reading + 1 : 0;
      const tap = cue ? reading === CUE_FRAMES || (!!hd && !asked && !more && still === STILL_FRAMES) : reading === READ_FRAMES;
      if (tap) {
        shown.taps.push({ hd: hd!, message: scriptShown ? (script.current?.id ?? null) : null, more, tap: tapMessage() });
        reading = 0;
        still = 0;
      }
    }
    return shown;
  };

  /** Answers the HD battle menu's question (the page drops its menu at once), then plays on to the next. */
  const answer = (a: BattleAnswer, done: () => boolean = () => asked !== null, options: { cue?: boolean } = {}) => {
    const id = asked!.id;
    asked = null;
    answered.add(id);
    sending = { id, answer: a, in: lag };
    cover.answered();
    return play(done, options);
  };
  /** Answers the HD battle menu's question without playing on. */
  const send = (a: BattleAnswer) => {
    const id = asked!.id;
    asked = null;
    answered.add(id);
    sending = { id, answer: a, in: lag };
    cover.answered();
  };
  /** Who has the next input, as Game tells ?stats (qa-signals.ts). */
  const input = () =>
    pageInput({ mode: "battle", inWorld: true, ...box, pageHolds: scriptShown && !!script.current && !script.current.ended, game: gameInputWait(gb), battleAsk: !!asked, sheet: false, acting: false });
  return { gb, play, answer, asked: () => asked, gameAsks, step, tapMessage, send, input, log, hd: () => hd, more: () => more };
}
