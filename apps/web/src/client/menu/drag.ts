// Drag to reorder, for the menu's lists (team, moves, bag): press a row's handle, move, let go.
// Pointer events, so it works the same with a finger, a pen or a mouse.
import { useRef, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Returns props for a row's handle. `onMove(from, to)` runs once on release, with indices in the
 * list's order, only if the row moved.
 */
export function useReorder(onMove: (from: number, to: number) => void) {
  const state = useRef<{ from: number; to: number; rows: HTMLElement[]; row: HTMLElement; startY: number } | null>(null);
  return (index: number) => ({
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      const row = e.currentTarget.closest<HTMLElement>("[data-row]");
      const list = row?.parentElement;
      if (!row || !list) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const rows = [...list.querySelectorAll<HTMLElement>(":scope > [data-row]")];
      state.current = { from: index, to: index, rows, row, startY: e.clientY };
      row.classList.add("dragging");
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      const s = state.current;
      if (!s) return;
      s.row.style.transform = `translateY(${e.clientY - s.startY}px)`;
      const centres = s.rows.map((r) => {
        const box = r.getBoundingClientRect();
        return box.top + box.height / 2 - (r === s.row ? e.clientY - s.startY : 0);
      });
      let to = centres.findIndex((c) => e.clientY < c);
      if (to < 0) to = s.rows.length - 1;
      else if (to > s.from) to--;
      s.to = to;
    },
    onPointerUp() {
      const s = state.current;
      if (!s) return;
      state.current = null;
      s.row.classList.remove("dragging");
      s.row.style.transform = "";
      if (s.to !== s.from) onMove(s.from, s.to);
    },
    onPointerCancel() {
      const s = state.current;
      if (!s) return;
      state.current = null;
      s.row.classList.remove("dragging");
      s.row.style.transform = "";
    },
  });
}
