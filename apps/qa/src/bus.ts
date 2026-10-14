// The run's record and its HTTP face. Everything the player does goes through `emit`, which
// appends to the run's events.jsonl and pushes to every SSE listener (the stream page, the
// developer's `pnpm qa inbox --wait`). Bugs and the notebook live beside the runs, so numbering
// and notes carry over from one run to the next.
import type { AddressInfo } from "node:net";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ContextLog } from "./context.ts";
import { byPriority, type Bug, type BugStatus, type ChatEvent, type ChatTag, type GlitchEvent, type QaEvent, type Snapshot, type StatusEvent } from "./events.ts";

/** Distributes `Omit` over a union, so each event keeps its own fields. */
type Draft<E> = E extends { id: number; at: number } ? Omit<E, "id" | "at"> : E;

const FEED_LENGTH = 40;
const CHAT_LENGTH = 60;
const BUG_STATUSES: BugStatus[] = ["open", "fixing", "fixed", "wontfix"];
const CHAT_TAGS: ChatTag[] = ["bug", "fixed", "harness", "question", "note", "prompt"];

export class Bus {
  readonly root: string;
  readonly dir: string;
  /** The last turn of the previous run, so turn numbers carry on across restarts. */
  readonly lastTurn: number = 0;
  #nextId = 1;
  #status: StatusEvent | null = null;
  #feed: Snapshot["feed"] = [];
  #chat: ChatEvent[] = [];
  #glitches: GlitchEvent[] = [];
  #bugs: Bug[];
  #listeners = new Set<(e: QaEvent) => void>();
  #server: Server | null = null;
  #live: ((listener: (jpeg: Buffer) => void) => () => void) | null = null;
  #context: ContextLog | null = null;
  /** The stream page sending the window as video (WebRTC), and viewers' offers waiting on its answers. */
  #broadcaster: ServerResponse | null = null;
  #offers = new Map<number, (answer: string | null) => void>();
  #nextOffer = 1;

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
    // And the end of the previous run's feed and its turn count, so a harness restart doesn't
    // blank the player's thoughts on stream or start the turns again from 1.
    const previous = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{4}-/.test(d.name) && join(root, d.name) !== this.dir && existsSync(join(root, d.name, "events.jsonl")))
      .map((d) => d.name)
      .sort()
      .at(-1);
    if (previous) {
      const events = readFileSync(join(root, previous, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as QaEvent);
      const feed = events.filter((e): e is Snapshot["feed"][number] => e.t === "thought" || e.t === "action");
      this.#feed = feed.slice(-FEED_LENGTH);
      this.lastTurn = Math.max(0, ...feed.map((e) => e.turn));
      this.#nextId = Math.max(this.#nextId, ...events.map((e) => ("id" in e ? e.id : 0))) + 1;
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
    const base: Omit<StatusEvent, "t"> = this.#status ?? { mode: "play", turn: 0, map: "", playTime: "0:00", fps: null };
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

  /** Where /context gets the player's model context from. */
  setContext(context: ContextLog): void {
    this.#context = context;
  }

  on(listener: (e: QaEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Serves the stream page and the developer CLI on localhost:
   * GET /snapshot, GET /events (SSE), GET /bugs/:id, POST /chat {text, tag?, bug?} (the developer
   * talking), POST /bugs/:id {status}, and the live view: GET /watch (a page) and /live.mjpeg.
   * The player's model context: GET /context[?after=N] (the current chapter as JSON, messages from
   * the Nth on), /context/image/<ref> (its images) and /context/view (a page that renders it).
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
    if (req.method === "GET" && url.pathname === "/context/view") return void res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(CONTEXT_PAGE);
    if (req.method === "GET" && url.pathname === "/context") {
      if (!this.#context) return send(res, 503, { error: "the player isn't running yet" });
      return send(res, 200, this.#context.snapshot(Number(url.searchParams.get("after")) || 0));
    }
    const imageMatch = /^\/context\/image\/(\d+)$/.exec(url.pathname);
    if (req.method === "GET" && imageMatch) {
      const image = this.#context?.image(Number(imageMatch[1]));
      if (!image) return send(res, 404, { error: "no such image (it may be from an earlier chapter)" });
      return void res.writeHead(200, { "content-type": image.mime, "cache-control": "private, max-age=86400" }).end(image.data);
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/watch")) return void res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(WATCH_PAGE);
    // WebRTC signalling, WHEP-like and without trickle ICE: a viewer posts its whole offer and
    // gets the whole answer back; the stream page (?broadcast) hears offers on /rtc/broadcaster
    // and posts answers to /rtc/answer.
    if (req.method === "GET" && url.pathname === "/rtc/broadcaster") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(": hello\n\n");
      this.#broadcaster?.end();
      this.#broadcaster = res;
      const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
      req.on("close", () => {
        clearInterval(ping);
        if (this.#broadcaster === res) this.#broadcaster = null;
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/rtc/offer") {
      const { sdp } = (await readJson(req)) as { sdp?: unknown };
      if (typeof sdp !== "string") return send(res, 400, { error: "sdp required" });
      if (!this.#broadcaster) return send(res, 503, { error: "the stream page isn't broadcasting" });
      const id = this.#nextOffer++;
      const answer = await new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 15_000);
        this.#offers.set(id, (a) => {
          clearTimeout(timer);
          resolve(a);
        });
        this.#broadcaster!.write(`data: ${JSON.stringify({ id, sdp })}\n\n`);
      });
      this.#offers.delete(id);
      return answer ? send(res, 200, { sdp: answer }) : send(res, 504, { error: "no answer from the stream page" });
    }
    if (req.method === "POST" && url.pathname === "/rtc/answer") {
      const { id, sdp } = (await readJson(req)) as { id?: unknown; sdp?: unknown };
      const pending = typeof id === "number" ? this.#offers.get(id) : undefined;
      if (!pending || typeof sdp !== "string") return send(res, 404, { error: "no such offer" });
      pending(sdp);
      return send(res, 200, {});
    }
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
<style>
html,body{margin:0;height:100%;background:#111;color:#fff;font:600 18px system-ui,sans-serif}
video,img{display:block;width:100%;height:100%;object-fit:contain}
#sound{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);padding:12px 22px;border-radius:999px;border:0;background:#e0702a;color:#fff;font:inherit}
</style>
</head><body>
<video id="v" playsinline autoplay muted></video>
<button id="sound" hidden>Tap for sound</button>
<script>
// Video and sound over WebRTC from the stream page; the silent picture feed if that isn't up.
const video = document.getElementById("v");
const sound = document.getElementById("sound");
function fallback() {
  const img = document.createElement("img");
  img.src = "/live.mjpeg";
  video.replaceWith(img);
  sound.hidden = true;
}
async function connect() {
  const pc = new RTCPeerConnection();
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });
  const stream = new MediaStream();
  pc.ontrack = (e) => { stream.addTrack(e.track); video.srcObject = stream; video.play().catch(() => {}); };
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise((r) => { if (pc.iceGatheringState === "complete") r(); else { pc.onicegatheringstatechange = () => pc.iceGatheringState === "complete" && r(); setTimeout(r, 3000); } });
  const res = await fetch("/rtc/offer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sdp: pc.localDescription.sdp }) });
  if (!res.ok) throw new Error(await res.text());
  await pc.setRemoteDescription({ type: "answer", sdp: (await res.json()).sdp });
  sound.hidden = false;
  pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") location.reload(); };
}
sound.onclick = () => { video.muted = false; video.play(); sound.hidden = true; };
connect().catch(fallback);
</script>
</body></html>`;

// The player's model context as a chat log (GET /context/view). Polls /context for messages past
// the last one it has (re-fetching that one too, since a reply arrives a block at a time), and
// starts over when a new chapter begins. Stays at the bottom unless the reader scrolled up.
const CONTEXT_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Player context</title>
<style>
:root{--bg:#121316;--panel:#1c1e23;--line:#2c2f36;--text:#e7e8ea;--muted:#9a9ea8;--user:#7fb4ff;--asst:#f0a35e;--sys:#c792ea;--err:#ff6b6b;--ok:#6fd08c}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,sans-serif}
header{position:sticky;top:0;z-index:2;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 16px}
header h1{font-size:16px;margin:0 0 6px}
.meter{height:6px;background:var(--line);border-radius:3px;overflow:hidden;margin-top:6px}
.meter div{height:100%;background:var(--ok)}
.muted{color:var(--muted);font-size:13px}
main{padding:12px 16px 80px;max-width:980px;margin:0 auto}
details.box{background:var(--panel);border:1px solid var(--line);border-radius:8px;margin:0 0 10px;padding:8px 12px}
details.box>summary{cursor:pointer;font-weight:600}
.msg{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:8px;margin:0 0 10px;padding:8px 12px}
.msg.user{border-left-color:var(--user)}.msg.assistant{border-left-color:var(--asst)}.msg.system{border-left-color:var(--sys)}
.who{font-weight:700;font-size:13px;display:flex;gap:8px;flex-wrap:wrap;align-items:baseline}
.user .who b{color:var(--user)}.assistant .who b{color:var(--asst)}.system .who b{color:var(--sys)}
.text{white-space:pre-wrap;word-break:break-word;margin:6px 0}
pre,.mono{font:12.5px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;margin:6px 0}
.user .text,.system .text{font:12.5px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace}
.call{font:12.5px ui-monospace,Menlo,monospace;color:var(--asst);margin:6px 0;white-space:pre-wrap;word-break:break-word}
details.result{border:1px solid var(--line);border-radius:6px;padding:4px 8px;margin:6px 0}
details.result>summary{cursor:pointer;font:12.5px ui-monospace,Menlo,monospace;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
details.result.error>summary{color:var(--err)}
details.think>summary{cursor:pointer;color:var(--muted);font-size:13px}
img{display:block;max-width:100%;image-rendering:pixelated;border-radius:4px;margin:6px 0}
#pending{display:none;background:#3a2d12;border:1px solid #6b5220;border-radius:8px;padding:8px 12px;margin:0 0 10px;white-space:pre-wrap}
#down{position:fixed;right:16px;bottom:16px;display:none;padding:10px 16px;border-radius:999px;border:0;background:var(--asst);color:#111;font:600 14px system-ui}
#err{color:var(--err)}
</style>
</head><body>
<header><h1 id="title">Player context</h1><div class="muted" id="stats">Loading…</div><div class="meter"><div id="bar" style="width:0"></div></div><div id="err" class="muted"></div></header>
<main>
<div id="handoffs"></div>
<details class="box"><summary>System prompt</summary><pre id="system" style="white-space:pre-wrap"></pre></details>
<details class="box"><summary id="toolsTitle">Tools</summary><div id="tools"></div></details>
<div id="log"></div>
<div id="pending"></div>
</main>
<button id="down">New messages ↓</button>
<script>
const $ = (id) => document.getElementById(id);
const log = $("log");
let chapter = null, last = 0, handoffCount = -1;
const els = new Map();
const k = (n) => n >= 10000 ? (n / 1000).toFixed(0) + "k" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
const time = (at) => new Date(at).toTimeString().slice(0, 8);
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function nearBottom() { return document.documentElement.scrollHeight - window.scrollY - window.innerHeight < 120; }
function firstLine(blocks) {
  for (const b of blocks) if (b.type === "text" && b.text.trim()) return b.text.trim().split("\\n")[0];
  return blocks.some((b) => b.type === "image") ? "(image)" : "(empty)";
}
function renderBlock(b, role) {
  if (b.type === "text") return el("div", "text", b.text);
  if (b.type === "thinking") { const d = el("details", "think"); d.append(el("summary", null, b.text ? "thinking" : "thinking (hidden)")); if (b.text) d.append(el("div", "text", b.text)); return d; }
  if (b.type === "image") { const i = el("img"); i.loading = "lazy"; i.src = "/context/image/" + b.ref; i.alt = "image the model saw"; return i; }
  if (b.type === "tool_use") return el("div", "call", "→ " + b.name + " " + JSON.stringify(b.input));
  if (b.type === "tool_result") {
    const d = el("details", "result" + (b.isError ? " error" : ""));
    d.dataset.key = b.toolUseId;
    const imgs = b.content.filter((c) => c.type === "image").length;
    d.append(el("summary", null, (b.isError ? "✗ " : "← ") + firstLine(b.content) + (imgs ? "  [+" + imgs + " image" + (imgs > 1 ? "s" : "") + "]" : "")));
    for (const c of b.content) { const e = renderBlock(c, role); if (c.type === "text") e.className = "mono"; d.append(e); }
    return d;
  }
  return el("div", "muted", "[" + b.kind + " block]");
}
function renderMessage(m, openResults) {
  const box = el("div", "msg " + m.role);
  const who = el("div", "who");
  who.append(el("b", null, m.role === "assistant" ? "Player (model)" : m.role === "system" ? "System" : m.blocks.some((b) => b.type === "tool_result") ? "Tool results" : "User"));
  who.append(el("span", "muted", "#" + m.n + " · " + time(m.at)));
  if (m.usage) { const u = m.usage; who.append(el("span", "muted", "prompt " + k(u.prompt) + " (cache read " + k(u.cacheRead) + ", write " + k(u.cacheWrite) + ", new " + k(u.input) + ") · out " + k(u.output))); }
  box.append(who);
  for (const b of m.blocks) { const e = renderBlock(b, m.role); if (b.type === "tool_result" && openResults.has(b.toolUseId)) e.open = true; box.append(e); }
  return box;
}
function header(s) {
  $("title").textContent = "Player context · chapter " + s.chapter;
  const pct = Math.min(100, (s.contextTokens / s.limit) * 100);
  $("stats").textContent = "Started " + time(s.startedAt) + " · context " + k(s.contextTokens) + " / " + k(s.limit) + " (" + pct.toFixed(0) + "%) · output " + k(s.outputTokens) + " · " + s.total + " messages";
  $("bar").style.width = pct + "%";
  $("bar").style.background = pct > 90 ? "var(--err)" : pct > 70 ? "var(--asst)" : "var(--ok)";
  const p = $("pending");
  p.style.display = s.pending.length ? "block" : "none";
  p.textContent = s.pending.length ? "Developer messages waiting for the next tool result:\\n" + s.pending.join("\\n") : "";
  if (s.handoffs.length !== handoffCount) {
    handoffCount = s.handoffs.length;
    const h = $("handoffs"); h.replaceChildren();
    for (const x of s.handoffs) { const d = el("details", "box"); d.append(el("summary", null, "Chapter " + x.chapter + " handoff · " + time(x.at))); d.append(el("div", "text", x.text || "(empty)")); h.append(d); }
  }
}
function newChapter(s) {
  chapter = s.chapter; last = 0; els.clear(); log.replaceChildren();
  $("system").textContent = s.system;
  $("toolsTitle").textContent = "Tools (" + s.tools.length + ")";
  const t = $("tools"); t.replaceChildren();
  for (const tool of s.tools) { const d = el("details", "result"); d.append(el("summary", null, tool.name)); d.append(el("div", "text", tool.description)); d.append(el("pre", null, JSON.stringify(tool.inputSchema, null, 2))); t.append(d); }
}
async function poll() {
  try {
    let res = await fetch("/context?after=" + last, { cache: "no-store" });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    let s = await res.json();
    if (s.chapter !== chapter) {
      if (last > 0) { res = await fetch("/context", { cache: "no-store" }); s = await res.json(); }
      newChapter(s);
    }
    $("err").textContent = "";
    const stick = nearBottom();
    const before = last;
    header(s);
    for (const m of s.messages) {
      const old = els.get(m.n);
      const json = JSON.stringify(m);
      if (old && old.dataset.json === json) continue;
      const open = new Set();
      if (old) old.querySelectorAll("details.result[open]").forEach((d) => open.add(d.dataset.key));
      const e = renderMessage(m, open);
      e.dataset.json = json;
      if (old) old.replaceWith(e); else log.append(e);
      els.set(m.n, e);
      last = Math.max(last, m.n);
    }
    if (stick && s.messages.length) window.scrollTo(0, document.documentElement.scrollHeight);
    else if (!stick && last > before) $("down").style.display = "block";
  } catch (e) {
    $("err").textContent = "Can't reach the harness (" + e.message + "); retrying…";
  }
  setTimeout(poll, 2000);
}
window.addEventListener("scroll", () => { if (nearBottom()) $("down").style.display = "none"; });
$("down").onclick = () => { window.scrollTo(0, document.documentElement.scrollHeight); $("down").style.display = "none"; };
poll().then(() => window.scrollTo(0, document.documentElement.scrollHeight));
</script>
</body></html>`;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of req) text += String(chunk);
  return text ? JSON.parse(text) : {};
}
