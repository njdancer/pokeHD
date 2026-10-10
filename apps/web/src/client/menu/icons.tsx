// The Pokédex menu's bottom tabs' icons: our own drawings.
const S = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** The bottom tabs' icons. */
export const TAB_ICONS = {
  pokemon: (
    <svg viewBox="0 0 24 24" {...S}>
      <rect x="5" y="3" width="14" height="18" rx="3" />
      <circle cx="9.5" cy="8" r="2" />
      <path d="M8 14h8M8 17h5" />
    </svg>
  ),
  people: (
    <svg viewBox="0 0 24 24" {...S}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M16 14.2c2.4-.3 4.2 1.3 4.6 4" />
    </svg>
  ),
  inventory: (
    <svg viewBox="0 0 24 24" {...S}>
      <path d="M6 8h12l-1 12H7z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      <path d="M9.5 13h5" />
    </svg>
  ),
  map: (
    <svg viewBox="0 0 24 24" {...S}>
      <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
      <path d="M9 4v14M15 6v14" />
    </svg>
  ),
  me: (
    <svg viewBox="0 0 24 24" {...S}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <circle cx="9" cy="11" r="2.2" />
      <path d="M5.8 16c.5-1.6 1.7-2.4 3.2-2.4s2.7.8 3.2 2.4M14 10h4M14 13h3" />
    </svg>
  ),
};
