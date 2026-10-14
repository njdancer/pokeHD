// Drawn icons for the Pokédex menu: the tabs, items by kind, and small marks. Code-drawn SVG in
// the Storybook ink (no image assets), so they scale crisply on any screen.
import type { ItemKind } from "./model.ts";

const INK = "#3e2a1c";

export type TabId = "dex" | "people" | "inv" | "map" | "me";

/** Tab icons: chunky shapes with an ink outline, coloured when the tab is chosen. */
export function TabIcon({ tab, on }: { tab: TabId; on: boolean }) {
  const s = { stroke: INK, strokeWidth: 2.2, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  const c = (colour: string) => (on ? colour : "#e9d9bb");
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      {tab === "dex" && (
        <>
          <rect x="6" y="3.5" width="20" height="25" rx="4" fill={c("#e8473b")} {...s} />
          <circle cx="12" cy="10" r="3.4" fill={on ? "#7fd0ff" : "#fffaf0"} {...s} strokeWidth={1.8} />
          <rect x="10" y="16" width="12" height="8" rx="2" fill="#fffaf0" {...s} strokeWidth={1.8} />
        </>
      )}
      {tab === "people" && (
        <>
          <circle cx="21.5" cy="11" r="4" fill={c("#b98ad6")} {...s} />
          <path d="M14.5 26c.8-5 3.6-7.5 7-7.5s6.2 2.5 7 7.5z" fill={c("#b98ad6")} {...s} />
          <circle cx="12" cy="10.5" r="5" fill={c("#8e5bb5")} {...s} />
          <path d="M3.5 27c1-6.5 4.4-9.5 8.5-9.5s7.5 3 8.5 9.5z" fill={c("#8e5bb5")} {...s} />
        </>
      )}
      {tab === "inv" && (
        <>
          <path d="M8 12h16l-1.6 14.5a2 2 0 0 1-2 1.8H11.6a2 2 0 0 1-2-1.8z" fill={c("#e0a03a")} {...s} />
          <path d="M11.5 12V9.5a4.5 4.5 0 0 1 9 0V12" fill="none" {...s} />
          <circle cx="16" cy="20" r="4.2" fill="#fffaf0" {...s} strokeWidth={1.8} />
          <path d="M11.8 20h8.4" {...s} strokeWidth={1.8} />
          <path d="M11.8 20a4.2 4.2 0 0 1 8.4 0z" fill={on ? "#e8473b" : "#fffaf0"} {...s} strokeWidth={1.8} />
        </>
      )}
      {tab === "map" && (
        <>
          <path d="M4 8.5l7.5-3 9 3 7.5-3v18l-7.5 3-9-3-7.5 3z" fill={c("#8fcf6e")} {...s} />
          <path d="M11.5 5.5v18M20.5 8.5v18" {...s} strokeWidth={1.6} />
          <path d="M16 20.5s-4-3.8-4-6.6a4 4 0 0 1 8 0c0 2.8-4 6.6-4 6.6z" fill={on ? "#e8473b" : "#fffaf0"} {...s} strokeWidth={1.8} />
        </>
      )}
      {tab === "me" && (
        <>
          <rect x="3.5" y="7" width="25" height="18" rx="3.5" fill={c("#5b8de0")} {...s} />
          <circle cx="11" cy="14.5" r="3.4" fill="#fffaf0" {...s} strokeWidth={1.8} />
          <path d="M6.5 22c.6-2.6 2.3-3.8 4.5-3.8s3.9 1.2 4.5 3.8" fill="#fffaf0" {...s} strokeWidth={1.8} />
          <path d="M18.5 13h6M18.5 18h4" {...s} stroke="#fffaf0" strokeWidth={2.4} />
        </>
      )}
    </svg>
  );
}

/** An item's picture by what it is (Gen 1 has no item art; these are ours, drawn). */
export function ItemIcon({ id, kind }: { id: number; kind: ItemKind }) {
  const s = { stroke: INK, strokeWidth: 2, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  const ball = (top: string, band?: string) => (
    <>
      <circle cx="16" cy="16" r="11" fill="#fbfbfb" {...s} />
      <path d="M5 16a11 11 0 0 1 22 0z" fill={top} {...s} />
      {band && <path d="M8 10.5h16" stroke={band} strokeWidth="2.6" />}
      <circle cx="16" cy="16" r="3.6" fill="#fbfbfb" {...s} />
    </>
  );
  let body;
  if (kind === "Balls") body = id === 1 ? ball("#8b4fc4") : id === 2 ? ball("#333", "#f2c94c") : id === 3 ? ball("#3a79d6", "#e8473b") : ball("#e8473b");
  else if (kind === "Healing")
    body = (
      <>
        <path d="M12 4h8v4l3.5 4.5V26a2.5 2.5 0 0 1-2.5 2.5H11A2.5 2.5 0 0 1 8.5 26V12.5L12 8z" fill={id === 0x0b || id === 0x34 ? "#f2d24c" : id === 0x13 ? "#e66aa8" : "#9d6ad6"} {...s} />
        <rect x="11" y="15" width="10" height="7" rx="1.5" fill="#fffaf0" {...s} strokeWidth={1.6} />
        <path d="M16 16.5v4M14 18.5h4" stroke="#e8473b" strokeWidth="1.8" strokeLinecap="round" />
      </>
    );
  else if (kind === "Boosts")
    body = (
      <>
        <path d="M16 4l9 8-9 16-9-16z" fill="#8fd0c8" {...s} />
        <path d="M7 12h18M12 12l4-8 4 8-4 16z" fill="none" {...s} strokeWidth={1.4} />
      </>
    );
  else if (kind === "Machines")
    body = (
      <>
        <circle cx="16" cy="16" r="11.5" fill={id >= 0xc9 ? "#8fb8e8" : "#c9a7ef"} {...s} />
        <circle cx="16" cy="16" r="6.5" fill="none" stroke="#fffaf0" strokeWidth="1.6" opacity=".8" />
        <circle cx="16" cy="16" r="2.6" fill="#fffaf0" {...s} strokeWidth={1.6} />
      </>
    );
  else if (id === 6)
    body = (
      <>
        <circle cx="9" cy="21" r="5.5" fill="none" {...s} strokeWidth={2.4} />
        <circle cx="23" cy="21" r="5.5" fill="none" {...s} strokeWidth={2.4} />
        <path d="M9 21l5-9h7l2 9M14 12l-1.5-3h-3M21 12l1.5-3h3" fill="none" {...s} stroke="#e8473b" strokeWidth={2.4} />
      </>
    );
  else if (id === 5)
    body = (
      <>
        <path d="M4 8.5l7.5-3 9 3 7.5-3v18l-7.5 3-9-3-7.5 3z" fill="#f4e3b5" {...s} />
        <path d="M11.5 5.5v18M20.5 8.5v18" {...s} strokeWidth={1.4} />
        <path d="M7 19c3-1 4-5 8-5s5 4 9 2" fill="none" stroke="#5aa04a" strokeWidth="2" />
      </>
    );
  else if (id >= 0x4c && id <= 0x4e)
    // OLD, GOOD and SUPER ROD: a rod with its line and float, the rod's colour by which (QA bug 72:
    // they fell back to the Repel's bottle).
    body = (
      <>
        <path d="M5 27L24 5" {...s} strokeWidth={4.2} />
        <path d="M5 27L24 5" stroke={id === 0x4c ? "#b07a45" : id === 0x4d ? "#3a79d6" : "#e8473b"} strokeWidth="2.2" strokeLinecap="round" />
        <path d="M24 5c3 4 3 10 2 15" fill="none" stroke={INK} strokeWidth="1.2" />
        <circle cx="26" cy="22.5" r="2.6" fill="#e8473b" {...s} strokeWidth={1.4} />
        <circle cx="9" cy="22.5" r="2.4" fill="#fbfbfb" {...s} strokeWidth={1.6} />
      </>
    );
  else if (id === 0x47)
    // ITEMFINDER: a dowsing gadget with its two antennae.
    body = (
      <>
        <rect x="9" y="12" width="14" height="15" rx="3" fill="#8fd0c8" {...s} />
        <path d="M13 12L10 4M19 12l3-8" {...s} />
        <circle cx="16" cy="19.5" r="3.2" fill="#e8473b" {...s} strokeWidth={1.6} />
      </>
    );
  else if (id === 0x49)
    // POKé FLUTE: a recorder with its holes.
    body = (
      <>
        <path d="M7 27L24 6l3 2.5L10 29.5z" fill="#f4e3b5" {...s} />
        <circle cx="15" cy="19" r="1.3" fill={INK} />
        <circle cx="18" cy="15.3" r="1.3" fill={INK} />
        <circle cx="21" cy="11.6" r="1.3" fill={INK} />
      </>
    );
  else if (id === 0x45)
    // COIN CASE: a purse with a coin.
    body = (
      <>
        <rect x="5" y="11" width="22" height="15" rx="4" fill="#c46a3a" {...s} />
        <path d="M5 16h22" {...s} strokeWidth={1.6} />
        <circle cx="21" cy="9" r="4.5" fill="#f2c94c" {...s} strokeWidth={1.6} />
      </>
    );
  else if (kind === "Travel")
    body =
      id === 0x1d ? (
        <>
          <path d="M8 24c0-6 16-4 16-10S14 6 14 6" fill="none" {...s} stroke="#a0714a" strokeWidth={3.4} />
          <path d="M8 24c0-6 16-4 16-10S14 6 14 6" fill="none" stroke="#e4c08a" strokeWidth="1.4" strokeDasharray="2 2" />
        </>
      ) : (
        <>
          <path d="M11 6h10v3l2 3v14a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V12l2-3z" fill="#7cc3e8" {...s} />
          <path d="M12 17c2-3 6-3 8 0" fill="none" stroke="#fffaf0" strokeWidth="2" />
        </>
      );
  else
    body = (
      <>
        <path d="M6 10h20v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" fill="#f0d79a" {...s} />
        <path d="M6 10l10 7 10-7" fill="none" {...s} />
        <circle cx="22.5" cy="8" r="4" fill="#e0702a" {...s} strokeWidth={1.6} />
      </>
    );
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      {body}
    </svg>
  );
}

/** A small Poké Ball mark (caught, in your team). */
export function BallMark({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" className="ball-mark">
      <circle cx="8" cy="8" r="7" fill="#fbfbfb" stroke="#2b2b33" strokeWidth="1.4" />
      <path d="M1 8a7 7 0 0 1 14 0z" fill="#e8473b" stroke="#2b2b33" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="2.2" fill="#fbfbfb" stroke="#2b2b33" strokeWidth="1.4" />
    </svg>
  );
}

export function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Chevron({ dir = "right" }: { dir?: "right" | "left" | "down" }) {
  const d = dir === "right" ? "M9 5l7 7-7 7" : dir === "left" ? "M15 5l-7 7 7 7" : "M5 9l7 7 7-7";
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

/** The grip for drag to reorder. */
export function Grip() {
  return (
    <svg viewBox="0 0 12 20" width="12" height="20" aria-hidden="true">
      {[4, 10, 16].map((y) => (
        <g key={y}>
          <circle cx="3" cy={y} r="1.8" fill="currentColor" />
          <circle cx="9" cy={y} r="1.8" fill="currentColor" />
        </g>
      ))}
    </svg>
  );
}


export type RowIconKind = "save" | "gear" | "flag" | "lock" | "gift" | "ball" | "trade" | "battle" | "star";

/** Round icons for rows and big buttons. */
export function RowIcon({ kind }: { kind: RowIconKind }) {
  const s = { stroke: INK, strokeWidth: 2, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  const bg: Record<RowIconKind, string> = { save: "#dff1d8", gear: "#efe5d2", flag: "#dbe8fb", lock: "#efe5d2", gift: "#fde0dc", ball: "#fde0dc", trade: "#dbe8fb", battle: "#fdf0c8", star: "#fdf0c8" };
  return (
    <span className="m-rowicon" style={{ background: bg[kind] }} aria-hidden="true">
      <svg viewBox="0 0 32 32">
        {kind === "save" && (
          <>
            <circle cx="16" cy="16" r="10" fill="#4fae5a" {...s} />
            <path d="M11.5 16.5l3.2 3.2 6-6.5" fill="none" {...s} stroke="#fffaf0" strokeWidth={3} />
          </>
        )}
        {kind === "gear" && (
          <>
            <path d="M16 5l2.2 3 3.6-1 .6 3.7 3.5 1.4-1.6 3.4 1.6 3.4-3.5 1.4-.6 3.7-3.6-1L16 27l-2.2-3-3.6 1-.6-3.7-3.5-1.4 1.6-3.4-1.6-3.4 3.5-1.4.6-3.7 3.6 1z" fill="#c9b08a" {...s} />
            <circle cx="16" cy="16" r="4" fill="#fffaf0" {...s} />
          </>
        )}
        {kind === "flag" && (
          <>
            <path d="M9 27V5" {...s} strokeWidth={2.4} />
            <path d="M9 6h14l-3.5 4.5L23 15H9z" fill="#3f86e0" {...s} />
          </>
        )}
        {kind === "lock" && (
          <>
            <rect x="8" y="14" width="16" height="12" rx="3" fill="#e0a03a" {...s} />
            <path d="M11.5 14v-3a4.5 4.5 0 0 1 9 0v3" fill="none" {...s} strokeWidth={2.4} />
            <circle cx="16" cy="20" r="1.8" fill={INK} />
          </>
        )}
        {kind === "gift" && (
          <>
            <rect x="6" y="13" width="20" height="13" rx="2" fill="#e8473b" {...s} />
            <rect x="5" y="9.5" width="22" height="5" rx="1.5" fill="#f26b5e" {...s} />
            <path d="M16 9.5V26" stroke="#ffd34d" strokeWidth="3.2" />
            <path d="M16 9.5c-2-4-7-4-6-1s6 1 6 1c0 0 5 2 6-1s-4-3-6 1z" fill="#ffd34d" {...s} strokeWidth={1.6} />
          </>
        )}
        {kind === "ball" && (
          <>
            <circle cx="16" cy="16" r="10" fill="#fbfbfb" {...s} />
            <path d="M6 16a10 10 0 0 1 20 0z" fill="#e8473b" {...s} />
            <circle cx="16" cy="16" r="3.2" fill="#fbfbfb" {...s} />
          </>
        )}
        {kind === "trade" && (
          <>
            <path d="M7 12h16l-4-4M25 20H9l4 4" fill="none" {...s} stroke="#2c6fd6" strokeWidth={3} />
          </>
        )}
        {kind === "battle" && <path d="M18 4L8 18h7l-2 10 11-15h-7z" fill="#f2c230" {...s} />}
        {kind === "star" && <path d="M16 5l3.2 6.6 7.3 1-5.3 5.1 1.3 7.2L16 21.5l-6.5 3.4 1.3-7.2-5.3-5.1 7.3-1z" fill="#f2c230" {...s} />}
      </svg>
    </span>
  );
}
