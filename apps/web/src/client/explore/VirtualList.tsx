import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";

export interface VirtualListHandle {
  /** Scrolls so `index` is in view, a third of the way down. */
  scrollTo(index: number): void;
}

/** A fixed-row-height list that only renders the rows in view (bank listings run to 10k rows). */
export function VirtualList({
  count,
  rowHeight,
  row,
  ref,
  className,
}: {
  count: number;
  rowHeight: number;
  row: (index: number) => ReactNode;
  ref?: Ref<VirtualListHandle>;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(600);

  useEffect(() => {
    const el = box.current!;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useImperativeHandle(ref, () => ({
    scrollTo(index) {
      const el = box.current;
      if (!el) return;
      const y = index * rowHeight;
      if (y < el.scrollTop + rowHeight || y > el.scrollTop + el.clientHeight - 2 * rowHeight) {
        el.scrollTop = Math.max(0, y - el.clientHeight / 3);
        setTop(el.scrollTop);
      }
    },
  }));

  const first = Math.max(0, Math.floor(top / rowHeight) - 10);
  const last = Math.min(count, Math.ceil((top + height) / rowHeight) + 10);
  const rows: ReactNode[] = [];
  for (let i = first; i < last; i++) {
    rows.push(
      <div key={i} className="vrow" style={{ top: i * rowHeight, height: rowHeight }}>
        {row(i)}
      </div>,
    );
  }
  return (
    <div ref={box} className={`vlist ${className ?? ""}`} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
      <div style={{ height: count * rowHeight, position: "relative" }}>{rows}</div>
    </div>
  );
}
