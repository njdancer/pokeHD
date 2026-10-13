// pnpm qa <command>: runs the player, and gives the developer its side of the conversation.
//
//   run [--app URL] [--port 4545] [--model ID] [--turns N] [--headless] [--game]
//                         Start the game, the bus and the player. Needs ANTHROPIC_API_KEY and the
//                         app served at --app (default http://localhost:5173, `pnpm dev`).
//                         --game opens the game page alone instead of the stream page.
//   inbox [--wait]        The chat. --wait blocks until the player's next message, then prints it.
//   say TEXT [--bug N] [--tag fixed|harness|question|note]
//                         Message the player (unpauses it if it's waiting). --tag fixed --bug N
//                         also marks the bug fixed.
//   bugs [--all]          Open bugs by priority (--all includes fixed ones).
//   bug N [STATUS]        A bug's report and attachment folder; with STATUS (open, fixing, fixed,
//                         wontfix) sets it.
//   status                What the player is doing.
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { Bus } from "./bus.ts";
import type { Bug, ChatEvent, QaEvent, Snapshot } from "./events.ts";
import { createDriver } from "./game/driver.ts";
import { DEFAULT_MODEL, Player } from "./player.ts";

const RUNS = fileURLToPath(new URL("../runs/", import.meta.url));

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    app: { type: "string", default: "http://localhost:5173" },
    port: { type: "string", default: "4545" },
    model: { type: "string", default: DEFAULT_MODEL },
    turns: { type: "string" },
    headless: { type: "boolean", default: false },
    game: { type: "boolean", default: false },
    wait: { type: "boolean", default: false },
    all: { type: "boolean", default: false },
    bug: { type: "string" },
    tag: { type: "string" },
  },
});
const [command, ...rest] = positionals;
const bus = `http://127.0.0.1:${values.port}`;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(bus + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json;
}

const time = (at: number) => new Date(at).toTimeString().slice(0, 5);
const chatLine = (c: ChatEvent) => `${time(c.at)} ${c.from === "player" ? "Haiku" : "Opus "}${c.tag ? ` [${c.tag}${c.bug !== undefined ? ` #${c.bug}` : ""}]` : ""}: ${c.text}`;
const bugLine = (b: Bug) => `#${b.id} ${b.severity.padEnd(4)} ${b.status.padEnd(7)} turn ${b.turn}: ${b.title}`;

switch (command) {
  case "run": {
    if (!process.env["ANTHROPIC_API_KEY"]) throw new Error("Set ANTHROPIC_API_KEY first.");
    const run = new Bus(RUNS);
    await run.listen(Number(values.port));
    const streamUrl = `${values.app}/dev/stream?bus=${encodeURIComponent(bus)}`;
    console.log(`Run folder ${run.dir}\nBus ${bus}\nStream ${streamUrl}`);
    const driver = createDriver({ appUrl: values.app, runDir: run.dir, headless: values.headless, ...(values.game && { streamPath: "game" }) });
    const player = new Player({ bus: run, driver, model: values.model, ...(values.turns && { maxTurns: Number(values.turns) }) });
    const stop = () => player.stop();
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    run.on((e) => {
      if (e.t === "thought") console.log(`💭 ${e.text}`);
      if (e.t === "action") console.log(`   ${e.turn} ${e.label}`);
      if (e.t === "chat") console.log(chatLine(e));
      if (e.t === "glitch") console.log(`⚠️  ${e.text}`);
    });
    try {
      run.setStatus({ mode: "play" });
      await player.run(await driver.start());
    } finally {
      await driver.close();
      run.close();
    }
    break;
  }
  case "inbox": {
    const snap = await api<Snapshot>("/snapshot");
    for (const c of snap.chat.slice(-12)) console.log(chatLine(c));
    if (!values.wait) break;
    // Waits on the event stream for the player's next message.
    const res = await fetch(`${bus}/events`);
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of res.body!) {
      buffer += decoder.decode(chunk as Uint8Array, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const event = JSON.parse(line.slice(6)) as QaEvent;
        if (event.t === "chat" && event.from === "player") {
          console.log(chatLine(event));
          process.exit(0);
        }
      }
    }
    break;
  }
  case "say": {
    const text = rest.join(" ");
    const sent = await api<ChatEvent>("/chat", { text, ...(values.tag && { tag: values.tag }), ...(values.bug && { bug: Number(values.bug) }) });
    console.log(chatLine(sent));
    break;
  }
  case "bugs": {
    const snap = await api<Snapshot>("/snapshot");
    const list = values.all ? snap.bugs : snap.bugs.filter((b) => b.status === "open" || b.status === "fixing");
    console.log(list.length ? list.map(bugLine).join("\n") : "No open bugs.");
    break;
  }
  case "bug": {
    const id = Number(rest[0]);
    if (rest[1]) await api<Bug>(`/bugs/${id}`, { status: rest[1] });
    const b = await api<Bug & { dir: string }>(`/bugs/${id}`);
    console.log(`${bugLine(b)}\n\nSteps: ${b.steps}\nExpected: ${b.expected}\nActual: ${b.actual}\n\nAttachments in ${b.dir}: ${b.attachments.join(", ") || "none"}`);
    break;
  }
  case "status": {
    const snap = await api<Snapshot>("/snapshot");
    const s = snap.status;
    console.log(s ? `Turn ${s.turn}, ${s.mode === "talk" ? "waiting for you" : "playing"} in ${s.map || "?"} (${s.playTime}). Goal: ${s.goal || "none"}` : "No status yet.");
    for (const f of snap.feed.slice(-8)) console.log(f.t === "thought" ? `💭 ${f.text}` : `   ${f.turn} ${f.label}`);
    break;
  }
  default:
    console.log("Usage: pnpm qa run | inbox [--wait] | say TEXT [--bug N --tag T] | bugs [--all] | bug N [STATUS] | status");
}
