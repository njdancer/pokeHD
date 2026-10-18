import { describe, expect, it } from "vitest";
import { CloseCode, ROOM_QUIET_MS, type Presence, type ServerMessage } from "@pokehd/protocol";
import { join, leave, quietPeers, receive, type Peer, type SeenStore } from "./room.ts";

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
      JSON.stringify({ type: "presence", presence: here, pad: "x".repeat(5000) }),
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
    expect(sam1.inbox.at(-1)).toEqual({ type: "error", reason: "replaced" });
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

describe("link relay", () => {
  const bytes = { kind: "bytes", data: new Array(424).fill(0xfd) } as const;

  it("passes a link message to the named friend only, in order", () => {
    const r = room();
    const sam = r.connect("sam");
    const alex = r.connect("alex");
    const kim = r.connect("kim");
    for (const p of r.peers) p.inbox.length = 0;
    receive(r.peers, sam, JSON.stringify({ type: "link", to: "alex", message: { kind: "connect" } }));
    receive(r.peers, sam, JSON.stringify({ type: "link", to: "alex", message: bytes }));
    expect(alex.inbox).toEqual([
      { type: "link", from: "sam", message: { kind: "connect" } },
      { type: "link", from: "sam", message: bytes },
    ]);
    expect(kim.inbox).toEqual([]);
    expect(sam.inbox).toEqual([]);
  });

  it("tells the sender when the friend isn't here", () => {
    const r = room();
    const sam = r.connect("sam");
    sam.inbox.length = 0;
    receive(r.peers, sam, JSON.stringify({ type: "link", to: "alex", message: { kind: "nybble", value: 4 } }));
    receive(r.peers, sam, JSON.stringify({ type: "link", to: "sam", message: { kind: "cancel" } }));
    expect(sam.inbox).toEqual([
      { type: "error", reason: "not-here", to: "alex" },
      { type: "error", reason: "not-here", to: "sam" },
    ]);
  });

  it("rejects malformed link messages", () => {
    const r = room();
    const sam = r.connect("sam");
    const alex = r.connect("alex");
    alex.inbox.length = 0;
    receive(r.peers, sam, JSON.stringify({ type: "link", to: "alex", message: { kind: "nybble", value: 256 } }));
    expect(alex.inbox).toEqual([]);
    expect(sam.inbox.at(-1)).toEqual({ type: "error", reason: "bad-message" });
  });
});

describe("quiet connections", () => {
  it("are the ones not heard from for a while", () => {
    const heard = new Map([["phone", 0], ["mac", 9_000]]);
    expect(quietPeers(["phone", "mac"], (p) => heard.get(p)!, ROOM_QUIET_MS - 1)).toEqual([]);
    expect(quietPeers(["phone", "mac"], (p) => heard.get(p)!, ROOM_QUIET_MS)).toEqual(["phone"]);
    expect(quietPeers(["phone", "mac"], (p) => heard.get(p)!, 9_000 + ROOM_QUIET_MS)).toEqual(["phone", "mac"]);
  });
});

describe("last seen", () => {
  it("notes every presence, and the spot a player leaves from before saying they left", () => {
    const notes: [string, number, number, boolean][] = [];
    const seen: SeenStore = { note: (id, p, final = false) => void notes.push([id, p.x, p.y, final]) };
    const peers = [fake("sam"), fake("alex")];
    const [sam, alex] = peers as [FakePeer, FakePeer];
    receive(peers, sam, JSON.stringify({ type: "presence", presence: here }), undefined, seen);
    receive(peers, sam, JSON.stringify({ type: "presence", presence: null }), undefined, seen);
    expect(notes).toEqual([["sam", 5, 6, false]]);
    receive(peers, sam, JSON.stringify({ type: "presence", presence: { ...here, x: 7 } }), undefined, seen);
    leave([alex], sam, seen);
    expect(notes.at(-1)).toEqual(["sam", 7, 6, true]);
    expect(alex.inbox.at(-1)).toEqual({ type: "left", id: "sam" });
  });

  it("isn't noted when the player is still connected elsewhere", () => {
    const notes: string[] = [];
    const seen: SeenStore = { note: (id) => void notes.push(id) };
    const [old, now] = [fake("sam"), fake("sam")];
    old.presence = here;
    leave([now], old, seen);
    expect(notes).toEqual([]);
  });
});
