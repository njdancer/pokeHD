// A live hex view of the CPU's whole address space, annotated with the disassembly's RAM labels
// and the hardware registers.
import { useEffect, useMemo, useRef, useState } from "react";
import { bankReader, IO_REGISTERS, regionAt, type Label } from "@pokehd/rom/explore";
import { useEmuVersion, useExplorer } from "./context.ts";
import { hex, labelsFor } from "./format.ts";
import { VirtualList, type VirtualListHandle } from "./VirtualList.tsx";

const ROW = 20;

export function MemoryView({ address }: { address: number }) {
  const { db, rom, session, go } = useExplorer();
  useEmuVersion(session);
  const list = useRef<VirtualListHandle>(null);
  const [jump, setJump] = useState("");
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => list.current?.scrollTo(address >> 4), [address]);

  const bank = session?.dbg.place.bank ?? 1;
  const read = session ? (a: number) => session.gb.read(a) : (a: number) => (a < 0x8000 ? bankReader(rom, 1)(a) : -1);

  // The label that each RAM byte belongs to: the nearest label at or before it.
  const owner = (a: number): Label | undefined => {
    if (a < 0x8000) return db.before(a < 0x4000 ? 0 : bank, a, false);
    if (a >= 0xff00 && a < 0xff80) return undefined;
    if (a >= 0xa000 && a < 0xc000) {
      // Save RAM labels are spread over its four banks; take the closest.
      const found = [0, 1, 2, 3].map((b) => db.before(b, a, false)).filter((l) => l && l.address >= 0xa000);
      return found.sort((x, y) => y!.address - x!.address)[0];
    }
    const l = db.before(0, a, false);
    return l && regionAt(l.address) === regionAt(a) ? l : undefined;
  };

  const ramLabels = useMemo(() => db.inBank("ram", 0).filter((l) => !l.local), [db]);
  const [filter, setFilter] = useState("");
  const shown = filter ? ramLabels.filter((l) => l.name.toLowerCase().includes(filter.toLowerCase())) : [];

  const describe = (a: number) => {
    const io = IO_REGISTERS[a];
    if (io) return `${io.name}: ${io.about}`;
    const l = owner(a);
    const region = regionAt(a);
    return `${hex(a, 4)} · ${region.name}${l ? ` · ${l.name}${a > l.address ? `+${a - l.address}` : ""}` : ""}`;
  };

  return (
    <div className="memory-view">
      <div className="listing-bar">
        <strong>Memory</strong>
        <span className="muted">
          {session ? "Live from the emulator" : "Boot the emulator to see RAM; until then this shows the ROM (bank 1 at $4000)."}
        </span>
        <span className="spacer" />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = parseInt(jump.replace(/^\$/, ""), 16);
            const l = db.byName.get(jump);
            if (l) go({ view: "memory", address: l.address });
            else if (Number.isFinite(n)) go({ view: "memory", address: n & 0xffff });
          }}
        >
          <input placeholder="Go to $C000 or wPartyCount" value={jump} onChange={(e) => setJump(e.target.value)} />
        </form>
      </div>
      <div className="memory-body">
        <VirtualList
          ref={list}
          className="hex"
          count={0x1000}
          rowHeight={ROW}
          row={(r) => {
            const base = r << 4;
            const region = regionAt(base);
            const labels = [];
            for (let i = 0; i < 16; i++) {
              const ls = base + i >= 0x8000 ? labelsFor(db, bank, base + i).filter((l) => !l.local) : [];
              if (ls.length) labels.push(ls[0]!);
            }
            const cells = [];
            for (let i = 0; i < 16; i++) {
              const a = base + i;
              const v = read(a);
              const l = a >= 0x8000 ? owner(a) : undefined;
              const starts = l && l.address === a;
              const tint = l ? hueFor(l.name) : undefined;
              cells.push(
                <span
                  key={i}
                  className={`byte ${starts ? "starts" : ""} ${hover === a ? "hover" : ""} ${IO_REGISTERS[a] ? "io" : ""}`}
                  style={tint ? { background: `hsl(${tint} 45% 30% / .45)` } : undefined}
                  title={describe(a)}
                  onMouseEnter={() => setHover(a)}
                >
                  {v < 0 ? "··" : hex(v)}
                </span>,
              );
            }
            return (
              <div className={`hex-row ${base === region.start ? "region-start" : ""}`}>
                <span className="addr">{hex(base, 4)}</span>
                {cells}
                <span className="hex-labels">
                  {base === region.start && <em>{region.name} </em>}
                  {labels.slice(0, 3).map((l) => l.name).join(", ")}
                  {labels.length > 3 ? ` +${labels.length - 3}` : ""}
                </span>
              </div>
            );
          }}
        />
        <aside className="memory-side">
          <p className="hover-line">{hover !== null ? describe(hover) : "Hover a byte to see what it is."}</p>
          <input placeholder={`Find a RAM variable (${ramLabels.length})`} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <ul className="ram-labels">
            {(filter ? shown : COMMON.map((n) => db.byName.get(n)).filter((l): l is Label => !!l)).slice(0, 80).map((l) => (
              <li key={l.name}>
                <button className="link" onClick={() => go({ view: "memory", address: l.address })}>
                  {l.name}
                </button>{" "}
                <code className="muted">{hex(l.address, 4)}</code>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

/** Some well-known variables to start from. */
const COMMON = [
  "wCurMap",
  "wXCoord",
  "wYCoord",
  "wPartyCount",
  "wPartyMons",
  "wNumBagItems",
  "wPlayerMoney",
  "wPlayerName",
  "wObtainedBadges",
  "wTileMap",
  "wShadowOAM",
  "wSpriteStateData1",
  "wEventFlags",
  "hLoadedROMBank",
  "hJoyHeld",
  "sGameData",
  "vChars0",
  "vBGMap0",
];

function hueFor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}
