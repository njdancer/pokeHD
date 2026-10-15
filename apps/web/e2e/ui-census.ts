// What HD UI is on screen right now, for the UI pass and the layout fuzzer (ui-*.e2e.ts): every
// panel, sheet, box and toast the player can see, the Game Boy screen if any of it shows, and
// layout faults (cut off by the screen's edge, words overflowing their box, panels on top of each
// other). Runs in the page; reads only the DOM and the Game Boy screen's canvas.
import type { Page } from "@playwright/test";

export interface Seen {
  kind: string;
  label: string;
  box: { x: number; y: number; w: number; h: number };
}

export interface Census {
  panels: Seen[];
  toasts: Seen[];
  /** Share of the Game Boy screen's pixels showing (0 when it's hidden or fully masked). */
  gameBoy: number;
  touchPad: boolean;
  faults: string[];
}

/** Panels: each is a box the player reads or answers on its own. */
const PANELS: [string, string][] = [
  [".hd-text .hd-box", "message box"],
  [".battle-menu .bm-panel", "battle menu"],
  [".dm-sheet", "question sheet"],
  [".m-sheet", "dex sheet"],
  // The Pokédex menu's screen sits on the 3D dex (a projected page, whose box says little):
  // open, it is one panel the size of the screen.
  [".dh-root.open .m-dex.open:not([aria-hidden=true]), .m-root.open .m-dex.open.floating", "Pokédex menu"],
  [".name-panel", "name prompt"],
  [".pokedex-panel, .pokedex-screen", "Pokédex page"],
  [".start-panel", "start screen"],
  [".kid-card", "grown-ups check"],
  [".gift-panel", "gift panel"],
  [".game-menu", "settings menu"],
  [".link-picker", "link picker"],
];
/** Layers that blur what's behind them: a panel under one isn't read, so isn't counted. */
const SHADES = ".dm-sheet-shade, .m-shade, .dh-shade, .pokedex-shade, .ds-backdrop";
const TOASTS: [string, string][] = [
  [".m-toast", "menu toast"],
  [".game-toast", "game toast"],
  [".saved-toast", "saved toast"],
  [".gift-notices > *", "gift notice"],
];

export function census(page: Page): Promise<Census> {
  return page.evaluate(
    ({ PANELS, TOASTS, SHADES }) => {
      const vw = innerWidth;
      const vh = innerHeight;
      const faults: string[] = [];
      // What's on top at a point, pointer-events or not (overlays that let taps through count).
      const probe = document.createElement("style");
      probe.textContent = "* { pointer-events: auto !important; }";
      document.head.append(probe);
      const shown = (el: Element) => {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return null;
        if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return null;
        for (let e: Element | null = el; e; e = e.parentElement) {
          const s = getComputedStyle(e);
          if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) < 0.05) return null;
        }
        return r;
      };
      /** Every panel-like element shown, so occlusion is judged among them (not invisible full-screen layers). */
      const candidates = [...PANELS, ...TOASTS].flatMap(([sel]) => [...document.querySelectorAll(sel)]).filter((e) => shown(e));
      // Only a shade that blurs hides what's under it; a tint leaves it readable, so still on screen.
      candidates.push(...[...document.querySelectorAll(SHADES)].filter((e) => shown(e) && /blur/.test(getComputedStyle(e).backdropFilter || getComputedStyle(e).getPropertyValue("-webkit-backdrop-filter"))));
      const gbCanvas = document.querySelector("[data-testid=gb-screen]");
      if (gbCanvas && shown(gbCanvas)) candidates.push(gbCanvas);
      /** Share of an element's area where no other panel is drawn over it. */
      const onTop = (el: Element, r: DOMRect) => {
        let hit = 0;
        let n = 0;
        for (let i = 1; i <= 5; i++)
          for (let j = 1; j <= 5; j++) {
            const x = r.left + (r.width * i) / 6;
            const y = r.top + (r.height * j) / 6;
            if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
            n++;
            const stack = document.elementsFromPoint(x, y);
            const first = stack.find((e) => candidates.some((c) => c === e || c.contains(e)));
            if (first && (el === first || el.contains(first))) hit++;
          }
        return n ? hit / n : 0;
      };
      const label = (el: Element) => {
        const aria = el.getAttribute("aria-label");
        const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        return (aria ? `${aria}: ` : "") + text.slice(0, 80);
      };
      const collect = (list: [string, string][]) => {
        const out: { kind: string; label: string; box: { x: number; y: number; w: number; h: number } }[] = [];
        const seen = new Set<Element>();
        for (const [sel, kind] of list) {
          for (const el of document.querySelectorAll(sel)) {
            if (seen.has(el)) continue;
            seen.add(el);
            const r = shown(el);
            if (!r) continue;
            // Under another layer (the Pokédex over a message): not seen, so not counted.
            if (kind !== "Pokédex menu" && onTop(el, r) < 0.15) continue;
            out.push({ kind, label: label(el), box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } });
            // Cut off by the screen's edge (a few pixels of shadow are fine).
            if (kind !== "Pokédex menu" && (r.left < -4 || r.top < -4 || r.right > vw + 4 || r.bottom > vh + 4))
              faults.push(`${kind} runs off the screen (${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)} in ${vw}×${vh})`);
            // Words that don't fit: a child whose text overflows a box that hides it.
            for (const child of el.querySelectorAll("*")) {
              const c = child as HTMLElement;
              if (!c.childNodes.length || ![...c.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) continue;
              const s = getComputedStyle(c);
              if (s.overflowX === "auto" || s.overflowX === "scroll") continue;
              if (c.scrollWidth > c.clientWidth + 2 && (s.overflowX === "hidden" || s.textOverflow === "ellipsis") && shown(c))
                faults.push(`${kind}: "${(c.textContent ?? "").trim().slice(0, 40)}" is cut off (${c.scrollWidth}px in ${c.clientWidth}px)`);
            }
          }
        }
        return out;
      };
      let panels = collect(PANELS);
      // The open Pokédex fills the screen (a 3D dex the DOM can't see): what peeks out past its
      // edges is behind it, not a second panel.
      if (panels.some((p) => p.kind === "Pokédex menu")) panels = panels.filter((p) => p.kind === "Pokédex menu" || p.kind === "dex sheet");
      const toasts = collect(TOASTS);
      // Panels on top of each other (overlapping by more than a sliver).
      for (let i = 0; i < panels.length; i++)
        for (let j = i + 1; j < panels.length; j++) {
          const a = panels[i]!.box;
          const b = panels[j]!.box;
          const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (w > 8 && h > 8) faults.push(`${panels[i]!.kind} and ${panels[j]!.kind} overlap (${w}×${h})`);
        }
      // The Game Boy screen: its pixels that show (the battle mask makes the rest transparent).
      let gameBoy = 0;
      const gb = document.querySelector<HTMLCanvasElement>("[data-testid=gb-screen]");
      const gbRect = gb && shown(gb);
      if (gb && gbRect && onTop(gb, gbRect) > 0.15) {
        const data = gb.getContext("2d")!.getImageData(0, 0, gb.width, gb.height).data;
        let opaque = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i]! > 16) opaque++;
        gameBoy = opaque / (gb.width * gb.height);
      }
      probe.remove();
      const pad = document.querySelector(".touch-pad, [data-testid=touch-pad]");
      return { panels, toasts, gameBoy, touchPad: !!(pad && shown(pad)), faults };
    },
    { PANELS, TOASTS, SHADES },
  );
}

/** What deserves a closer look: more than one panel, any Game Boy screen, any layout fault. */
export function redFlags(c: Census, opts: { inWorld: boolean }): string[] {
  const flags: string[] = [];
  const kinds = c.panels.map((p) => p.kind);
  if (c.panels.length > 1) flags.push(`${c.panels.length} panels: ${kinds.join(" + ")}`);
  if (c.panels.length && c.toasts.length) flags.push(`toast over a panel: ${c.toasts.map((t) => t.kind).join(", ")} on ${kinds.join(", ")}`);
  if (opts.inWorld && c.gameBoy > 0.02) flags.push(`Game Boy screen showing (${Math.round(c.gameBoy * 100)}% of it)`);
  if (c.touchPad && c.panels.length) flags.push(`touch pad over ${kinds.join(", ")}`);
  flags.push(...c.faults);
  return flags;
}
