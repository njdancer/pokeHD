// Dev page (/dev/ui): the tap-first HD panels in each look (ui-look.ts) side by side, over the
// same scenes: the start menu, a message with YES/NO, the bag and a message waiting for A.
// `?bg=<url>` puts a picture behind them (a screenshot of the HD world). Taps are logged.
import { useState } from "react";
import type { ScreenText, TextBox } from "@pokehd/emu";
import { TextOverlay, type TextActions } from "../game/TextOverlay.tsx";
import { UI_LOOKS } from "../game/ui-look.ts";
import "./ui-looks.css";

const box = (x: number, y: number, width: number, height: number, lines: TextBox["lines"] = []): TextBox => ({ x, y, width, height, lines });
const blank: Omit<ScreenText, "boxes"> = { shown: true, dialog: null, menus: [], quantity: null, loose: [], pictures: false };

const startBox = box(10, 0, 10, 14, [
  { row: 2, col: 12, text: "POKéDEX" },
  { row: 4, col: 11, text: "▶POKéMON" },
  { row: 6, col: 12, text: "ITEM" },
  { row: 8, col: 12, text: "NICK" },
  { row: 10, col: 12, text: "SAVE" },
  { row: 12, col: 12, text: "OPTION" },
]);
const startMenu: ScreenText = {
  ...blank,
  boxes: [startBox],
  menus: [{ kind: "start", box: startBox, active: true, cursor: 1, items: ["POKéDEX", "POKéMON", "ITEM", "NICK", "SAVE", "OPTION"].map((text, i) => ({ text, row: 2 + i * 2 })) }],
};

const saveDialog = box(0, 12, 20, 6, [{ row: 14, col: 1, text: "Would you like to" }, { row: 16, col: 1, text: "SAVE the game?" }]);
const yesNoBox = box(14, 7, 6, 5, [{ row: 8, col: 15, text: "▶YES" }, { row: 10, col: 16, text: "NO" }]);
const yesNo: ScreenText = {
  ...blank,
  boxes: [saveDialog, yesNoBox],
  dialog: { box: saveDialog, lines: ["Would you like to", "SAVE the game?"], state: "idle" },
  menus: [{ kind: "yesNo", box: yesNoBox, active: true, cursor: 0, items: [{ text: "YES", row: 8 }, { text: "NO", row: 10 }] }],
};

const bagBox = box(4, 2, 16, 11, [
  { row: 4, col: 5, text: "▶POTION" },
  { row: 6, col: 6, text: "POKé BALL" },
  { row: 8, col: 6, text: "ANTIDOTE" },
  { row: 10, col: 6, text: "CANCEL" },
]);
const bag: ScreenText = {
  ...blank,
  boxes: [box(10, 0, 10, 14), bagBox],
  menus: [{
    kind: "list", box: bagBox, active: true, cursor: 0, listId: 3, scroll: 0,
    items: [{ text: "POTION", row: 4, detail: "×3" }, { text: "POKé BALL", row: 6, detail: "×5" }, { text: "ANTIDOTE", row: 8, detail: "×1" }, { text: "CANCEL", row: 10 }],
  }],
};

const talkBox = box(0, 12, 20, 6);
const talk: ScreenText = {
  ...blank,
  boxes: [talkBox],
  dialog: { box: talkBox, lines: ["MOM: Right. All", "boys leave home"], state: "waiting" },
};

const SCENES: [string, ScreenText][] = [["Start menu", startMenu], ["YES / NO", yesNo], ["Bag", bag], ["Message", talk]];

export function UiLooks() {
  const bg = new URLSearchParams(location.search).get("bg");
  const [log, setLog] = useState<string[]>([]);
  const actions = (scene: string): TextActions => ({
    select: (item) => setLog((l) => [`${scene}: pick item ${item}`, ...l].slice(0, 6)),
    press: (button) => setLog((l) => [`${scene}: press ${button}`, ...l].slice(0, 6)),
  });
  return (
    <div className="ui-looks" data-testid="ui-looks">
      <div className="ui-looks-grid" style={{ gridTemplateColumns: `repeat(${UI_LOOKS.length}, 1fr)` }}>
        {UI_LOOKS.map((look) => <h2 key={look}>{look}</h2>)}
        {SCENES.flatMap(([name, text]) =>
          UI_LOOKS.map((look) => (
            <div key={`${name}-${look}`} className="ui-looks-cell" style={bg ? { backgroundImage: `url(${bg})` } : undefined}>
              <TextOverlay text={text} actions={actions(`${look} ${name}`)} look={look} />
            </div>
          )),
        )}
      </div>
      <pre className="ui-looks-log">{log.join("\n") || "Tap something."}</pre>
    </div>
  );
}
