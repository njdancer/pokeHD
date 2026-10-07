import { describe, expect, expectTypeOf, it } from "vitest";
import type * as v from "valibot";
import { parseServerMessage, type ServerMessage, type ServerMessageSchema } from "./room.ts";

describe("parseServerMessage", () => {
  it("matches the ServerMessage type exactly", () => {
    type Parsed = v.InferOutput<typeof ServerMessageSchema>;
    expectTypeOf<Parsed>().toExtend<ServerMessage>();
    expectTypeOf<ServerMessage>().toExtend<Parsed>();
  });

  it("accepts every message the room sends", () => {
    const messages: ServerMessage[] = [
      { type: "welcome", you: { id: "a", name: "A" }, players: [{ id: "b", name: "B", presence: null }] },
      { type: "joined", player: { id: "b", name: "B" } },
      { type: "left", id: "b" },
      { type: "presence", id: "b", presence: null },
      { type: "link", from: "b", message: { kind: "nybble", value: 4 } },
      { type: "error", reason: "bad-message" },
      { type: "error", reason: "replaced" },
      { type: "error", reason: "not-here", to: "b" },
    ];
    for (const m of messages) expect(parseServerMessage(JSON.stringify(m))).toEqual(m);
  });

  it("rejects junk", () => {
    expect(parseServerMessage("not json")).toBeNull();
    expect(parseServerMessage(new ArrayBuffer(2))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: "joined" }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: "error", reason: "not-here" }))).toBeNull();
  });
});
