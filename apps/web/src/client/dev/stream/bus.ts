// The QA harness's event bus, live: the snapshot first, then each event from the SSE stream.
// EventSource retries on its own every few seconds and logs each failure, so it is closed on the
// first error and reopened with a growing back-off; every (re)connect refetches the snapshot.
import { useEffect, useState } from "react";
import { byPriority, type ActionEvent, type QaEvent, type Snapshot, type ThoughtEvent } from "./events.ts";

/** How many feed rows and chat messages the page keeps (it shows what fits). */
const FEED_KEEP = 60;
const CHAT_KEEP = 30;
const BACKOFF_MIN = 1_000;
const BACKOFF_MAX = 30_000;

export interface BusState extends Snapshot {
  connected: boolean;
}

const EMPTY: BusState = { status: null, feed: [], chat: [], bugs: [], glitches: [], connected: false };

const feedKey = (e: ThoughtEvent | ActionEvent) => `${e.t}:${e.id}`;

function apply(state: BusState, e: QaEvent): BusState {
  switch (e.t) {
    case "status":
      return { ...state, status: e };
    case "thought":
    case "action":
      if (state.feed.some((f) => feedKey(f) === feedKey(e))) return state;
      return { ...state, feed: [...state.feed, e].slice(-FEED_KEEP) };
    case "chat":
      if (state.chat.some((c) => c.id === e.id)) return state;
      return { ...state, chat: [...state.chat, e].slice(-CHAT_KEEP) };
    case "bugs":
      return { ...state, bugs: [...e.list].sort(byPriority) };
    case "glitch":
      if (state.glitches.some((g) => g.id === e.id)) return state;
      return { ...state, glitches: [...state.glitches, e].slice(-20) };
  }
}

function fromSnapshot(s: Snapshot): BusState {
  return {
    status: s.status ?? null,
    feed: (s.feed ?? []).slice(-FEED_KEEP),
    chat: (s.chat ?? []).slice(-CHAT_KEEP),
    bugs: [...(s.bugs ?? [])].sort(byPriority),
    glitches: s.glitches ?? [],
    connected: true,
  };
}

export function useBus(base: string): BusState {
  const [state, setState] = useState<BusState>(EMPTY);

  useEffect(() => {
    const root = base.replace(/\/$/, "");
    let disposed = false;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let backoff = BACKOFF_MIN;
    // Events that arrive while the snapshot is loading wait for it, so it can't overwrite them.
    let pending: QaEvent[] | null = null;

    const retry = () => {
      source?.close();
      source = null;
      if (disposed) return;
      setState((s) => (s.connected ? { ...s, connected: false } : s));
      timer = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, BACKOFF_MAX);
    };

    function connect() {
      if (disposed) return;
      const es = new EventSource(`${root}/events`);
      source = es;
      es.onopen = () => {
        pending = [];
        fetch(`${root}/snapshot`)
          .then((r) => (r.ok ? (r.json() as Promise<Snapshot>) : Promise.reject(new Error(`snapshot ${r.status}`))))
          .then((snap) => {
            if (disposed || source !== es) return;
            const queued = pending ?? [];
            pending = null;
            backoff = BACKOFF_MIN;
            setState(queued.reduce(apply, fromSnapshot(snap)));
          })
          .catch(() => {
            if (source === es) retry();
          });
      };
      es.onmessage = (m: MessageEvent<string>) => {
        let e: QaEvent;
        try {
          e = JSON.parse(m.data) as QaEvent;
        } catch {
          return;
        }
        if (pending) pending.push(e);
        else setState((s) => apply(s, e));
      };
      es.onerror = () => {
        if (source === es) retry();
      };
    }

    connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
      source?.close();
    };
  }, [base]);

  return state;
}
