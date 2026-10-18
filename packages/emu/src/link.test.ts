// Two Game Boys linked in-process through LinkPort (D17), reproducing the p3-link spike's checks:
// a trade swaps byte-identical mons, and a battle ends with both sides agreeing on the HP.
import { parseLinkMessage, type LinkMessage } from "@pokehd/protocol";
import { beforeAll, describe, expect, it } from "vitest";
import { Button, type GameBoy } from "./core.ts";
import { LinkPort } from "./link.ts";
import { ScriptText } from "./script-text.ts";
import {
  linkScenarioReady,
  makeParty,
  PLAYERS,
  runLink,
  screenHas,
  setupLinkScenario,
  type Kind,
} from "./link-scenario.ts";

/**
 * Runs both games with each message arriving `delayMs` after it was sent (one way). Messages
 * cross as JSON and are validated with the protocol schema, as they are from the room. With
 * `rom`, each game shows whole messages on a page (ScriptText) that reads them at once, as the
 * app does.
 */
async function play(gbs: [GameBoy, GameBoy], kind: Kind, delayMs: number, rom?: Uint8Array) {
  let clock = 0;
  const inFlight: { at: number; to: 0 | 1; json: string }[] = [];
  const ports = gbs.map(
    (gb, i) =>
      new LinkPort(gb, {
        role: i === 0 ? "leader" : "follower",
        send: (message: LinkMessage) => inFlight.push({ at: clock + delayMs, to: i === 0 ? 1 : 0, json: JSON.stringify(message) }),
      }),
  );
  const pages = rom
    ? gbs.map((gb) => {
        const page: ScriptText = new ScriptText(gb, {
          rom,
          onMessage: ({ id }) => (page.readOn(id), page.close(id)),
          onEnd: () => {},
        });
        return page;
      })
    : [];
  try {
    return await runLink(gbs, kind, (now) => {
      for (const page of pages) page.frame();
      clock = now;
      while (inFlight.length && inFlight[0]!.at <= now) {
        const { to, json } = inFlight.shift()!;
        ports[to]!.receive(parseLinkMessage(JSON.parse(json)));
      }
    });
  } finally {
    for (const port of ports) port.dispose();
    for (const page of pages) page.dispose();
  }
}

describe.skipIf(!linkScenarioReady)("LinkPort between two Game Boys", () => {
  let gbs: [GameBoy, GameBoy];
  let rom: Uint8Array;
  let reset: (kind: Kind) => void;

  beforeAll(async () => {
    ({ gbs, rom, reset } = await setupLinkScenario());
  }, 120_000);

  describe.each([0, 200])("at %i ms one way", (delayMs) => {
    it("trades first mons, each arriving byte for byte as sent", async () => {
      reset("trade");
      const sent = PLAYERS.map((p) => [...makeParty(rom, p.mons, p.id)[0]!.struct]);
      const { results } = await play(gbs, "trade", delayMs);
      results.forEach((res, i) => {
        expect(res.party).toEqual([PLAYERS[i as 0 | 1].mons[1]!.species, PLAYERS[1 - i]!.mons[0]!.species]);
        expect(res.received).toEqual(sent[1 - i]);
      });
    }, 300_000);

    it("battles until exactly one mon faints, both sides agreeing on the HP", async () => {
      reset("battle");
      const { results } = await play(gbs, "battle", delayMs);
      const [a, b] = results.map((res) => res.hp!);
      expect(a).toEqual([b![1], b![0]]);
      expect(a![0] === 0).not.toBe(a![1] === 0);
    }, 300_000);
  });

  // The game starts the table's trade or battle from inside its "Just a moment." button wait,
  // which the page answers.
  describe("with whole messages on the page", () => {
    it("trades", async () => {
      reset("trade");
      const { results } = await play(gbs, "trade", 0, rom);
      results.forEach((res, i) => expect(res.party).toEqual([PLAYERS[i as 0 | 1].mons[1]!.species, PLAYERS[1 - i]!.mons[0]!.species]));
    }, 300_000);

    it("battles", async () => {
      reset("battle");
      const { results } = await play(gbs, "battle", 0, rom);
      const [a, b] = results.map((res) => res.hp!);
      expect(a).toEqual([b![1], b![0]]);
    }, 300_000);
  });

  /** One Game Boy alone at the receptionist, mashing A until `text` shows. True if a session started. */
  function talkUntil(gb: GameBoy, text: string, port: LinkPort): boolean {
    let session = false;
    for (let f = 0; !screenHas(gb, text); f++) {
      if (f > 60 * 120) throw new Error(`"${text}" never showed (waiting in ${port.waitingFor})`);
      gb.setButtons(f % 12 < 6 ? Button.A : 0);
      gb.runFrame();
      session ||= port.inSession;
    }
    gb.setButtons(0);
    return session;
  }

  it("counts an open port as a session only once the game uses it", () => {
    reset("trade");
    const port = new LinkPort(gbs[0], { role: "leader", connectTimeoutFrames: 120, send: () => {} });
    try {
      // The room opens a port for every signed-in player; resume points must still be taken.
      expect(port.inSession).toBe(false);
      expect(talkUntil(gbs[0], "reserved for", port)).toBe(true);
    } finally {
      port.dispose();
    }
  }, 60_000);

  it("gives up at the receptionist when the friend never talks to theirs", () => {
    reset("trade");
    const sent: string[] = [];
    const port = new LinkPort(gbs[0], { role: "leader", connectTimeoutFrames: 120, send: (m) => sent.push(m.kind) });
    try {
      talkUntil(gbs[0], "reserved for", port);
    } finally {
      port.dispose();
    }
    expect(sent).toEqual(["connect", "cancel"]);
  }, 60_000);

  it("closes the link for inactivity when the friend connects but never saves", () => {
    reset("trade");
    const sent: string[] = [];
    const port = new LinkPort(gbs[0], { role: "follower", send: (m) => sent.push(m.kind) });
    port.receive({ kind: "connect" });
    try {
      talkUntil(gbs[0], "because of", port);
    } finally {
      port.dispose();
    }
    expect(sent).toEqual(["connect", "nybble"]);
    expect(port.waitingFor).toBeUndefined();
    expect(port.inSession).toBe(false);
  }, 60_000);
});
