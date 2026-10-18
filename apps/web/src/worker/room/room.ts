// What the room does with its connections, as plain logic over `Peer`s so tests can drive it
// without a Durable Object. ./do.ts adapts hibernatable WebSockets to `Peer`.
import {
  CloseCode,
  parseClientMessage,
  ROOM_QUIET_MS,
  type Gift,
  type PlayerInfo,
  type Presence,
  type ServerMessage,
} from "@pokehd/protocol";

/** One open connection. A player normally has one; a second replaces the first. */
export interface Peer {
  readonly player: PlayerInfo;
  presence: Presence | null;
  send(message: ServerMessage): void;
  close(code: number, reason: string): void;
}

/** A gift waiting for its receiver (D20), as the room stores it. */
export interface StoredGift {
  id: string;
  from: PlayerInfo;
  gift: Gift;
}

/**
 * Gifts the room holds until their receiver acknowledges them. The sender's game has already
 * saved without the gift, so the room is the only copy: it lives in Durable Object storage.
 */
export interface GiftStore {
  /** Stores (or, for an ID already stored, keeps) a gift for player `to`. */
  put(to: string, gift: StoredGift): void;
  /** Gifts waiting for player `to`, oldest first. */
  list(to: string): StoredGift[];
  delete(to: string, id: string): void;
}

/** Where a player was when last seen in the world, for friends' maps while they're away. */
export interface LastSeen {
  mapId: number;
  x: number;
  y: number;
  at: number;
}

/**
 * Where everyone was last seen. `note` is called for every presence, so the store decides how
 * often to write; `final` is their spot as they leave, always kept.
 */
export interface SeenStore {
  note(id: string, presence: Presence, final?: boolean): void;
}

/** A new connection: replace the player's old one, greet them, tell everyone else. */
export function join(peers: readonly Peer[], newcomer: Peer, gifts?: GiftStore): void {
  const others = peers.filter((p) => p !== newcomer);
  const previous = others.filter((p) => p.player.id === newcomer.player.id);
  for (const old of previous) {
    old.send({ type: "error", reason: "replaced" });
    old.close(CloseCode.replaced, "Connected elsewhere");
  }
  const present = others.filter((p) => p.player.id !== newcomer.player.id);

  newcomer.send({
    type: "welcome",
    you: newcomer.player,
    players: present.map((p) => ({ ...p.player, presence: p.presence })),
  });
  // A reconnect isn't news to anyone; the ghost just carries on from its next presence.
  if (previous.length === 0) broadcast(present, { type: "joined", player: newcomer.player });
  // Gifts that arrived while they were away, until they acknowledge them.
  for (const g of gifts?.list(newcomer.player.id) ?? []) newcomer.send({ type: "gift", ...g });
}

/** A frame from `from`. */
export function receive(peers: readonly Peer[], from: Peer, frame: string | ArrayBuffer, gifts?: GiftStore, seen?: SeenStore): void {
  const message = parseClientMessage(frame);
  if (!message) return from.send({ type: "error", reason: "bad-message" });
  switch (message.type) {
    case "presence":
      from.presence = message.presence;
      if (message.presence) seen?.note(from.player.id, message.presence);
      broadcast(others(peers, from), { type: "presence", id: from.player.id, presence: message.presence });
      return;
    case "link": {
      const to = peers.find((p) => p.player.id === message.to && p !== from);
      if (!to) return from.send({ type: "error", reason: "not-here", to: message.to });
      to.send({ type: "link", from: from.player.id, message: message.message });
      return;
    }
    case "gift": {
      if (!gifts || message.to === from.player.id) return from.send({ type: "error", reason: "bad-message" });
      const stored: StoredGift = { id: message.id, from: from.player, gift: message.gift };
      gifts.put(message.to, stored);
      from.send({ type: "gift-stored", id: message.id });
      // The receiver may be online; otherwise it gets the gift when it next connects.
      for (const to of peers) if (to.player.id === message.to) to.send({ type: "gift", ...stored });
      return;
    }
    case "gift-ack":
      gifts?.delete(from.player.id, message.id);
      return;
  }
}

/**
 * Peers not heard from (no ping, no message) for ROOM_QUIET_MS, given when each was last heard:
 * a phone put to sleep or a closed laptop whose socket the network hasn't ended yet. The room
 * closes them, so their ghosts leave the world.
 */
export function quietPeers<P>(peers: readonly P[], lastHeard: (p: P) => number, now: number): P[] {
  return peers.filter((p) => now - lastHeard(p) >= ROOM_QUIET_MS);
}

/** `leaver` closed. Unless the player is still connected elsewhere, they've left. */
export function leave(peers: readonly Peer[], leaver: Peer, seen?: SeenStore): void {
  const rest = others(peers, leaver);
  if (rest.some((p) => p.player.id === leaver.player.id)) return;
  // Before "left" goes out, so a friend who asks where they were straight away gets this spot.
  if (leaver.presence) seen?.note(leaver.player.id, leaver.presence, true);
  broadcast(rest, { type: "left", id: leaver.player.id });
}

function others(peers: readonly Peer[], peer: Peer): Peer[] {
  return peers.filter((p) => p !== peer);
}

function broadcast(peers: readonly Peer[], message: ServerMessage): void {
  for (const peer of peers) peer.send(message);
}
