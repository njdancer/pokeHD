import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import type { GiftEvent, GiftSpec, TakenGift } from "@pokehd/emu";
import type { ClientMessage, Gift, ServerMessage } from "@pokehd/protocol";
import { closeDb } from "../idb.ts";
import { giftStorage } from "../saves/gift-store.ts";
import { loadSave, openSaveSlot } from "../saves/save-store.ts";
import { GiftCourier, type GiftHost, type GiftRoom } from "./gifts.ts";

beforeEach(() => {
  closeDb();
  globalThis.indexedDB = new IDBFactory();
});

const potion: Gift = { kind: "item", item: 0x14, quantity: 3 };
const sam = { id: "sam", name: "SAM" };
const alex = { id: "alex", name: "ALEX" };
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function fakeRoom() {
  const sent: ClientMessage[] = [];
  const listeners = new Set<(m: ServerMessage) => void>();
  let online = true;
  const room: GiftRoom = {
    send: (m) => {
      if (online) sent.push(m);
      return online;
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return {
    room,
    sent,
    setOnline: (value: boolean) => (online = value),
    deliver: (m: ServerMessage) => listeners.forEach((l) => l(m)),
  };
}

function fakeHost(taken?: TakenGift) {
  const given: [string, Gift][] = [];
  const specs: GiftSpec[] = [];
  const host: GiftHost = {
    giveGift: (id, gift) => given.push([id, gift]),
    takeGift: async (spec) => {
      specs.push(spec);
      return taken ?? { result: { ok: false, reason: "no" } };
    },
  };
  return { host, given, specs };
}

async function courier(taken?: TakenGift) {
  const slot = await openSaveSlot("rom");
  const storage = giftStorage(slot);
  const room = fakeRoom();
  const host = fakeHost(taken);
  let n = 0;
  const c = new GiftCourier({ room: room.room, host: host.host, storage, newId: () => `id${++n}` });
  return { c, room, host, storage, slot };
}

describe("gift courier (D20)", () => {
  it("stores the sender's save with the gift before sending, and keeps it until the room has it", async () => {
    const sram = new Uint8Array([1, 2, 3]);
    const { c, room, storage } = await courier({ result: { ok: true, gift: potion }, sram });
    room.setOnline(false);
    const result = await c.send(alex, { kind: "item", slot: 0, item: 0x14, quantity: 3 });
    expect(result).toEqual({ ok: true, gift: potion });
    expect(await loadSave("rom")).toEqual(sram);
    expect(await storage.outbox()).toEqual([{ id: "id1", to: "alex", toName: "ALEX", gift: potion }]);
    expect(room.sent).toEqual([]);

    // Back online: the welcome resends it; the room's receipt clears it.
    room.setOnline(true);
    room.deliver({ type: "welcome", you: sam, players: [] });
    await settle();
    expect(room.sent).toEqual([{ type: "gift", to: "alex", id: "id1", gift: potion }]);
    room.deliver({ type: "gift-stored", id: "id1" });
    await settle();
    expect(await storage.outbox()).toEqual([]);
    expect(c.state.notices).toEqual([{ kind: "sent", id: "id1", toName: "ALEX", gift: potion }]);
  });

  it("sends nothing when the game refuses", async () => {
    const { c, room, storage } = await courier();
    expect(await c.send(alex, { kind: "money", amount: 5 })).toEqual({ ok: false, reason: "no" });
    expect(room.sent).toEqual([]);
    expect(await storage.outbox()).toEqual([]);
  });

  it("gives received gifts to the game, and acknowledges them only once a stored save holds them", async () => {
    const { c, room, host, storage } = await courier();
    room.deliver({ type: "gift", id: "g1", from: sam, gift: potion });
    await settle();
    expect(host.given).toEqual([["g1", potion]]);

    const events: GiftEvent[] = [
      { type: "held", id: "g1", reason: "bag full" },
      { type: "landed", id: "g1", where: "bag" },
    ];
    for (const e of events) c.onGiftEvent(e);
    await settle();
    expect(c.state.notices).toEqual([{ kind: "received", id: "g1", from: sam, gift: potion, where: "bag" }]);
    expect(room.sent).toEqual([]);

    c.onGiftEvent({ type: "settled", ids: ["g1"] });
    await settle();
    expect(room.sent).toEqual([{ type: "gift-ack", id: "g1" }]);
    expect(await storage.settled()).toEqual(new Set(["g1"]));
  });

  it("acknowledges a resent gift the ledger already holds instead of giving it again", async () => {
    const first = await courier();
    first.c.onGiftEvent({ type: "settled", ids: ["g1"] });
    await settle();
    first.c.dispose();

    // A reload: the ack was lost, so the room hands g1 over again.
    const { room, host } = await courier();
    room.deliver({ type: "gift", id: "g1", from: sam, gift: potion });
    await settle();
    expect(host.given).toEqual([]);
    expect(room.sent).toEqual([{ type: "gift-ack", id: "g1" }]);
  });

  it("lets the room drop a gift the game can never accept", async () => {
    const { c, room } = await courier();
    const bike: Gift = { kind: "item", item: 0x06, quantity: 1 };
    room.deliver({ type: "gift", id: "g2", from: sam, gift: bike });
    await settle();
    c.onGiftEvent({ type: "rejected", id: "g2", reason: "key item" });
    await settle();
    expect(room.sent).toEqual([{ type: "gift-ack", id: "g2" }]);
    expect(c.state.notices).toEqual([{ kind: "refused", id: "g2", from: sam, gift: bike, reason: "key item" }]);
  });
});
