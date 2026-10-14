// The Pokédex menu's building blocks in the Storybook look (D31): a page with its header, rows,
// segmented choices, big action buttons, HP bars, type pills, switches, and a list you can
// reorder by dragging its grips.
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useNav } from "./nav.tsx";
import { Chevron, Grip, SpeakerIcon } from "./icons.tsx";
import { readAloud, TYPE_COLOUR, typeName } from "./env.tsx";
import type { Mon } from "./model.ts";

export function Page({ title, meta, banner, children, wide }: { title: ReactNode; meta?: ReactNode; banner?: ReactNode; children: ReactNode; wide?: boolean }) {
  const nav = useNav();
  return (
    <section className="m-page">
      <header className="m-head">
        {nav.depth > 1 && (
          <button type="button" className="m-round m-backbtn" aria-label="Back" onClick={nav.back}>
            <Chevron dir="left" />
          </button>
        )}
        <h2>{title}</h2>
        {meta && <span className="m-meta">{meta}</span>}
      </header>
      {banner && <div className="m-banner">{banner}</div>}
      <div className={`m-body${wide ? " wide" : ""}`}>{children}</div>
    </section>
  );
}

export function Seg<T extends string>({ options, value, onChange, label }: { options: readonly (readonly [NoInfer<T>, string])[]; value: T; onChange(v: NoInfer<T>): void; label: string }) {
  return (
    <div className="m-seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({ options, value, onChange, label }: { options: readonly (readonly [NoInfer<T>, string])[]; value: T; onChange(v: NoInfer<T>): void; label: string }) {
  return (
    <div className="m-chips" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function Section({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="m-section">
      <span>{children}</span>
      {right}
    </div>
  );
}

/** A tappable card row: picture, two lines, something on the right, and a chevron. */
export function Row({ media, title, sub, right, onClick, off, dim, chevron = true, className = "", style }: {
  media?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  off?: boolean;
  dim?: boolean;
  chevron?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const inner = (
    <>
      {media && <span className="m-media">{media}</span>}
      <span className="m-text">
        <span className="m-title">{title}</span>
        {sub && <span className="m-sub">{sub}</span>}
      </span>
      {right && <span className="m-right">{right}</span>}
      {onClick && chevron && <span className="m-chev"><Chevron /></span>}
    </>
  );
  const cls = `m-row${off ? " off" : ""}${dim ? " dim" : ""} ${className}`;
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} disabled={off} style={style}>
      {inner}
    </button>
  ) : (
    <div className={cls} style={style}>{inner}</div>
  );
}

export interface VerbSpec {
  label: string;
  /** Why it can't be done now ("In a wild battle"); shown instead of doing it. */
  off?: string;
  /** A note under it ("uses your turn"). */
  note?: string;
  alt?: boolean;
  run?: () => void;
}

export function Verbs({ verbs }: { verbs: VerbSpec[] }) {
  if (!verbs.length) return null;
  return (
    <div className="m-verbs">
      {verbs.map((v) => (
        <button key={v.label} type="button" className={`m-verb${v.alt ? " alt" : ""}`} disabled={!!v.off || !v.run} onClick={v.run}>
          <span>{v.label}</span>
          {(v.off || v.note) && <small>{v.off ?? v.note}</small>}
        </button>
      ))}
    </div>
  );
}

function hpTone(m: Pick<Mon, "hp" | "maxHp">): string {
  const f = m.hp / m.maxHp;
  return f <= 0.2 ? "crit" : f <= 0.5 ? "low" : "";
}

export function HpBar({ mon, big }: { mon: Pick<Mon, "hp" | "maxHp">; big?: boolean }) {
  return (
    <span className={`m-hp${big ? " big" : ""}`} role="meter" aria-label="HP" aria-valuenow={mon.hp} aria-valuemin={0} aria-valuemax={mon.maxHp}>
      <i className={hpTone(mon)} style={{ width: `${(100 * mon.hp) / mon.maxHp}%` }} />
    </span>
  );
}

export function Types({ types }: { types: readonly string[] }) {
  return (
    <span className="m-types">
      {types.map((t) => (
        <span key={t} style={{ background: TYPE_COLOUR[t] ?? "#a8a077" }}>{typeName(t)}</span>
      ))}
    </span>
  );
}

const STATUS_WORDS: Record<string, string> = { PSN: "Poisoned", BRN: "Burned", SLP: "Asleep", PAR: "Paralysed", FRZ: "Frozen" };
export function StatusPill({ status }: { status?: string }) {
  if (!status) return null;
  return <span className={`m-status s-${status.toLowerCase()}`}>{STATUS_WORDS[status] ?? status}</span>;
}

export function ReadButton({ text, label = "Read it to me" }: { text: string; label?: string }) {
  return (
    <button type="button" className="m-read" onClick={() => readAloud(text)}>
      <SpeakerIcon />
      <span>{label}</span>
    </button>
  );
}

export function Switch({ on, label, sub, onChange }: { on: boolean; label: ReactNode; sub?: ReactNode; onChange(on: boolean): void }) {
  return (
    <button type="button" className="m-toggle" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span className="m-text">
        <span className="m-title">{label}</span>
        {sub && <span className="m-sub">{sub}</span>}
      </span>
      <span className={`m-switch${on ? " on" : ""}`} />
    </button>
  );
}

/** A crisp pixel picture from the ROM. */
export function Pixel({ src, alt = "", className = "", style }: { src: string; alt?: string; className?: string; style?: CSSProperties }) {
  return <img className={`m-pixel ${className}`} src={src || undefined} alt={alt} draggable={false} style={style} />;
}

/**
 * A list whose rows move by dragging their grip (pointer events: mouse, touch and pen). Rows
 * slide out of the way while dragging; `onMove(from, to)` runs on release.
 */
export function SortList<T>({ items, keyOf, render, onMove, enabled = true, label }: {
  items: readonly T[];
  keyOf(item: T): string;
  render(item: T, i: number, grip: ReactNode): ReactNode;
  onMove(from: number, to: number): void;
  enabled?: boolean;
  label: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number; h: number } | null>(null);
  const start = (from: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    const rows = [...list.current!.children] as HTMLElement[];
    const boxes = rows.map((r) => r.getBoundingClientRect());
    const gap = boxes.length > 1 ? boxes[1]!.top - boxes[0]!.bottom : 8;
    const h = boxes[from]!.height + gap;
    const y0 = e.clientY;
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    let to = from;
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - y0;
      const centre = boxes[from]!.top + boxes[from]!.height / 2 + dy;
      to = boxes.findIndex((b) => centre < b.top + b.height / 2 + gap / 2);
      if (to < 0) to = boxes.length - 1;
      setDrag({ from, to, dy, h });
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setDrag(null);
      if (to !== from) onMove(from, to);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
    setDrag({ from, to, dy: 0, h });
  };
  const offset = (i: number) => {
    if (!drag) return 0;
    if (i === drag.from) return drag.dy;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -drag.h;
    if (drag.from > drag.to && i >= drag.to && i < drag.from) return drag.h;
    return 0;
  };
  return (
    <div className={`m-list${drag ? " sorting" : ""}`} ref={list} aria-label={label}>
      {items.map((item, i) => (
        <div key={keyOf(item)} className={`m-sortrow${drag?.from === i ? " lifted" : ""}`} style={{ transform: `translateY(${offset(i)}px)` }}>
          {render(
            item,
            i,
            enabled ? (
              <span className="m-grip" onPointerDown={start(i)} aria-label="Drag to move" role="button" tabIndex={-1}>
                <Grip />
              </span>
            ) : null,
          )}
        </div>
      ))}
    </div>
  );
}
