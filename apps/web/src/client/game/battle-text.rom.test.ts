// ROM test for battle messages in the HD text layer (QA bug 26), with the page's own message
// handling (scriptView, scriptTap) over the real game: in the first rival battle, the rival's
// Pokémon faints to one hit and a second one is sent out. A tap that lands on "Enemy BULBASAUR
// fainted!" before the player could have read it doesn't close it; the stats box after "SQUIRTLE
// grew to level 6!" waits for a tap of its own; and every message shows. Skips without the ROM.
import { existsSync, readFileSync } from "node:fs";
import {
  BATTLE_WATCHES, Button, Controls, GameBoy, OVERWORLD_WATCHES, ScreenTextDecoder, TEXT_WATCHES,
  type ScreenText, type TextWatched, type Watch,
} from "@pokehd/emu";
import { FONT_CHARS, readGlyphs, SYMBOLS } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { playToRivalBattle } from "../../../../../packages/emu/src/testing.ts";
import { BattleTracker, battleText } from "./battle.ts";
import { battleTextFits } from "./hd-text.ts";
import { newScriptView, scriptTap, scriptView, type ScriptView } from "./script-view.ts";

const ROM_PATH = new URL("../../../../../rom/pokeblue.gb", import.meta.url);
const WASM_PATH = new URL("../../../../../packages/emu/src/generated/sameboy.wasm", import.meta.url);
/** party_struct (PARTYMON_STRUCT_LENGTH). */
const PARTY_MON_LENGTH = 44;

describe.skipIf(!existsSync(ROM_PATH))("battle messages in HD", () => {
  it("shows each message until the player could have read it, and the stats box until tapped (QA bug 26)", { timeout: 120_000 }, async () => {
    const rom = new Uint8Array(readFileSync(ROM_PATH));
    const gb = await GameBoy.create({ rom, wasmBinary: readFileSync(WASM_PATH) });
    playToRivalBattle(gb);

    // The page, as Game runs it: whole messages from the script, read on by taps.
    const ref: { current: ScriptView | null } = { current: null };
    const controls: Controls = new Controls(gb, {
      setButtons: (m) => gb.setButtons(m),
      script: {
        message: ({ id, message, letterFrames }) => {
          ref.current = newScriptView(id, message, letterFrames);
          if (ref.current.boxes.length <= 1) controls.readOn(id);
        },
        end: (id) => {
          if (ref.current?.id === id) ref.current.ended = true;
        },
        press: () => {},
      },
    });
    controls.setScriptText(rom);
    let watches: Record<string, Watch> = {};
    const battles = new BattleTracker(rom, { ...OVERWORLD_WATCHES, ...TEXT_WATCHES, ...BATTLE_WATCHES }, (w) => (watches = w));
    const decoder = new ScreenTextDecoder(readGlyphs(rom));
    /** A tap on the HD message box (Game's readOnScript), or the game's A when no message takes it. */
    const tap = () => {
      const script = ref.current;
      const result = scriptTap(script);
      if (result === "next" && script!.index === script!.boxes.length - 1) controls.readOn(script!.id);
      if (result === "close") controls.closeMessage(script!.id);
      if (result === "none") controls.tap(Button.A);
      return result;
    };
    /** What the HD layer shows (the message's lines, or the game's own) and the screen's text. */
    let shown: { lines: string[] | null; text: ScreenText } = { lines: null, text: null as unknown as ScreenText };
    /** Every message the HD layer showed, in order (its first box's lines), with frames shown. */
    const seen: { lines: string; frames: number }[] = [];
    const step = () => {
      controls.frame();
      gb.runFrame();
      const watched = Object.fromEntries(Object.entries(watches).map(([k, [a, n]]) => [k, gb.readBytes(a, n)]));
      const fight = battles.frame(watched);
      const screen = fight.scene === "scene" ? fight.screen : null;
      const text = decoder.decode(screen ? battleText(watched as unknown as TextWatched, screen) : (watched as unknown as TextWatched));
      const fits = !!screen && battleTextFits(text);
      const view = scriptView(ref, text, fits, (id) => controls.releaseMessage(id));
      const lines = view?.lines ?? (fits ? (text.dialog?.lines.filter(Boolean) ?? null) : null);
      const key = lines?.join(" ") ?? "";
      if (key && seen.at(-1)?.lines === key) seen.at(-1)!.frames++;
      else if (key) seen.push({ lines: key, frames: 1 });
      shown = { lines, text };
    };
    /** The game's own screen, as text. */
    const onScreen = () => [...gb.readBytes(SYMBOLS.wTileMap.address, 360)].map((t) => (t >= 0x80 ? FONT_CHARS[t - 0x80] : " ")).join("");
    /** A player who reads each message, then taps: until `done`. */
    const play = (done: () => boolean, limit = 3000) => {
      for (let f = 0, waiting = 0; !done(); f++) {
        if (f > limit) throw new Error(`Stuck: ${shown.lines?.join(" / ")} ${JSON.stringify(seen.slice(-8))} ${onScreen()}`);
        step();
        const script = ref.current;
        if (script && !script.ended && !script.closed) {
          if (script.shown > script.readyAt + 10) tap();
          continue;
        }
        // The game's own waits (a message the HD layer handed back, the ▼ after it).
        waiting = shown.text.dialog?.state === "waiting" ? waiting + 1 : 0;
        if (waiting === 30) tap();
      }
    };
    const menuUp = () => shown.text?.menus.length > 0;

    // Through "RIVAL wants to fight!" and the send-outs, to the battle menu.
    play(menuUp);
    // One hit from SQUIRTLE takes the rival's BULBASAUR down, and a second BULBASAUR follows it.
    gb.write(SYMBOLS.wEnemyMonHP.address, 0);
    gb.write(SYMBOLS.wEnemyMonHP.address + 1, 1);
    const party = SYMBOLS.wEnemyPartyCount.address;
    gb.write(party, 2);
    gb.write(party + 2, gb.read(party + 1));
    gb.write(party + 3, 0xff);
    const mons = SYMBOLS.wEnemyMons.address;
    for (let i = 0; i < PARTY_MON_LENGTH; i++) gb.write(mons + PARTY_MON_LENGTH + i, gb.read(mons + i));
    // FIGHT, then TACKLE, with the A button.
    const press = () => {
      controls.setButtons(Button.A);
      for (let f = 0; f < 4; f++) step();
      controls.setButtons(0);
    };
    for (let f = 0; f < 10; f++) step();
    press();
    for (let f = 0; f < 70; f++) step();
    press();
    const fainted = () => ref.current?.boxes[0]?.join(" ") === "Enemy BULBASAUR fainted!";
    play(fainted);
    const message = ref.current!;
    // At medium text speed the game takes 3 frames a letter: 69 frames for its 23.
    expect(message.letterFrames).toBe(3);
    // A tap meant for what came before (it reaches the page as the box appears), and one in the
    // second the game would still be printing: neither reads on.
    for (let f = 0; f < 2; f++) step();
    expect(tap()).toBe("wait");
    while (message.shown < 34) step();
    expect(tap()).toBe("wait");
    for (let f = 0; f < 4; f++) step();
    expect(ref.current).toBe(message);
    expect(message.closed).toBe(false);
    expect(onScreen()).toContain("fainted!");
    expect(shown.lines).toEqual(["Enemy BULBASAUR", "fainted!"]);
    // Once the game would have printed it, a tap reads on.
    expect(message.readyAt).toBe(69);
    while (message.shown < message.readyAt) step();
    expect(tap()).toBe("close");

    // On to the EXP and the level: "SQUIRTLE grew to level 6!", then the jingle, then the stats.
    const grew = () => ref.current?.boxes[0]?.join(" ") === "SQUIRTLE grew to level 6!";
    play(grew);
    const level = ref.current!;
    while (level.shown <= level.readyAt) step();
    // Read before the stats box is up: the tap closes the message, not the box to come.
    expect(onScreen()).not.toContain("ATTACK");
    expect(tap()).toBe("close");
    for (let f = 0; f < 600 && !onScreen().includes("ATTACK"); f++) step();
    expect(onScreen()).toContain("ATTACK");
    // The game waits under the stats box for a tap of its own.
    for (let f = 0; f < 120; f++) step();
    expect(onScreen()).toContain("ATTACK");
    expect(level.ended).toBe(true);
    expect(tap()).toBe("none");
    for (let f = 0; f < 60 && onScreen().includes("ATTACK"); f++) step();
    expect(onScreen()).not.toContain("ATTACK");

    // The rival's next BULBASAUR comes out under its own message, up as long as the game shows it.
    play(menuUp);
    const after = seen.slice(seen.findIndex((s) => s.lines === "SQUIRTLE grew to level 6!"));
    expect(after.find((s) => / sent out BULBASAUR!$/.test(s.lines))?.frames).toBeGreaterThan(30);
    // Every message, in the game's order.
    const order = seen.map((s) => s.lines).filter((l) => /fainted|EXP|grew|sent out/.test(l));
    expect(order.slice(-4)).toEqual([
      "Enemy BULBASAUR fainted!",
      expect.stringMatching(/^SQUIRTLE gained \d+ EXP\. Points!/),
      "SQUIRTLE grew to level 6!",
      expect.stringMatching(/ sent out BULBASAUR!$/),
    ]);
  });
});
