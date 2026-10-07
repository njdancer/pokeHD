// The link cable as messages (D17). Instead of forwarding serial bytes, the game's link
// routines are hooked by symbol: when the game enters one, its whole exchange is sent to the
// friend as one message, and the core idles in a frame loop until the friend's matching message
// arrives, which is then written where the routine would have put it before returning from it.
// The transport (an in-memory pair in tests, the room later) stays outside.
import type { LinkMessage, LinkMessageKind } from "@pokehd/protocol";
import { SYMBOLS, type SymbolName } from "@pokehd/rom";
import type { GameBoy, Registers } from "./core.ts";

/** Which side clocks the cable. Both sides must agree; the transport assigns them. */
export type LinkRole = "leader" | "follower";

export interface LinkPortOptions {
  /**
   * The leader becomes the game's master (internal clock): its random numbers drive a battle,
   * it sits on the left at the table and its choice wins a tie in the room menu. On a real cable
   * that's whoever talks to the receptionist first.
   */
  role: LinkRole;
  /** Called with each outbound message, in order. Deliver them to the friend's `receive`. */
  send: (message: LinkMessage) => void;
  /**
   * Frames to wait at the receptionist for the friend to talk to theirs, after which the game
   * says the area is reserved for two linked friends. Defaults to the 768 frames the game later
   * waits at "Please wait." before closing the link for inactivity.
   */
  connectTimeoutFrames?: number;
}

export interface LinkStats {
  sent: number;
  received: number;
  /** Times a hooked routine found the friend's message wasn't there yet and idled. */
  waits: number;
}

type ExchangeKind = Exclude<LinkMessageKind, "connect" | "cancel">;
type Payload<K extends LinkMessageKind> = Omit<Extract<LinkMessage, { kind: K }>, "kind">;

interface Pending {
  kind: ExchangeKind | "connect";
  registers: Registers;
  /** Frames idled so far, for the game's own timeouts. */
  frames: number;
}

const USING_EXTERNAL_CLOCK = 1;
const USING_INTERNAL_CLOCK = 2;
const IE_VBLANK = 1;
const R_IE = 0xffff;

const addr = (name: SymbolName) => SYMBOLS[name].address;

/**
 * One player's end of the cable. Attach it to that player's `GameBoy`; it installs the hooks
 * and removes them on `dispose()`.
 *
 * | routine | message | on the friend's reply |
 * |---|---|---|
 * | `CableClubNPC.establishConnectionLoop` | `connect` | set `hSerialConnectionStatus` from the role |
 * | `Serial_ExchangeBytes` | our `bc + 1` bytes from `hl` | store theirs from byte 1 at `de`, as the real loop does after the first preamble byte; advance `hl`, `de`, zero `bc`, return |
 * | `Serial_SyncAndExchangeNybble` | `wSerialExchangeNybbleSendData` | write both nybble receive bytes, return |
 * | `LinkBattleExchangeData.syncLoop1` | `wSerialExchangeNybbleSendData` | write the receive byte, return |
 * | `Serial_ExchangeLinkMenuSelection` | the 2-byte send buffer | write the receive buffer, tail-call `DelayFrame` |
 *
 * While waiting, the core is sent through `DelayFrame` (when V-Blank is enabled) or the game's
 * own `WaitLoop_15Iterations` busy-wait (block exchanges run with serial-only interrupts) and
 * back to the routine's first instruction, so the screen and music keep running and nothing
 * the routine would have done happens twice.
 */
export class LinkPort {
  readonly #gb: GameBoy;
  readonly #options: LinkPortOptions;
  readonly #inbox = new Map<LinkMessageKind, LinkMessage[]>();
  readonly #removeHooks: (() => void)[];
  #pending: Pending | undefined;
  readonly stats: LinkStats = { sent: 0, received: 0, waits: 0 };

  constructor(gb: GameBoy, options: LinkPortOptions) {
    this.#gb = gb;
    this.#options = options;
    this.#removeHooks = [
      gb.addHook("CableClubNPC.establishConnectionLoop", () => this.#onConnect()),
      gb.addHook("Serial_ExchangeBytes", () => this.#onBytes()),
      gb.addHook("Serial_SyncAndExchangeNybble", () => this.#onNybble()),
      gb.addHook("LinkBattleExchangeData.syncLoop1", () => this.#onBattle()),
      gb.addHook("Serial_ExchangeLinkMenuSelection", () => this.#onMenu()),
    ];
  }

  /** Delivers the friend's next message. Messages must arrive in the order they were sent. */
  receive(message: LinkMessage): void {
    this.stats.received++;
    if (message.kind === "connect") {
      // A new session: whatever the friend sent before belongs to the last one.
      this.#inbox.clear();
    } else if (message.kind === "cancel") {
      this.#inbox.delete("connect");
      return;
    }
    const queue = this.#inbox.get(message.kind);
    if (queue) queue.push(message);
    else this.#inbox.set(message.kind, [message]);
  }

  /** The routine the game is waiting in for the friend's message, if any. */
  get waitingFor(): LinkMessageKind | undefined {
    return this.#pending?.kind;
  }

  dispose(): void {
    for (const remove of this.#removeHooks) remove();
    this.#removeHooks.length = 0;
    this.#pending = undefined;
  }

  #send(message: LinkMessage): void {
    this.stats.sent++;
    this.#options.send(message);
  }

  #take<K extends LinkMessageKind>(kind: K): Payload<K> | undefined {
    return this.#inbox.get(kind)?.shift() as Payload<K> | undefined;
  }

  /**
   * Called on every arrival at a hooked routine. The first arrival sends our side and records
   * the registers; later arrivals are the core coming back from idling. Returns the friend's
   * message once it's there. Otherwise, if `timedOut` (asked on each return from idling) says
   * so, drops the exchange and returns `"timeout"` with the core still at the routine's start;
   * else sends the core round the idle loop and returns undefined.
   */
  #exchange<K extends ExchangeKind>(
    kind: K,
    outbound: () => Payload<K>,
    timedOut?: () => boolean,
  ): Payload<K> | "timeout" | undefined {
    if (this.#pending && this.#pending.kind !== kind) {
      throw new Error(`Link: entered ${kind} while waiting in ${this.#pending.kind}`);
    }
    const returning = this.#pending !== undefined;
    if (!this.#pending) {
      this.#pending = { kind, registers: this.#gb.registers, frames: 0 };
      this.#send({ kind, ...outbound() } as unknown as LinkMessage);
    }
    const theirs = this.#take(kind);
    if (theirs) {
      const { af } = this.#pending.registers;
      this.#pending = undefined;
      this.#gb.setRegisters({ af }); // the idle loop clobbers a and the flags
      return theirs;
    }
    if (returning && timedOut?.()) {
      this.#pending = undefined;
      return "timeout";
    }
    this.#idle(this.#pending);
    return undefined;
  }

  /** Calls an idle routine that returns to the current instruction, so the hook fires again. */
  #idle(pending: Pending): void {
    const gb = this.#gb;
    const { pc, sp } = gb.registers;
    const vblank = (gb.read(R_IE) & IE_VBLANK) !== 0;
    if (vblank) pending.frames++;
    this.stats.waits++;
    const top = (sp - 2) & 0xffff;
    gb.write(top, pc & 0xff);
    gb.write(top + 1, pc >> 8);
    gb.setRegisters({ sp: top, pc: addr(vblank ? "DelayFrame" : "WaitLoop_15Iterations") });
  }

  /** Returns from the routine the core is at the start of (`ret`). */
  #return(): void {
    const gb = this.#gb;
    const { sp } = gb.registers;
    gb.setRegisters({ pc: gb.read(sp) | (gb.read(sp + 1) << 8), sp: sp + 2 });
  }

  /**
   * The receptionist's connection loop. On a real cable the first player to talk clocks a byte
   * into the other Game Boy, which its Pokémon Center map script keeps armed. Here both players
   * talk to their receptionist; each sends `connect`, waits for the friend's, and takes the
   * clock from its role. The game then carries on as if the bytes had crossed.
   */
  #onConnect(): void {
    const gb = this.#gb;
    const status = gb.read(addr("hSerialConnectionStatus"));
    if (status === USING_INTERNAL_CLOCK || status === USING_EXTERNAL_CLOCK) return;
    if (this.#pending && this.#pending.kind !== "connect") {
      throw new Error(`Link: at the receptionist while waiting in ${this.#pending.kind}`);
    }
    if (!this.#pending) {
      this.#pending = { kind: "connect", registers: gb.registers, frames: 0 };
      this.#send({ kind: "connect" });
    }
    if (this.#take("connect")) {
      this.#pending = undefined;
      const clock = this.#options.role === "leader" ? USING_INTERNAL_CLOCK : USING_EXTERNAL_CLOCK;
      gb.write(addr("hSerialConnectionStatus"), clock);
      return; // the loop now reads the status and jumps to .establishedConnection
    }
    if (this.#pending.frames >= (this.#options.connectTimeoutFrames ?? 768)) {
      this.#pending = undefined;
      this.#send({ kind: "cancel" });
      gb.setRegisters({ pc: addr("CableClubNPC.failedToEstablishConnection") });
      return;
    }
    this.#idle(this.#pending);
  }

  #onBytes(): void {
    const gb = this.#gb;
    const { bc, de, hl } = this.#pending?.registers ?? gb.registers;
    const theirs = this.#exchange("bytes", () => ({ data: [...gb.readBytes(hl, bc + 1)] }));
    if (!theirs || theirs === "timeout") return;
    // The real loop discards until it receives the friend's first preamble byte, then stores
    // the next bc bytes, so their block lands from its second byte on.
    for (let i = 0; i < bc; i++) gb.write((de + i) & 0xffff, theirs.data[i + 1] ?? 0);
    gb.write(addr("hSerialIgnoringInitialData"), 0);
    gb.setRegisters({ hl: hl + bc, de: de + bc, bc: 0 });
    this.#return();
  }

  #onNybble(): void {
    const gb = this.#gb;
    const theirs = this.#exchange(
      "nybble",
      () => ({ value: gb.read(addr("wSerialExchangeNybbleSendData")) }),
      () => this.#nybbleTimedOut(),
    );
    if (theirs === "timeout") {
      // As the original: give up with the counter at $FFFF, which the caller reads as
      // "link closed because of inactivity". The friend's late reply starts nothing: the next
      // attempt begins with a fresh `connect`, which clears it.
      const counter = addr("wUnknownSerialCounter");
      gb.write(counter, 0xff);
      gb.write(counter + 1, 0xff);
      this.#return();
    } else if (theirs) {
      gb.write(addr("wSerialExchangeNybbleReceiveData"), theirs.value);
      gb.write(addr("wSerialSyncAndExchangeNybbleReceiveData"), theirs.value);
      this.#return();
    }
  }

  /**
   * `Serial_SyncAndExchangeNybble`'s timeout, one step per frame waited: when
   * `wUnknownSerialCounter` is non-zero it counts down (low byte first, the game's own odd
   * 16-bit decrement) and the routine gives up when it reaches zero.
   */
  #nybbleTimedOut(): boolean {
    const gb = this.#gb;
    if ((gb.read(R_IE) & IE_VBLANK) === 0) return false;
    const hi = addr("wUnknownSerialCounter");
    const lo = hi + 1;
    if (gb.read(hi) === 0 && gb.read(lo) === 0) return false;
    const low = (gb.read(lo) - 1) & 0xff;
    gb.write(lo, low);
    if (low !== 0) return false;
    const high = (gb.read(hi) - 1) & 0xff;
    gb.write(hi, high);
    return high === 0;
  }

  #onBattle(): void {
    const gb = this.#gb;
    const theirs = this.#exchange("battle", () => ({ value: gb.read(addr("wSerialExchangeNybbleSendData")) }));
    if (!theirs || theirs === "timeout") return;
    gb.write(addr("wSerialExchangeNybbleReceiveData"), theirs.value);
    // syncLoop1 is inside LinkBattleExchangeData after its far call has returned, so the top of
    // the stack is the routine's own return address: skip the rest of the handshake.
    this.#return();
  }

  #onMenu(): void {
    const gb = this.#gb;
    const send = addr("wLinkMenuSelectionSendBuffer");
    const theirs = this.#exchange("menu", () => ({ data: [gb.read(send), gb.read(send + 1)] }));
    if (!theirs || theirs === "timeout") return;
    const receive = addr("wLinkMenuSelectionReceiveBuffer");
    gb.write(receive, theirs.data[0] ?? 0);
    gb.write(receive + 1, theirs.data[1] ?? 0);
    // The original takes at least a frame; DelayFrame's own `ret` returns to the caller.
    gb.setRegisters({ pc: addr("DelayFrame") });
  }
}
