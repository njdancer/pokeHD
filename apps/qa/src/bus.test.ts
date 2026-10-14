import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Bus } from "./bus.ts";
import { ContextLog, type ContextSnapshot } from "./context.ts";
import type { ChatEvent, QaEvent, Snapshot } from "./events.ts";

const roots: string[] = [];
const buses: Bus[] = [];
afterEach(() => {
  for (const b of buses.splice(0)) b.close();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function bus(root = mkdtempSync(join(tmpdir(), "qa-bus-"))): Bus {
  roots.push(root);
  const b = new Bus(root);
  buses.push(b);
  return b;
}

const bug = { turn: 3, steps: "s", expected: "e", actual: "a" };

describe("Bus", () => {
  it("keeps bugs in priority order and numbering across runs", () => {
    const first = bus();
    first.addBug({ ...bug, title: "cosmetic", severity: "low" });
    first.addBug({ ...bug, title: "blocker", severity: "high" });
    first.updateBug(2, { status: "fixed" });
    const second = new Bus(first.root);
    buses.push(second);
    const third = second.addBug({ ...bug, title: "wrong", severity: "med" });
    expect(third.id).toBe(3);
    expect(second.snapshot().bugs.map((b) => b.title)).toEqual(["wrong", "cosmetic", "blocker"]);
  });

  it("serves the snapshot and events, and takes the developer's messages", async () => {
    const b = bus();
    const port = await b.listen(0);
    const seen: QaEvent[] = [];
    b.on((e) => seen.push(e));
    b.addBug({ ...bug, title: "flash", severity: "med" });
    const res = await fetch(`http://127.0.0.1:${port}/chat`, { method: "POST", body: JSON.stringify({ text: "Fixed it", tag: "fixed", bug: 1 }) });
    const chat = (await res.json()) as ChatEvent;
    expect(chat).toMatchObject({ t: "chat", from: "developer", tag: "fixed", bug: 1 });
    const snap = (await (await fetch(`http://127.0.0.1:${port}/snapshot`)).json()) as Snapshot;
    expect(snap.bugs[0]!.status).toBe("fixed");
    expect(snap.chat.at(-1)!.text).toBe("Fixed it");
    expect(seen.map((e) => e.t)).toEqual(["bugs", "bugs", "chat"]);
    expect(readFileSync(join(b.dir, "events.jsonl"), "utf8").trim().split("\n")).toHaveLength(3);
  });

  it("serves the player's context, its images and the viewer page", async () => {
    const b = bus();
    const port = await b.listen(0);
    const base = `http://127.0.0.1:${port}`;
    expect((await fetch(`${base}/context`)).status).toBe(503);
    const log = new ContextLog(150_000);
    log.startChapter("prompt", []);
    log.add("user", [{ type: "image", source: { data: Buffer.from("png").toString("base64"), media_type: "image/png" } }]);
    log.add("assistant", [{ type: "text", text: "hi" }]);
    b.setContext(log);
    const snap = (await (await fetch(`${base}/context?after=2`)).json()) as ContextSnapshot;
    expect(snap.messages.map((m) => m.n)).toEqual([2]);
    const image = await fetch(`${base}/context/image/1`);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await image.arrayBuffer()).toString()).toBe("png");
    expect((await fetch(`${base}/context/image/9`)).status).toBe(404);
    const page = await fetch(`${base}/context/view`);
    expect(page.headers.get("content-type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain('fetch("/context?after="');
    // The page's script survives being a template literal: it parses.
    expect(() => new Function(html.split("<script>")[1]!.split("</script>")[0]!)).not.toThrow();
  });

  it("streams the live view as motion JPEG", async () => {
    const b = bus();
    const listeners = new Set<(jpeg: Buffer) => void>();
    b.setLive((l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    });
    const port = await b.listen(0);
    const res = await fetch(`http://127.0.0.1:${port}/live.mjpeg`);
    expect(res.headers.get("content-type")).toContain("multipart/x-mixed-replace");
    const reader = res.body!.getReader();
    for (const l of listeners) l(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    let text = "";
    while (!text.includes("\r\n\r\n")) text += Buffer.from((await reader.read()).value!).toString("latin1");
    expect(text).toContain("--frame\r\ncontent-type: image/jpeg\r\ncontent-length: 4");
    await reader.cancel();
  });
});
