import { describe, expect, it } from "vitest";
import type { LinkPortOptions } from "@pokehd/emu";
import type { ClientMessage, LinkMessage, ServerMessage } from "@pokehd/protocol";
import { linkRole, RoomLink } from "./link.ts";

/** A fake room and emulator: records what's sent to the room and what reaches the port. */
function setup(me = "m") {
  const sent: ClientMessage[] = [];
  let listener: ((message: ServerMessage) => void) | undefined;
  const ports: { options: LinkPortOptions; received: LinkMessage[]; closed: boolean }[] = [];
  const link = new RoomLink({
    me,
    room: {
      send: (message) => sent.push(message),
      subscribe: (l) => {
        listener = l;
        return () => (listener = undefined);
      },
    },
    open: (options) => {
      const port = { options, received: [] as LinkMessage[], closed: false };
      ports.push(port);
      return { receive: (m) => port.received.push(m), close: () => (port.closed = true) };
    },
  });
  const port = () => ports.at(-1)!;
  return {
    link,
    sent,
    ports,
    port,
    /** The game sends a message through the current port. */
    game: (message: LinkMessage) => port().options.send(message),
    from: (from: string, message: LinkMessage) => listener!({ type: "link", from, message }),
    room: (message: ServerMessage) => listener!(message),
  };
}

const connect = { kind: "connect" } as const;
const nybble = { kind: "nybble", value: 4 } as const;

describe("RoomLink", () => {
  it("leads when its player ID is the smaller", () => {
    expect(linkRole("a", "b")).toBe("leader");
    expect(linkRole("b", "a")).toBe("follower");
  });

  it("asks for a friend when the game wants to connect, then pairs with them", () => {
    const t = setup("m");
    expect(t.link.state).toEqual({ status: "idle", waiting: [] });
    t.game(connect);
    expect(t.link.state).toEqual({ status: "choosing", visit: 1, waiting: [] });
    expect(t.sent).toEqual([]);

    t.link.choose("z");
    expect(t.link.state).toEqual({ status: "linked", friend: "z", role: "leader", waiting: [] });
    expect(t.ports).toHaveLength(2);
    expect(t.port().options.role).toBe("leader");
    t.game(connect); // the new port picks the game up in the connection loop
    expect(t.sent).toEqual([{ type: "link", to: "z", message: connect }]);

    t.from("z", nybble); // before their connect: not part of a session yet
    t.from("z", connect);
    t.from("z", nybble);
    t.from("q", nybble);
    expect(t.port().received).toEqual([connect, nybble]);
    t.game(nybble);
    expect(t.sent.at(-1)).toEqual({ type: "link", to: "z", message: nybble });
  });

  it("lists friends already waiting and answers them when picked", () => {
    const t = setup("m");
    t.from("a", connect);
    t.from("b", connect);
    t.from("a", { kind: "cancel" });
    t.from("c", connect);
    t.room({ type: "left", id: "c" });
    expect(t.link.state.waiting).toEqual(["b"]);
    t.game(connect);
    t.link.choose("b");
    expect(t.port().options.role).toBe("follower");
    expect(t.port().received).toEqual([connect]);
    expect(t.link.state.waiting).toEqual([]);
  });

  it("starts each visit to the receptionist with a new pick", () => {
    const t = setup("m");
    t.game(connect);
    t.link.choose("z");
    t.game(connect);
    t.from("z", connect);
    // Later, the friend goes back to their receptionist first.
    t.from("z", connect);
    expect(t.port().received).toEqual([connect]);
    expect(t.link.state.waiting).toEqual(["z"]);
    t.game(connect);
    expect(t.link.state).toMatchObject({ status: "choosing", visit: 2 });
    t.link.choose("z");
    expect(t.port().received).toEqual([connect]);
  });

  it("goes idle when the game gives up at the receptionist", () => {
    const t = setup("m");
    t.game(connect);
    t.game({ kind: "cancel" }); // no pick in time
    expect(t.link.state.status).toBe("idle");
    expect(t.sent).toEqual([]);

    t.game(connect);
    t.link.choose("z");
    t.game(connect);
    t.game({ kind: "cancel" }); // the friend never picked us back
    expect(t.sent.map((m) => m.type === "link" && m.message.kind)).toEqual(["connect", "cancel"]);
    expect(t.link.state.status).toBe("idle");
  });

  it("can't pick itself or pick outside the receptionist", () => {
    const t = setup("m");
    t.link.choose("z");
    expect(t.link.state.status).toBe("idle");
    t.game(connect);
    t.link.choose("m");
    expect(t.link.state.status).toBe("choosing");
  });

  it("closes the port on dispose", () => {
    const t = setup();
    t.link.dispose();
    expect(t.port().closed).toBe(true);
  });
});
