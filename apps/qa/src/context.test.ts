import { describe, expect, it } from "vitest";
import { ContextLog } from "./context.ts";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 };

describe("ContextLog", () => {
  it("serialises a chapter with images by reference and usage per reply", () => {
    const log = new ContextLog(150_000);
    log.startChapter("You are the player.", [{ name: "mcp__game__tap", description: "Tap", inputSchema: {} }]);
    log.add("user", "The game is loaded.");
    // Claude Code sends a reply one block at a time, under one message id.
    log.add("assistant", [{ type: "thinking", thinking: "", signature: "sig" }], { id: "msg_1", usage });
    log.add("assistant", [{ type: "text", text: "Tapping YES." }, { type: "tool_use", id: "tu_1", name: "mcp__game__tap", input: { x: 1, y: 2 } }], { id: "msg_1", usage });
    log.add("user", [
      {
        type: "tool_result",
        tool_use_id: "tu_1",
        content: [
          { type: "text", text: "Turn 1. Map:\n 0123\n0 .#.." },
          { type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } },
        ],
      },
      { type: "image", data: png.toString("base64"), mimeType: "image/png" },
    ]);
    log.pending = () => ["[fixed #3] try again"];

    const snap = log.snapshot();
    expect(snap).toMatchObject({ chapter: 1, system: "You are the player.", limit: 150_000, contextTokens: 1215, outputTokens: 5, pending: ["[fixed #3] try again"], total: 3, handoffs: [] });
    expect(snap.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(snap.messages[1]!.blocks).toEqual([
      { type: "thinking", text: "" },
      { type: "text", text: "Tapping YES." },
      { type: "tool_use", id: "tu_1", name: "mcp__game__tap", input: { x: 1, y: 2 } },
    ]);
    expect(snap.messages[1]!.usage).toEqual({ input: 10, cacheRead: 1000, cacheWrite: 200, output: 5, prompt: 1210 });
    expect(snap.messages[2]!.blocks).toEqual([
      { type: "tool_result", toolUseId: "tu_1", content: [{ type: "text", text: "Turn 1. Map:\n 0123\n0 .#.." }, { type: "image", ref: 1 }] },
      { type: "image", ref: 2 },
    ]);
    // No image bytes in the JSON; they're served by reference.
    expect(JSON.stringify(snap)).not.toContain(png.toString("base64"));
    expect(log.image(1)).toEqual({ mime: "image/png", data: png });
    // Asked for messages from the 2nd on: the 2nd again (it may have grown) and the 3rd.
    expect(log.snapshot(2).messages.map((m) => m.n)).toEqual([2, 3]);
  });

  it("starts a new chapter with the handoff and forgets the old one's images", () => {
    const log = new ContextLog(100);
    log.startChapter("v1", []);
    log.add("user", [{ type: "image", source: { data: png.toString("base64"), media_type: "image/png" } }]);
    log.startChapter("v2", [], "Heading north to Viridian.");
    log.add("user", "A new chapter.");
    const snap = log.snapshot();
    expect(snap).toMatchObject({ chapter: 2, system: "v2", total: 1, handoffs: [{ chapter: 1, text: "Heading north to Viridian." }] });
    expect(log.image(1)).toBeNull();
  });

  it("keeps usage when the conversation is rewritten", () => {
    const log = new ContextLog(100);
    log.startChapter("s", []);
    log.add("user", "hi");
    log.add("assistant", [{ type: "text", text: "ok" }], { usage });
    log.add("system", "glitch");
    log.replace([
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
      { role: "user", content: "[glitch]" },
    ]);
    const snap = log.snapshot();
    expect(snap.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(snap.messages[1]!.usage?.prompt).toBe(1210);
  });
});
