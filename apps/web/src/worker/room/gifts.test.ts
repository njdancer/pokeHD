import { describe, expect, it } from "vitest";
import type { ServerMessage } from "@pokehd/protocol";
import { join, leave, receive, type GiftStore, type Peer, type StoredGift } from "./room.ts";

interface FakePeer extends Peer {
  inbox: ServerMessage[];
}

function fake(id: string): FakePeer {
  return {
    player: { id, name: id.toUpperCase() },
    presence: null,
    inbox: [],
    send(message) {
      this.inbox.push(message);
    },
    close() {},
  };
}

/** The Durable Object's store, in memory. */
function memoryStore(): GiftStore & { size(): number } {
  const byPlayer = new Map<string, StoredGift[]>();
  return {
    put(to, gift) {
      const list = byPlayer.get(to) ?? [];
      if (!list.some((g) => g.id === gift.id)) list.push(gift);
      byPlayer.set(to, list);
    },
    list: (to) => [...(byPlayer.get(to) ?? [])],
    delete(to, id) {
      byPlayer.set(to, (byPlayer.get(to) ?? []).filter((g) => g.id !== id));
    },
    size: () => [...byPlayer.values()].reduce((n, l) => n + l.length, 0),
  };
}

const potion = { kind: "item", item: 0x14, quantity: 3 } as const;
const send = (peers: Peer[], from: Peer, message: object, store: GiftStore) =>
  receive(peers, from, JSON.stringify(message), store);

describe("gifts in the room (D20)", () => {
  it("delivers to an online friend and keeps the gift until they acknowledge it", () => {
    const store = memoryStore();
    const sam = fake("sam");
    const alex = fake("alex");
    const peers: Peer[] = [sam, alex];
    join(peers, sam, store);
    join(peers, alex, store);
    sam.inbox.length = alex.inbox.length = 0;

    send(peers, sam, { type: "gift", to: "alex", id: "g1", gift: potion }, store);
    expect(sam.inbox).toEqual([{ type: "gift-stored", id: "g1" }]);
    expect(alex.inbox).toEqual([{ type: "gift", id: "g1", from: { id: "sam", name: "SAM" }, gift: potion }]);

    // A resend (the sender's outbox after a reconnect) doesn't make a second gift.
    send(peers, sam, { type: "gift", to: "alex", id: "g1", gift: potion }, store);
    expect(store.size()).toBe(1);

    // Only the receiver can acknowledge it.
    send(peers, sam, { type: "gift-ack", id: "g1" }, store);
    expect(store.size()).toBe(1);
    send(peers, alex, { type: "gift-ack", id: "g1" }, store);
    expect(store.size()).toBe(0);
  });

  it("holds gifts for a friend who's away and hands them over on every connect until acknowledged", () => {
    const store = memoryStore();
    const sam = fake("sam");
    const peers: Peer[] = [sam];
    join(peers, sam, store);
    send(peers, sam, { type: "gift", to: "alex", id: "g1", gift: potion }, store);
    send(peers, sam, { type: "gift", to: "alex", id: "g2", gift: { kind: "money", amount: 500 } }, store);

    const alex = fake("alex");
    peers.push(alex);
    join(peers, alex, store);
    expect(alex.inbox.filter((m) => m.type === "gift").map((m) => m.type === "gift" && m.id)).toEqual(["g1", "g2"]);
    send(peers, alex, { type: "gift-ack", id: "g1" }, store);

    // Reconnecting (the save with g2 never happened): g2 comes again.
    peers.pop();
    leave(peers, alex);
    const again = fake("alex");
    peers.push(again);
    join(peers, again, store);
    expect(again.inbox.filter((m) => m.type === "gift").map((m) => m.type === "gift" && m.id)).toEqual(["g2"]);
  });

  it("rejects gifts to yourself and malformed gifts", () => {
    const store = memoryStore();
    const sam = fake("sam");
    const peers: Peer[] = [sam];
    join(peers, sam, store);
    sam.inbox.length = 0;
    send(peers, sam, { type: "gift", to: "sam", id: "g1", gift: potion }, store);
    send(peers, sam, { type: "gift", to: "alex", id: "g2", gift: { kind: "item", item: 0x14, quantity: 100 } }, store);
    send(peers, sam, { type: "gift", to: "alex", id: "g3", gift: { kind: "mon", mon: { data: [1], ot: [], nick: [] } } }, store);
    expect(sam.inbox).toEqual(Array(3).fill({ type: "error", reason: "bad-message" }));
    expect(store.size()).toBe(0);
  });
});
