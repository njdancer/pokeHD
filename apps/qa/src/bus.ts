// The run's record and its HTTP face. Everything the player does goes through `emit`, which
// appends to the run's events.jsonl and pushes to every SSE listener (the stream page, the
// developer's `pnpm qa inbox --wait`). Bugs and the notebook live beside the runs, so numbering
// and notes carry over from one run to the next.
import type { AddressInfo } from "node:net";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { byPriority, type Bug, type BugStatus, type ChatEvent, type ChatTag, type GlitchEvent, type QaEvent, type Snapshot, type StatusEvent } from "./events.ts";

/** Distributes `Omit` over a union, so each event keeps its own fields. */
type Draft<E> = E extends { id: number; at: number } ? Omit<E, "id" | "at"> : E;

const FEED_LENGTH = 40;
const CHAT_LENGTH = 60;
const BUG_STATUSES: BugStatus[] = ["open", "fixing", "fixed", "wontfix"];
const CHAT_TAGS: ChatTag[] = ["bug", "fixed", "harness", "question", "note"];

export class Bus {
  readonly root: string;
  readonly dir: string;
  #nextId = 1;
  #status: StatusEvent | null = null;
  #feed: Snapshot["feed"] = [];
  #chat: ChatEvent[] = [];
  #glitches: GlitchEvent[] = [];
  #bugs: Bug[];
  #listeners = new Set<(e: QaEvent) => void>();
  #server: Server | null = null;
  #live: ((listener: (jpeg: Buffer) => void) => () => void) | null = null;

  /** `root` holds every run (runs/), the shared bugs.json and notebook.md; this run gets its own folder. */
  constructor(root: string) {
    this.root = root;
    this.dir = join(root, new Date().toISOString().replace(/[:.]/g, "-"));
    mkdirSync(this.dir, { recursive: true });
    this.#bugs = existsSync(this.#bugsPath) ? (JSON.parse(readFileSync(this.#bugsPath, "utf8")) as Bug[]) : [];
    // The chat carries over too, so the stream doesn't start blank after a restart.
    if (existsSync(this.#chatPath)) {
      this.#chat = readFileSync(this.#chatPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as ChatEvent).slice(-CHAT_LENGTH);
      this.#nextId = Math.max(0, ...this.#chat.map((c) => c.id)) + 1;
    }
  }

  get #bugsPath(): string {
    return join(this.root, "bugs.json");
  }

  get #chatPath(): string {
    return join(this.root, "chat.jsonl");
  }

  get notebookPath(): string {
    return join(this.root, "notebook.md");
  }

  get bugs(): readonly Bug[] {
    return this.#bugs;
  }

  get status(): StatusEvent | null {
    return this.#status;
  }

  snapshot(): Snapshot {
    return { status: this.#status, feed: this.#feed, chat: this.#chat, bugs: [...this.#bugs].sort(byPriority), glitches: this.#glitches };
  }

  /** Records an event (giving it an id and time) and sends it to every listener. */
  emit<E extends QaEvent>(draft: Draft<E>): E {
    const event = (draft.t === "status" || draft.t === "bugs" ? draft : { id: this.#nextId++, at: Date.now(), ...draft }) as E;
    switch (event.t) {
      case "status":
        this.#status = event;
        break;
      case "thought":
      case "action":
        this.#feed.push(event);
        if (this.#feed.length > FEED_LENGTH) this.#feed.shift();
        break;
      case "chat":
        this.#chat.push(event);
        if (this.#chat.length > CHAT_LENGTH) this.#chat.shift();
        appendFileSync(this.#chatPath, JSON.stringify(event) + "\n");
        break;
      case "glitch":
        this.#glitches.push(event);
        if (this.#glitches.length > FEED_LENGTH) this.#glitches.shift();
        break;
      case "bugs":
        break;
    }
    appendFileSync(join(this.dir, "events.jsonl"), JSON.stringify(event) + "\n");
    for (const listener of this.#listeners) listener(event);
    return event;
  }

  /** Updates the status line, keeping whatever isn't given. */
  setStatus(patch: Partial<Omit<StatusEvent, "t">>): void {
    const base: Omit<StatusEvent, "t"> = this.#status ?? { mode: "play", turn: 0, goal: "", map: "", playTime: "0:00", fps: null };
    this.emit<StatusEvent>({ t: "status", ...base, ...patch });
  }

  addBug(bug: Omit<Bug, "id" | "at" | "status" | "attachments">): Bug {
    const full: Bug = { ...bug, id: Math.max(0, ...this.#bugs.map((b) => b.id)) + 1, at: Date.now(), status: "open", attachments: [] };
    this.#bugs.push(full);
    this.#saveBugs();
    return full;
  }

  updateBug(id: number, patch: Partial<Pick<Bug, "status" | "attachments" | "severity">>): Bug | null {
    const bug = this.#bugs.find((b) => b.id === id);
    if (!bug) return null;
    Object.assign(bug, patch);
    this.#saveBugs();
    return bug;
  }

  bugDir(id: number): string {
    const dir = join(this.root, "bugs", String(id));
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  #saveBugs(): void {
    writeFileSync(this.#bugsPath, JSON.stringify(this.#bugs, null, 2));
    this.emit({ t: "bugs", list: [...this.#bugs].sort(byPriority) });
  }

  /** Where /live.mjpeg gets its frames: the game driver's recording of the whole window. */
  setLive(subscribe: (listener: (jpeg: Buffer) => void) => () => void): void {
    this.#live = subscribe;
  }

  on(listener: (e: QaEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Serves the stream page and the developer CLI on localhost:
   * GET /snapshot, GET /events (SSE), GET /bugs/:id, POST /chat {text, tag?, bug?} (the developer
   * talking), POST /bugs/:id {status}, and the live view: GET /watch (a page) and /live.mjpeg.
   * `host` 0.0.0.0 makes it reachable from other devices on the network.
   */
  listen(port: number, host = "127.0.0.1"): Promise<number> {
    const server = createServer((req, res) => {
      void this.#handle(req, res).catch((error: unknown) => send(res, 500, { error: String(error) }));
    });
    this.#server = server;
    return new Promise((resolve) => server.listen(port, host, () => resolve((server.address() as AddressInfo).port)));
  }

  close(): void {
    this.#server?.close();
    this.#server?.closeAllConnections();
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    if (req.method === "OPTIONS") return void res.writeHead(204).end();
    const url = new URL(req.url ?? "/", "http://localhost");
    const bugMatch = /^\/bugs\/(\d+)$/.exec(url.pathname);
    if (req.method === "GET" && url.pathname === "/snapshot") return send(res, 200, this.snapshot());
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/watch")) return void res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(WATCH_PAGE);
    if (req.method === "GET" && url.pathname === "/live.mjpeg") {
      if (!this.#live) return send(res, 503, { error: "the game isn't running yet" });
      // Motion JPEG: every frame replaces the last; <img> plays it in any browser, Safari included.
      res.writeHead(200, { "content-type": "multipart/x-mixed-replace; boundary=frame", "cache-control": "no-cache" });
      res.flushHeaders();
      let busy = false;
      const off = this.#live((jpeg) => {
        // A slow viewer skips frames rather than queueing them.
        if (busy) return;
        busy = !res.write(`--frame\r\ncontent-type: image/jpeg\r\ncontent-length: ${jpeg.length}\r\n\r\n`);
        busy = !res.write(jpeg) || busy;
        res.write("\r\n");
        if (busy) res.once("drain", () => (busy = false));
      });
      req.on("close", off);
      return;
    }
    if (req.method === "GET" && url.pathname === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(": hello\n\n");
      const off = this.on((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
      const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
      req.on("close", () => {
        off();
        clearInterval(ping);
      });
      return;
    }
    if (req.method === "GET" && bugMatch) {
      const bug = this.#bugs.find((b) => b.id === Number(bugMatch[1]));
      return bug ? send(res, 200, { ...bug, dir: this.bugDir(bug.id) }) : send(res, 404, { error: "no such bug" });
    }
    if (req.method === "POST" && url.pathname === "/chat") {
      const body = (await readJson(req)) as { text?: unknown; tag?: unknown; bug?: unknown };
      if (typeof body.text !== "string" || !body.text.trim()) return send(res, 400, { error: "text required" });
      const tag = CHAT_TAGS.includes(body.tag as ChatTag) ? (body.tag as ChatTag) : undefined;
      const bug = typeof body.bug === "number" ? body.bug : undefined;
      if (tag === "fixed" && bug !== undefined) this.updateBug(bug, { status: "fixed" });
      const event = this.emit<ChatEvent>({ t: "chat", from: "developer", text: body.text.trim(), ...(tag && { tag }), ...(bug !== undefined && { bug }) });
      return send(res, 200, event);
    }
    if (req.method === "POST" && bugMatch) {
      const body = (await readJson(req)) as { status?: unknown };
      if (!BUG_STATUSES.includes(body.status as BugStatus)) return send(res, 400, { error: `status must be one of ${BUG_STATUSES.join(", ")}` });
      const bug = this.updateBug(Number(bugMatch[1]), { status: body.status as BugStatus });
      return bug ? send(res, 200, bug) : send(res, 404, { error: "no such bug" });
    }
    send(res, 404, { error: "not found" });
  }
}

const WATCH_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Claude QA live</title>
<style>html,body{margin:0;height:100%;background:#111}img{display:block;width:100%;height:100%;object-fit:contain}</style>
</head><body><img src="/live.mjpeg" alt="The QA stream, live"></body></html>`;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of req) text += String(chunk);
  return text ? JSON.parse(text) : {};
}
