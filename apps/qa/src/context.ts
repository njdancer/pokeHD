// What the player's model sees, kept for the bus's context viewer (GET /context, /context/view):
// the current chapter's system prompt, tools and every message as it went to the model or came
// back from it, with each reply's token usage. It only records copies; nothing here changes what
// is sent. Images are kept aside and served one by one, so the JSON stays small.

/** A content block, as the viewer gets it. Images are references to GET /context/image/<ref>. */
export type ViewBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "image"; ref: number }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; isError?: boolean; content: ViewBlock[] }
  | { type: "other"; kind: string };

export interface Usage {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  /** The whole prompt this reply answered: input + cache read + cache write. */
  prompt: number;
}

export interface ViewMessage {
  /** Position in the chapter, from 1. */
  n: number;
  at: number;
  role: "user" | "assistant" | "system";
  blocks: ViewBlock[];
  usage?: Usage;
}

export interface ContextSnapshot {
  chapter: number;
  startedAt: number;
  system: string;
  tools: { name: string; description: string; inputSchema: unknown }[];
  /** The chapter limit: past this prompt size the player hands off to a new chapter. */
  limit: number;
  /** The latest reply's prompt plus its output: about what the next request will start from. */
  contextTokens: number;
  /** Output tokens over the whole chapter. */
  outputTokens: number;
  /** Developer messages that arrived but haven't reached the model yet (they ride on the next tool result). */
  pending: string[];
  /** Earlier chapters' handoffs in this run, oldest first. */
  handoffs: { chapter: number; at: number; text: string }[];
  /** Messages with n > `after` (all of them when not asked), plus the last one again, since a reply can grow. */
  messages: ViewMessage[];
  total: number;
}

/** Content as either API speaks it: a string, or blocks (text, image, tool_use, tool_result, thinking…). */
type RawContent = string | readonly unknown[];

interface Image {
  mime: string;
  data: Buffer;
}

export class ContextLog {
  readonly limit: number;
  /** Developer messages not yet delivered; the player wires this to its toolbox. */
  pending: () => string[] = () => [];
  #chapter = 0;
  #startedAt = 0;
  #system = "";
  #tools: ContextSnapshot["tools"] = [];
  #messages: ViewMessage[] = [];
  /** The API message id behind the last assistant message, so Claude Code's one-block-at-a-time replies merge. */
  #lastId: string | null = null;
  #images = new Map<number, Image>();
  #nextImage = 1;
  #handoffs: ContextSnapshot["handoffs"] = [];

  constructor(limit: number) {
    this.limit = limit;
  }

  get chapter(): number {
    return this.#chapter;
  }

  /** A fresh conversation. `handoff` is what the previous chapter left for this one. */
  startChapter(system: string, tools: ContextSnapshot["tools"], handoff?: string): void {
    if (handoff !== undefined && this.#chapter > 0) this.#handoffs.push({ chapter: this.#chapter, at: Date.now(), text: handoff });
    this.#chapter++;
    this.#startedAt = Date.now();
    this.#system = system;
    this.#tools = tools;
    this.#messages = [];
    this.#lastId = null;
    this.#images.clear();
  }

  /**
   * Records one message. An assistant message with the same `id` as the one before it (Claude Code
   * sends a reply one content block at a time) is merged into it.
   */
  add(role: ViewMessage["role"], content: RawContent, opts: { id?: string; usage?: RawUsage | null } = {}): void {
    const blocks = typeof content === "string" ? [{ type: "text" as const, text: content }] : content.map((b) => this.#block(b));
    const usage = opts.usage ? toUsage(opts.usage) : undefined;
    const last = this.#messages.at(-1);
    if (role === "assistant" && opts.id && last?.role === "assistant" && this.#lastId === opts.id) {
      last.blocks.push(...blocks);
      if (usage) last.usage = usage;
      return;
    }
    this.#lastId = role === "assistant" ? (opts.id ?? null) : null;
    this.#messages.push({ n: this.#messages.length + 1, at: Date.now(), role, blocks, ...(usage && { usage }) });
  }

  /** Replaces the whole conversation (when the API side rewrites its history). */
  replace(messages: readonly { role: ViewMessage["role"]; content: RawContent }[]): void {
    const usage = new Map(this.#messages.map((m) => [m.n, m.usage]));
    this.#messages = [];
    this.#lastId = null;
    this.#images.clear();
    for (const m of messages) this.add(m.role, m.content);
    for (const m of this.#messages) {
      const u = usage.get(m.n);
      if (u && m.role === "assistant") m.usage = u;
    }
  }

  image(ref: number): Image | null {
    return this.#images.get(ref) ?? null;
  }

  snapshot(after = 0): ContextSnapshot {
    const replies = this.#messages.filter((m) => m.usage);
    const latest = replies.at(-1)?.usage;
    let pending: string[] = [];
    try {
      pending = this.pending();
    } catch {
      pending = [];
    }
    return {
      chapter: this.#chapter,
      startedAt: this.#startedAt,
      system: this.#system,
      tools: this.#tools,
      limit: this.limit,
      contextTokens: latest ? latest.prompt + latest.output : 0,
      outputTokens: replies.reduce((sum, m) => sum + m.usage!.output, 0),
      pending,
      handoffs: this.#handoffs,
      messages: this.#messages.filter((m) => m.n >= Math.max(1, after)),
      total: this.#messages.length,
    };
  }

  #block(raw: unknown): ViewBlock {
    const b = (raw ?? {}) as Record<string, unknown>;
    switch (b["type"]) {
      case "text":
        return { type: "text", text: String(b["text"] ?? "") };
      case "thinking":
        return { type: "thinking", text: String(b["thinking"] ?? "") };
      case "redacted_thinking":
        return { type: "thinking", text: "" };
      case "image": {
        const ref = this.#image(b);
        return ref === null ? { type: "other", kind: "image" } : { type: "image", ref };
      }
      case "tool_use":
        return { type: "tool_use", id: String(b["id"] ?? ""), name: String(b["name"] ?? ""), input: b["input"] };
      case "tool_result": {
        const content = b["content"];
        const blocks = typeof content === "string" ? [{ type: "text" as const, text: content }] : Array.isArray(content) ? content.map((c) => this.#block(c)) : [];
        return { type: "tool_result", toolUseId: String(b["tool_use_id"] ?? ""), ...(b["is_error"] === true && { isError: true }), content: blocks };
      }
      default:
        return { type: "other", kind: String(b["type"] ?? "unknown") };
    }
  }

  /** Keeps a base64 image (API shape `source: {data, media_type}`, or MCP shape `data, mimeType`) and returns its reference. */
  #image(b: Record<string, unknown>): number | null {
    const source = (b["source"] ?? b) as Record<string, unknown>;
    const data = source["data"];
    if (typeof data !== "string") return null;
    const mime = String(source["media_type"] ?? source["mimeType"] ?? "image/png");
    const ref = this.#nextImage++;
    this.#images.set(ref, { mime: /^image\/[a-z+.-]+$/.test(mime) ? mime : "image/png", data: Buffer.from(data, "base64") });
    return ref;
  }
}

/** Usage as both APIs report it. */
export interface RawUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

function toUsage(u: RawUsage): Usage {
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  return { input: u.input_tokens, cacheRead, cacheWrite, output: u.output_tokens, prompt: u.input_tokens + cacheRead + cacheWrite };
}
