// What the room does with its connections, as plain logic over `Peer`s so tests can drive it
// without a Durable Object. ./do.ts adapts hibernatable WebSockets to `Peer`.
import {
  CloseCode,
  parseClientMessage,
  type PlayerInfo,
  type Presence,
  type ServerMessage,
} from "./protocol.ts";

/** One open connection. A player normally has one; a second replaces the first. */
export interface Peer {
  readonly player: PlayerInfo;
  presence: Presence | null;
  send(message: ServerMessage): void;
  close(code: number, reason: string): void;
}

/** A new connection: replace the player's old one, greet them, tell everyone else. */
export function join(peers: readonly Peer[], newcomer: Peer): void {
  const others = peers.filter((p) => p !== newcomer);
  const previous = others.filter((p) => p.player.id === newcomer.player.id);
  for (const old of previous) old.close(CloseCode.replaced, "Connected elsewhere");
  const present = others.filter((p) => p.player.id !== newcomer.player.id);

  newcomer.send({
    type: "welcome",
    you: newcomer.player,
    players: present.map((p) => ({ ...p.player, presence: p.presence })),
  });
  // A reconnect isn't news to anyone; the ghost just carries on from its next presence.
  if (previous.length === 0) broadcast(present, { type: "joined", player: newcomer.player });
}

/** A frame from `from`. */
export function receive(peers: readonly Peer[], from: Peer, frame: string | ArrayBuffer): void {
  const message = parseClientMessage(frame);
  if (!message) return from.send({ type: "error", reason: "bad-message" });
  switch (message.type) {
    case "presence":
      from.presence = message.presence;
      broadcast(others(peers, from), { type: "presence", id: from.player.id, presence: message.presence });
      return;
  }
}

/** `leaver` closed. Unless the player is still connected elsewhere, they've left. */
export function leave(peers: readonly Peer[], leaver: Peer): void {
  const rest = others(peers, leaver);
  if (rest.some((p) => p.player.id === leaver.player.id)) return;
  broadcast(rest, { type: "left", id: leaver.player.id });
}

function others(peers: readonly Peer[], peer: Peer): Peer[] {
  return peers.filter((p) => p !== peer);
}

function broadcast(peers: readonly Peer[], message: ServerMessage): void {
  for (const peer of peers) peer.send(message);
}
