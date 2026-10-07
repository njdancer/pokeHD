import { describe, expect, it } from "vitest";
import { MAX_LINK_BLOCK, parseLinkMessage, type LinkMessage } from "./link.ts";

describe("link messages", () => {
  it("round-trips every kind through JSON", () => {
    const messages: LinkMessage[] = [
      { kind: "connect" },
      { kind: "cancel" },
      { kind: "bytes", data: [0xfd, 0xfd, 0x12, 0x00] },
      { kind: "nybble", value: 4 },
      { kind: "battle", value: 0x0f },
      { kind: "menu", data: [0xd4, 0xd4] },
    ];
    for (const m of messages) expect(parseLinkMessage(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });

  it("rejects unknown kinds, out-of-range bytes and oversized blocks", () => {
    expect(() => parseLinkMessage({ kind: "warp" })).toThrow();
    expect(() => parseLinkMessage({ kind: "nybble", value: 256 })).toThrow();
    expect(() => parseLinkMessage({ kind: "nybble", value: 1.5 })).toThrow();
    expect(() => parseLinkMessage({ kind: "menu", data: [1] })).toThrow();
    expect(() => parseLinkMessage({ kind: "bytes", data: new Array(MAX_LINK_BLOCK + 1).fill(0) })).toThrow();
  });
});
