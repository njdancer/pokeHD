import { DurableObject } from "cloudflare:workers";
import { CloseCode, ROOM_KEEPALIVE_MS, type PlayerInfo, type Presence, type ServerMessage } from "@pokehd/protocol";
import { join, leave, quietPeers, receive, type GiftStore, type Peer, type StoredGift } from "./room.ts";

/** Headers the Worker sets on the upgrade request it forwards, after checking the session. */
export const PLAYER_ID_HEADER = "x-pokehd-player-id";
export const PLAYER_NAME_HEADER = "x-pokehd-player-name";

interface Attachment {
  player: PlayerInfo;
  presence: Presence | null;
  /** When it connected, and when it last sent a message (pings are counted by the runtime). */
  joinedAt?: number;
  heardAt?: number;
}

/**
 * A shared world (p3-rooms): everyone connected sees everyone else's ghost. Uses hibernatable
 * WebSockets, so an idle room costs nothing; each socket's player and last presence live in its
 * attachment and survive hibernation.
 */
export class Room extends DurableObject<Env> {
  readonly #gifts: GiftStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#gifts = giftStore(ctx.storage.kv);
    // Keepalives are answered without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  override async fetch(request: Request): Promise<Response> {
    const id = request.headers.get(PLAYER_ID_HEADER);
    const name = request.headers.get(PLAYER_NAME_HEADER);
    if (request.headers.get("upgrade") !== "websocket" || !id || name === null) {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ player: { id, name: decodeURIComponent(name) }, presence: null, joinedAt: Date.now() } satisfies Attachment);
    join(this.#peers(), peer(server), this.#gifts);
    await this.#watch();
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const attachment = ws.deserializeAttachment() as Attachment;
    const now = Date.now();
    // Noted at most once a heartbeat, not for every presence update.
    if (now - (attachment.heardAt ?? 0) > ROOM_KEEPALIVE_MS) ws.serializeAttachment({ ...attachment, heardAt: now });
    receive(this.#peers(), peer(ws), message, this.#gifts);
  }

  /**
   * The heartbeat check (D40): connections not heard from for ROOM_QUIET_MS are closed, so their
   * ghosts leave. Runs every heartbeat while anyone is connected; an empty room sleeps.
   */
  override async alarm(): Promise<void> {
    const now = Date.now();
    const lastHeard = (ws: WebSocket) => {
      const a = ws.deserializeAttachment() as Attachment;
      return Math.max(a.joinedAt ?? now, a.heardAt ?? 0, this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0);
    };
    const open = this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.READY_STATE_OPEN);
    for (const ws of quietPeers(open, lastHeard, now)) {
      const gone = peer(ws);
      try {
        ws.close(CloseCode.quiet, "Gone quiet");
      } catch {
        // Already closing.
      }
      leave(this.#peers(), gone);
    }
    await this.#watch();
  }

  /** Keeps the heartbeat check running while anyone is connected. */
  async #watch(): Promise<void> {
    if (this.#peers().length === 0) return;
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + ROOM_KEEPALIVE_MS);
  }

  override webSocketClose(ws: WebSocket, code: number): void {
    leave(this.#peers(), peer(ws));
    try {
      ws.close(code === 1005 ? 1000 : code, "Bye");
    } catch {
      // Already closed (the runtime may have answered the close frame itself).
    }
  }

  override webSocketError(ws: WebSocket): void {
    leave(this.#peers(), peer(ws));
  }

  /** Open connections, as peers. Sockets already closing (e.g. just replaced) are left out. */
  #peers(): Peer[] {
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws.readyState === WebSocket.READY_STATE_OPEN)
      .map(peer);
  }
}

/** Wraps a socket as a `Peer`. `room.ts` compares peers by identity, so each socket keeps one. */
const wrappers = new WeakMap<WebSocket, Peer>();
function peer(ws: WebSocket): Peer {
  let p = wrappers.get(ws);
  if (p) return p;
  const attachment = ws.deserializeAttachment() as Attachment;
  p = {
    player: attachment.player,
    get presence() {
      return (ws.deserializeAttachment() as Attachment).presence;
    },
    set presence(presence) {
      ws.serializeAttachment({ ...(ws.deserializeAttachment() as Attachment), presence });
    },
    send(message: ServerMessage) {
      try {
        ws.send(JSON.stringify(message));
      } catch {
        // Closed under us; its close event tidies up.
      }
    },
    close(code: number, reason: string) {
      ws.close(code, reason);
    },
  };
  wrappers.set(ws, p);
  return p;
}

/**
 * Gifts in the room's SQLite-backed key-value storage, keyed `gift:<to>:<sent at>:<id>` so a
 * receiver's gifts list in the order they were sent. An index key maps a gift ID to its full
 * key, which makes a resend a no-op and an acknowledgement a single lookup.
 */
function giftStore(kv: SyncKvStorage): GiftStore {
  const index = (to: string, id: string) => `gift-id:${to}:${id}`;
  return {
    put(to, gift) {
      if (kv.get(index(to, gift.id)) !== undefined) return;
      const key = `gift:${to}:${Date.now().toString().padStart(15, "0")}:${gift.id}`;
      kv.put(key, gift);
      kv.put(index(to, gift.id), key);
    },
    list(to) {
      return [...kv.list<StoredGift>({ prefix: `gift:${to}:` })].map(([, gift]) => gift);
    },
    delete(to, id) {
      const key = kv.get<string>(index(to, id));
      if (key === undefined) return;
      kv.delete(key);
      kv.delete(index(to, id));
    },
  };
}
