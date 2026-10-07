import { describe, expect, it } from "vitest";
import { CloseCode, type Presence, type ServerMessage } from "./protocol.ts";
import { join, leave, receive, type Peer } from "./room.ts";

const here: Presence = {
  mapId: 0,
  x: 5,
  y: 6,
  facing: "down",
  step: { dx: 0, dy: 1, progress: 0.5 },
  animFrame: 1,
  transport: "walk",
  mode: "overworld",
};

interface FakePeer extends Peer {
  inbox: ServerMessage[];
  closed: number | null;
}

function fake(id: string): FakePeer {
  return {
    player: { id, name: id.toUpperCase() },
    presence: null,
    inbox: [],
    closed: null,
    send(message) {
      this.inbox.push(message);
    },
    close(code) {
      this.closed = code;
    },
  };
}

/** A tiny room: the open peers, as the Durable Object would list them. */
function room() {
  const peers: FakePeer[] = [];
  return {
    peers,
    connect(id: string) {
      const p = fake(id);
      peers.push(p);
      join(peers, p);
      for (const old of peers.filter((q) => q.closed !== null)) peers.splice(peers.indexOf(old), 1);
      return p;
    },
    disconnect(p: FakePeer) {
      peers.splice(peers.indexOf(p), 1);
      leave(peers, p);
    },
  };
}

describe("room", () => {
  it("welcomes a newcomer with everyone's presence and announces them", () => {
    const r = room();
    const sam = r.connect("sam");
    receive(r.peers, sam, JSON.stringify({ type: "presence", presence: here }));
    const alex = r.connect("alex");
    expect(alex.inbox).toEqual([
      {
        type: "welcome",
        you: { id: "alex", name: "ALEX" },
        players: [{ id: "sam", name: "SAM", presence: here }],
      },
    ]);
    expect(sam.inbox).toEqual([
      { type: "welcome", you: sam.player, players: [] },
      { type: "joined", player: alex.player },
    ]);
  });

  it("relays presence to everyone else", () => {
    const r = room();
    const sam = r.connect("sam");
    const alex = r.connect("alex");
    sam.inbox.length = alex.inbox.length = 0;
    receive(r.peers, sam, JSON.stringify({ type: "presence", presence: here }));
    expect(alex.inbox).toEqual([{ type: "presence", id: "sam", presence: here }]);
    expect(sam.inbox).toEqual([]);
    receive(r.peers, sam, JSON.stringify({ type: "presence", presence: null }));
    expect(alex.inbox.at(-1)).toEqual({ type: "presence", id: "sam", presence: null });
  });

  it("rejects bad messages without relaying them", () => {
    const r = room();
    const sam = r.connect("sam");
    const alex = r.connect("alex");
    sam.inbox.length = alex.inbox.length = 0;
    for (const frame of [
      "not json",
      JSON.stringify({ type: "presence", presence: { ...here, mapId: 256 } }),
      JSON.stringify({ type: "presence", presence: { ...here, extra: 1 } }),
      JSON.stringify({ type: "shout" }),
      JSON.stringify({ type: "presence", presence: here, pad: "x".repeat(2000) }),
      new ArrayBuffer(4),
    ]) {
      receive(r.peers, sam, frame);
    }
    expect(sam.inbox.every((m) => m.type === "error")).toBe(true);
    expect(sam.inbox).toHaveLength(6);
    expect(alex.inbox).toEqual([]);
  });

  it("a second connection replaces the first quietly", () => {
    const r = room();
    const alex = r.connect("alex");
    const sam1 = r.connect("sam");
    alex.inbox.length = 0;
    const sam2 = r.connect("sam");
    expect(sam1.closed).toBe(CloseCode.replaced);
    expect(sam2.inbox[0]).toMatchObject({ type: "welcome", players: [{ id: "alex" }] });
    leave(r.peers, sam1); // the old socket's close event arrives later
    expect(alex.inbox).toEqual([]);
  });

  it("announces a player leaving", () => {
    const r = room();
    const sam = r.connect("sam");
    const alex = r.connect("alex");
    r.disconnect(alex);
    expect(sam.inbox.at(-1)).toEqual({ type: "left", id: "alex" });
  });
});
