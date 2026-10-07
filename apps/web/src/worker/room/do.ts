import { DurableObject } from "cloudflare:workers";
import type { PlayerInfo, Presence, ServerMessage } from "@pokehd/protocol";
import { join, leave, receive, type Peer } from "./room.ts";

/** Headers the Worker sets on the upgrade request it forwards, after checking the session. */
export const PLAYER_ID_HEADER = "x-pokehd-player-id";
export const PLAYER_NAME_HEADER = "x-pokehd-player-name";

interface Attachment {
  player: PlayerInfo;
  presence: Presence | null;
}

/**
 * A shared world (p3-rooms): everyone connected sees everyone else's ghost. Uses hibernatable
 * WebSockets, so an idle room costs nothing; each socket's player and last presence live in its
 * attachment and survive hibernation.
 */
export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
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
    server.serializeAttachment({ player: { id, name: decodeURIComponent(name) }, presence: null } satisfies Attachment);
    join(this.#peers(), peer(server));
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    receive(this.#peers(), peer(ws), message);
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
