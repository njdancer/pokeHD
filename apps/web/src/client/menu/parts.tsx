// Small pieces the menu's screens share: the header, segmented choices, HP bars, a team member in
// their ball, and our own drawn icons (tabs, item shelves, badges). Pictures of Pokémon and people
// come from the ROM (dex/pictures.ts); the icons are ours.
import type { ReactNode } from "react";
import type { MonStatus, TeamMon } from "@pokehd/emu";
import { monName, pokedexNumber } from "@pokehd/rom";
import { niceName } from "../dex/catalogue.ts";
import { monPicture } from "../dex/pictures.ts";
import { useMenu } from "./context.ts";
import type { Shelf } from "./items.ts";

export function Head({ title, pill, back }: { title: string; pill?: ReactNode; back?: boolean }) {
  const { back: goBack } = useMenu();
  return (
    <header className="dm-head">
      {back && (
        <button type="button" className="dm-back" onClick={goBack} aria-label="Back">
          ‹
        </button>
      )}
      <h2>{title}</h2>
      {pill !== undefined && <span className="dm-pill">{pill}</span>}
    </header>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: readonly (readonly [NoInfer<T>, string])[]; onChange(v: NoInfer<T>): void; label: string }) {
  return (
    <div className="dm-seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function HpBar({ hp, max }: { hp: number; max: number }) {
  const f = max ? hp / max : 0;
  return (
    <div className="dm-hp" aria-hidden>
      <i className={f <= 0.2 ? "crit" : f <= 0.5 ? "low" : ""} style={{ width: `${Math.max(0, Math.min(1, f)) * 100}%` }} />
    </div>
  );
}

const STATUS: Record<MonStatus, string> = { ok: "", sleep: "Asleep", poison: "Poisoned", burn: "Burned", freeze: "Frozen", paralysis: "Paralysed" };

export function StatusTag({ mon }: { mon: Pick<TeamMon, "hp" | "status"> }) {
  if (mon.hp === 0) return <span className="dm-tag fainted">Fainted</span>;
  if (mon.status === "ok") return null;
  return <span className={`dm-tag st ${mon.status}`}>{STATUS[mon.status]}</span>;
}

/** A Pokémon's picture from the ROM, by internal species. */
export function MonPic({ species, className = "dm-pic" }: { species: number; className?: string }) {
  const { rom, catalogue } = useMenu();
  const entry = catalogue.entries[pokedexNumber(rom, species) - 1];
  if (!entry) return <span className={className} />;
  return <img className={className} src={monPicture(rom, species, entry.picture)} alt="" />;
}

/** A team member drawn in their Poké Ball. */
export function BallPic({ species }: { species: number }) {
  return (
    <span className="dm-ballpic">
      <MonPic species={species} className="" />
    </span>
  );
}

/** "Lv 18" and "41/56", the way the team rows show them. */
export function TeamRowBody({ mon, lead }: { mon: TeamMon; lead?: boolean }) {
  const { rom } = useMenu();
  const species = niceName(monNameOf(rom, mon));
  return (
    <>
      <span className="grow">
        <span>
          {niceName(mon.nick)}
          {lead && <span className="dm-tag">Leader</span>}
          <StatusTag mon={mon} />
        </span>
        {niceName(mon.nick) !== species && <span className="sub">{species}</span>}
        <HpBar hp={mon.hp} max={mon.maxHp} />
      </span>
      <span className="right">
        Lv {mon.level}
        <br />
        <span className="sub">
          {mon.hp}/{mon.maxHp}
        </span>
      </span>
    </>
  );
}

const monNameOf = (rom: Uint8Array, mon: { species: number }) => monName(rom, mon.species);

const TYPE_COLOURS: Record<string, string> = {
  NORMAL: "#9a9a7a", FIRE: "#e0702a", WATER: "#3d8be0", GRASS: "#5aa93c", ELECTRIC: "#d1a91f", ICE: "#5fb8c8",
  FIGHTING: "#b23a2c", POISON: "#9b59b6", GROUND: "#c49a4a", FLYING: "#8a8ae0", PSYCHIC: "#e0507a", BUG: "#8fa31f",
  ROCK: "#a68c3c", GHOST: "#6a5596", DRAGON: "#6a3ce0",
};
export function Types({ types }: { types: readonly string[] }) {
  return (
    <div className="dm-types">
      {[...new Set(types)].map((t) => (
        <span key={t} style={{ background: TYPE_COLOURS[t] ?? "#9a9a7a" }}>
          {niceName(t)}
        </span>
      ))}
    </div>
  );
}

/** Our own shelf icons for items (the game has no item pictures). */
export function ShelfIcon({ shelf }: { shelf: Shelf }) {
  const icon: Record<Shelf, ReactNode> = {
    Healing: (
      <svg viewBox="0 0 24 24">
        <path d="M9 3h6v3l2 3v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9l2-3z" fill="#b48ae0" stroke="#5e3c8a" strokeWidth="1.5" />
        <path d="M12 11v6M9 14h6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
    Balls: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8.5" fill="#fff" stroke="#2b1d14" strokeWidth="1.5" />
        <path d="M3.5 12a8.5 8.5 0 0 1 17 0z" fill="#e9493c" stroke="#2b1d14" strokeWidth="1.5" />
        <circle cx="12" cy="12" r="2.6" fill="#fff" stroke="#2b1d14" strokeWidth="1.5" />
      </svg>
    ),
    Battle: (
      <svg viewBox="0 0 24 24">
        <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" fill="#f2a65a" stroke="#a0581a" strokeWidth="1.5" />
        <path d="M9 12l2 2 4-4" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
      </svg>
    ),
    Travel: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8.5" fill="#8ccf6a" stroke="#3f7d34" strokeWidth="1.5" />
        <path d="M12 6l2.5 6L12 18l-2.5-6z" fill="#fff" stroke="#3f7d34" strokeWidth="1.2" />
      </svg>
    ),
    Machines: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8.5" fill="#6aa8e0" stroke="#2457b8" strokeWidth="1.5" />
        <circle cx="12" cy="12" r="2.5" fill="#fff" />
      </svg>
    ),
    Key: (
      <svg viewBox="0 0 24 24">
        <circle cx="8" cy="12" r="4" fill="#f2c94c" stroke="#a07a1a" strokeWidth="1.5" />
        <path d="M12 12h8M17 12v3M20 12v2" stroke="#a07a1a" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
    Other: (
      <svg viewBox="0 0 24 24">
        <rect x="5" y="5" width="14" height="14" rx="3" fill="#e6cf9f" stroke="#a0714a" strokeWidth="1.5" />
      </svg>
    ),
  };
  return <span className="dm-icon">{icon[shelf]}</span>;
}

const BADGE_COLOURS = ["#9a9a8a", "#4aa3d8", "#e0a020", "#5aa93c", "#e0507a", "#d1a91f", "#e0602a", "#5a9a5a"];
/** One of the eight badges, in our own simple drawing. */
export function BadgeIcon({ n }: { n: number }) {
  const c = BADGE_COLOURS[n] ?? "#999";
  const shapes = [
    <path key={0} d="M12 4l7 6-3 9H8l-3-9z" />,
    <path key={1} d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z" />,
    <path key={2} d="M12 3l2.5 6H21l-5.3 4 2 7L12 16l-5.7 4 2-7L3 9h6.5z" />,
    <path key={3} d="M12 3c3 3 8 3 8 9s-5 9-8 9-8-3-8-9 5-6 8-9z" />,
    <path key={4} d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z" />,
    <path key={5} d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4a5 5 0 1 1 0 10 5 5 0 0 1 0-10z" />,
    <path key={6} d="M12 3c2 4 6 5 6 10a6 6 0 0 1-12 0c0-2 1-4 2-5 0 2 1 3 2 3 0-3 0-5 2-8z" />,
    <path key={7} d="M12 3l8 5v8l-8 5-8-5V8z" />,
  ];
  return (
    <svg viewBox="0 0 24 24" fill={c} stroke="#3e2a1c" strokeWidth="1.2">
      {shapes[n]}
    </svg>
  );
}
