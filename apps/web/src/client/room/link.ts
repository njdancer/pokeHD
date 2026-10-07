// The link cable over the room (p3-link-net, D17). The emulator's LinkPort turns the game's link
// routines into messages; this pairs it with one friend in the room and relays its messages to
// them. Framework-free: the picker reads `state` and calls `choose`.
//
// Pairing: when the game asks to connect (the player said YES to the Cable Club receptionist),
// the player picks a friend. Each side's `connect` goes to the friend it picked, and the session
// starts once both have picked each other. Roles come from the two player IDs, so both sides
// agree without another message: the smaller ID leads (clocks the cable).
import type { HostLink, LinkPortOptions, LinkRole } from "@pokehd/emu";
import type { ClientMessage, LinkMessage, ServerMessage } from "@pokehd/protocol";

/** What the link needs from the room connection. */
export interface RoomConnection {
  send(message: ClientMessage): void;
  /** Calls `listener` with every message from the room; returns an unsubscribe. */
  subscribe(listener: (message: ServerMessage) => void): () => void;
}

/** Plugs a LinkPort into the player's emulator, replacing any open one (`EmulatorHost.openLink`). */
export type OpenLink = (options: LinkPortOptions) => HostLink;

export type LinkStatus =
  /** Not at the receptionist, or done there. */
  | { status: "idle" }
  /** The game wants to connect: pick a friend. `visit` counts visits to the receptionist. */
  | { status: "choosing"; visit: number }
  /** Paired with `friend` (whether or not they've picked us back yet). */
  | { status: "linked"; friend: string; role: LinkRole };

/** `waiting`: friends at their receptionist who picked this player, oldest first. */
export type RoomLinkState = LinkStatus & { waiting: readonly string[] };

export interface RoomLinkOptions {
  room: RoomConnection;
  /** This player's ID (the room's `welcome.you.id`). */
  me: string;
  open: OpenLink;
  /**
   * Frames the game waits at the receptionist (choosing, then for the friend to pick us back)
   * before it gives up and says the area is reserved. Default 30 s.
   */
  connectTimeoutFrames?: number;
}

/** The smaller player ID leads. Both sides compute the same answer. */
export function linkRole(me: string, friend: string): LinkRole {
  return me < friend ? "leader" : "follower";
}

export class RoomLink {
  readonly #options: RoomLinkOptions;
  readonly #unsubscribe: () => void;
  readonly #listeners = new Set<() => void>();
  #port: HostLink;
  #friend: { id: string; role: LinkRole } | undefined;
  /** We picked a friend and reopened the port; its first `connect` is the one to send them. */
  #expectConnect = false;
  /** Whether the friend's `connect` for this session has been passed to the port. */
  #friendConnected = false;
  /** Friends whose `connect` hasn't been paired yet, in arrival order. */
  readonly #waiting = new Set<string>();
  #visits = 0;
  #state: RoomLinkState = { status: "idle", waiting: [] };

  constructor(options: RoomLinkOptions) {
    this.#options = options;
    // Until a friend is picked the role doesn't matter: nothing reaches the port.
    this.#port = this.#open("follower");
    this.#unsubscribe = options.room.subscribe((message) => this.#onRoom(message));
  }

  get state(): RoomLinkState {
    return this.#state;
  }

  /** Calls `listener` whenever `state` changes; returns an unsubscribe (`useSyncExternalStore`). */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Links with `friend` for this visit to the receptionist. Only while choosing. */
  choose(friend: string): void {
    if (this.#state.status !== "choosing" || friend === this.#options.me) return;
    const role = linkRole(this.#options.me, friend);
    this.#friend = { id: friend, role };
    this.#friendConnected = false;
    // The game is idling in the receptionist's connection loop; a new port with the right role
    // picks it up there and sends `connect` again, which now goes to the friend.
    this.#expectConnect = true;
    this.#port = this.#open(role);
    if (this.#waiting.delete(friend)) this.#deliverConnect();
    this.#update({ status: "linked", friend, role });
  }

  dispose(): void {
    this.#unsubscribe();
    this.#port.close();
    this.#listeners.clear();
  }

  #open(role: LinkRole): HostLink {
    const { open, connectTimeoutFrames = 30 * 60 } = this.#options;
    return open({ role, connectTimeoutFrames, send: (message) => this.#onGame(message) });
  }

  /** An outbound message from the game. */
  #onGame(message: LinkMessage): void {
    if (message.kind === "connect") {
      if (this.#expectConnect && this.#friend) {
        this.#expectConnect = false;
        this.#sendToFriend(message);
      } else {
        // A new visit to the receptionist: pick a friend for it.
        this.#friend = undefined;
        this.#update({ status: "choosing", visit: ++this.#visits });
      }
      return;
    }
    if (message.kind === "cancel") {
      // The game gave up waiting at the receptionist.
      if (this.#friend) this.#sendToFriend(message);
      this.#friend = undefined;
      this.#expectConnect = false;
      this.#update({ status: "idle" });
      return;
    }
    if (this.#friend) this.#sendToFriend(message);
  }

  #onRoom(message: ServerMessage): void {
    if (message.type === "left") {
      if (this.#waiting.delete(message.id)) this.#update();
      return;
    }
    if (message.type !== "link") return;
    const { from, message: link } = message;
    const friend = this.#friend?.id === from;
    if (link.kind === "connect") {
      // Theirs starts a session. Only pass it on if it answers ours; otherwise it waits for
      // this player to pick them.
      if (friend && !this.#friendConnected) {
        this.#deliverConnect();
      } else {
        this.#waiting.delete(from);
        this.#waiting.add(from);
        this.#update();
      }
    } else if (link.kind === "cancel") {
      if (friend && this.#friendConnected) {
        this.#port.receive(link);
        this.#friendConnected = false;
      }
      if (this.#waiting.delete(from)) this.#update();
    } else if (friend && this.#friendConnected) {
      this.#port.receive(link);
    }
  }

  #deliverConnect(): void {
    this.#friendConnected = true;
    this.#port.receive({ kind: "connect" });
  }

  #sendToFriend(message: LinkMessage): void {
    if (this.#friend) this.#options.room.send({ type: "link", to: this.#friend.id, message });
  }

  /** Sets the status (or keeps it) and refreshes `waiting`. */
  #update(next?: LinkStatus): void {
    const { waiting: _, ...current } = this.#state;
    this.#state = { ...(next ?? current), waiting: [...this.#waiting] };
    for (const listener of this.#listeners) listener();
  }
}
