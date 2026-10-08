// The disassembly: one ROM bank as an annotated listing, with the bank's labels alongside and the
// selected line explained underneath.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  decodeTextScript,
  explain,
  instructionText,
  lineIndexOf,
  operandText,
  romOffset,
  sourceUrl,
  type Instruction,
  type Label,
  type Line,
  type Namer,
  VECTORS,
} from "@pokehd/rom/explore";
import { useEmuVersion, useExplorer } from "./context.ts";
import { bestLabel, hex, KIND_INFO, labelsFor, namer, place, routeForLabel, shortName } from "./format.ts";
import { listingFor, xrefs, type Xref } from "./listings.ts";
import { VirtualList, type VirtualListHandle } from "./VirtualList.tsx";

const ROW = 20;

export function CodeView({ bank, address }: { bank: number; address: number }) {
  const { rom, db, session, go } = useExplorer();
  const version = useEmuVersion(session);
  const lines = useMemo(() => listingFor(rom, db, bank), [rom, db, bank]);
  const list = useRef<VirtualListHandle>(null);
  const [selected, setSelected] = useState(() => lineIndexOf(lines, address));
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    const i = lineIndexOf(lines, address);
    setSelected(i);
    list.current?.scrollTo(i);
  }, [lines, address]);

  // When the emulator stops, follow PC into its bank.
  const paused = session?.mode === "paused";
  const pc = session && paused ? session.dbg.place : undefined;
  const pcKey = pc ? `${pc.bank}:${pc.pc}` : "";
  useEffect(() => {
    if (!pc || !follow || pc.pc >= 0x8000) return;
    const pcBank = pc.pc < 0x4000 ? 0 : pc.bank;
    if (pcBank !== bank || pc.pc !== address) go({ view: "code", bank: pcBank, address: pc.pc });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pcKey, follow]);

  const pcInBank = pc && (pc.pc < 0x4000 ? bank === 0 : pc.bank === bank && pc.pc < 0x8000) ? pc.pc : -1;
  const line = lines[selected];

  return (
    <div className="code-view">
      <BankLabels bank={bank} current={line?.address ?? address} />
      <div className="listing-col">
        <div className="listing-bar">
          <strong>Bank {hex(bank)}</strong>
          <span className="muted">
            {bank === 0 ? "$0000–$3FFF, always mapped" : `$4000–$7FFF when switched in · file offset ${hex(bank * 0x4000, 5)}`}
          </span>
          <span className="spacer" />
          {session && (
            <label className="muted">
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> follow PC
            </label>
          )}
          <button disabled={bank === 0} onClick={() => go({ view: "code", bank: bank - 1, address: bank - 1 === 0 ? 0 : 0x4000 })}>
            ‹
          </button>
          <button disabled={bank >= rom.length / 0x4000 - 1} onClick={() => go({ view: "code", bank: bank + 1, address: 0x4000 })}>
            ›
          </button>
        </div>
        <VirtualList
          ref={list}
          className="listing"
          count={lines.length}
          rowHeight={ROW}
          row={(i) => (
            <ListingRow
              line={lines[i]!}
              bank={bank}
              selected={i === selected}
              isPc={lines[i]!.t === "ins" && lines[i]!.address === pcInBank}
              onSelect={() => setSelected(i)}
              version={version}
            />
          )}
        />
        {line && <LineDetail key={`${bank}:${selected}`} line={line} bank={bank} />}
      </div>
    </div>
  );
}

function BankLabels({ bank, current }: { bank: number; current: number }) {
  const { db, go } = useExplorer();
  const [filter, setFilter] = useState("");
  const labels = useMemo(
    () => db.inBank("rom", bank).filter((l) => !l.local && l.address < 0x8000 && (bank === 0 ? l.address < 0x4000 : true)),
    [db, bank],
  );
  const shown = filter ? labels.filter((l) => l.name.toLowerCase().includes(filter.toLowerCase())) : labels;
  const currentLabel = db.before(bank, current);
  const list = useRef<VirtualListHandle>(null);
  const index = currentLabel ? shown.indexOf(currentLabel) : -1;
  useEffect(() => {
    if (index >= 0) list.current?.scrollTo(index);
  }, [index]);
  return (
    <nav className="bank-labels">
      <input placeholder={`Filter ${labels.length} labels`} value={filter} onChange={(e) => setFilter(e.target.value)} />
      <VirtualList
        ref={list}
        count={shown.length}
        rowHeight={22}
        row={(i) => {
          const l = shown[i]!;
          return (
            <button
              className={`label-link ${l === currentLabel ? "current" : ""}`}
              onClick={() => go({ view: "code", bank, address: l.address })}
              title={`${place(bank, l.address)} · ${KIND_INFO[l.kind].name}`}
            >
              <i style={{ background: KIND_INFO[l.kind].colour }} />
              {l.name}
            </button>
          );
        }}
      />
    </nav>
  );
}

function ListingRow({
  line,
  bank,
  selected,
  isPc,
  onSelect,
}: {
  line: Line;
  bank: number;
  selected: boolean;
  isPc: boolean;
  onSelect: () => void;
  version: number;
}) {
  const { rom, db, session, go } = useExplorer();
  const cls = `line ${line.t} ${selected ? "selected" : ""} ${isPc ? "pc" : ""}`;
  if (line.t === "section") {
    return (
      <div className={cls} onClick={onSelect}>
        SECTION "{line.section.name}" <span className="muted">{hex(line.section.start, 4)}–{hex(line.section.end, 4)}</span>
        {bank === 0 && VECTORS[line.address] && <span className="comment">; {VECTORS[line.address]}</span>}
      </div>
    );
  }
  if (line.t === "free") {
    return (
      <div className={cls} onClick={onSelect}>
        <span className="addr">{place(bank, line.address)}</span> ; {line.length.toLocaleString()} bytes of free space (padding)
      </div>
    );
  }
  if (line.t === "label") {
    const l = line.label;
    const info = KIND_INFO[l.kind];
    let preview = "";
    if (l.kind === "text") {
      preview = decodeTextScript(rom, romOffset(bank, l.address), l.name.endsWith("Names") || !l.name.endsWith("Text"))
        .map((p) => (p.t === "text" ? p.text : p.t === "far" ? "→ far text" : `‹${p.t === "command" ? p.name : "asm"}›`))
        .join(" ")
        .replace(/\s+/g, " ")
        .slice(0, 90);
    }
    const scope = l.local ? db.before(bank, l.address)?.name : undefined;
    return (
      <div className={cls} onClick={onSelect}>
        <span className="gutter" />
        <span className="label-name" style={{ color: info.colour }}>
          {scope ? shortName(l, scope) : l.name}
          {l.local ? "" : "::"}
        </span>
        {!l.local && <span className="chip">{info.name}</span>}
        {(l.kind === "gfx2bpp" || l.kind === "gfx1bpp" || l.kind === "pic") && (
          <button className="link small" onClick={() => go(routeForLabel(l))}>
            view {l.kind === "pic" ? "picture" : "tiles"}
          </button>
        )}
        {preview && <span className="preview">“{preview}”</span>}
      </div>
    );
  }
  if (line.t === "data") {
    const text = line.kind === "text" ? decodeTextScript(rom, romOffset(bank, line.address), true)[0] : undefined;
    return (
      <div className={cls} onClick={onSelect}>
        <span className="gutter" />
        <span className="addr">{place(bank, line.address)}</span>
        <span className="op data-op">db</span>
        <span className="bytes-wide">{[...line.bytes].map((b) => `$${hex(b)}`).join(", ")}</span>
        {text && text.t === "text" && text.text && <span className="muted"> ; {text.text.slice(0, 24)}</span>}
      </div>
    );
  }
  const { ins, far } = line;
  const scope = db.before(bank, line.address)?.name;
  const name = namer(db, bank, scope);
  const bp = session?.hasBreakpoint(bank, line.address);
  const offset = romOffset(bank, line.address);
  const ran = session ? session.dbg.coverage[offset]! > 0 : false;
  return (
    <div className={cls} onClick={onSelect}>
      <span
        className={`gutter bp ${bp ? "on" : ""} ${ran ? "ran" : ""}`}
        title={bp ? "Remove breakpoint" : session ? "Set a breakpoint" : "Boot the emulator to set breakpoints"}
        onClick={(e) => {
          e.stopPropagation();
          session?.toggleBreakpoint(bank, line.address);
        }}
      >
        {isPc ? "▶" : ""}
      </span>
      <span className="addr">{place(bank, line.address)}</span>
      <span className="bytes">{ins.bytes.map((b) => hex(b)).join(" ")}</span>
      <span className="op">{ins.mnemonic}</span>
      <Operands ins={ins} bank={bank} name={name} />
      {far && (
        <span className="comment">
          {" "}
          ; {far.via === "Predef" ? "predef" : "far"} →{" "}
          <LabelLink bank={far.bank} address={far.address} />
        </span>
      )}
    </div>
  );
}

function Operands({ ins, bank, name }: { ins: Instruction; bank: number; name: Namer }) {
  const { db, go } = useExplorer();
  const parts: ReactNode[] = [];
  ins.operands.forEach((o, i) => {
    if (i) parts.push(", ");
    const text = operandText(o, name);
    const address = o.t === "target" || o.t === "n16" || o.t === "mem16" || o.t === "high" ? o.v : undefined;
    const label = address !== undefined ? bestLabel(labelsFor(db, bank, address)) : undefined;
    if (label && text.replace(/[[\]]/g, "") !== hex(address!, 4)) {
      parts.push(
        <button
          key={i}
          className="link sym"
          onClick={(e) => {
            e.stopPropagation();
            go(routeForLabel(label));
          }}
        >
          {text}
        </button>,
      );
    } else if (o.t === "target") {
      parts.push(
        <button key={i} className="link sym" onClick={(e) => (e.stopPropagation(), go({ view: "code", bank: o.v < 0x4000 ? 0 : bank, address: o.v }))}>
          {text}
        </button>,
      );
    } else parts.push(<span key={i}>{text}</span>);
  });
  return <span className="operands"> {parts}</span>;
}

function LabelLink({ bank, address }: { bank: number; address: number }) {
  const { db, go } = useExplorer();
  const label = bestLabel(db.at(address < 0x4000 ? 0 : bank, address));
  return (
    <button className="link sym" onClick={(e) => (e.stopPropagation(), go(label ? routeForLabel(label) : { view: "code", bank, address }))}>
      {label?.name ?? place(bank, address)}
    </button>
  );
}

function LineDetail({ line, bank }: { line: Line; bank: number }) {
  const { db, rom, go } = useExplorer();
  const label = line.t === "label" ? line.label : db.before(bank, line.address, false);
  const routine = db.before(bank, line.address);
  const section = db.sectionAt("rom", bank, line.address);
  const [refs, setRefs] = useState<Xref[] | null>(null);
  const target = line.t === "label" ? line.label : undefined;
  const showRefs = () => {
    if (!target) return;
    const key = (target.address < 0x4000 ? 0 : target.bank) * 0x10000 + target.address;
    setRefs(xrefs(rom, db).get(key) ?? []);
  };
  return (
    <div className="detail">
      {line.t === "ins" && (
        <>
          <p>
            <code className="big">{instructionText(line.ins, namer(db, bank, routine?.name))}</code>{" "}
            <span className="muted">
              {line.ins.bytes.length} byte{line.ins.bytes.length > 1 ? "s" : ""}, {line.ins.cycles}
              {line.ins.cyclesNotTaken ? ` (taken) / ${line.ins.cyclesNotTaken} (not taken)` : ""} cycles · flags{" "}
              <FlagEffects flags={line.ins.flags} />
            </span>
          </p>
          <p>{explain(line.ins, namer(db, bank, routine?.name))}</p>
        </>
      )}
      {target && <LabelInfo label={target} />}
      {line.t !== "label" && label && (
        <p className="muted">
          In <LabelLink bank={bank} address={label.address} />
          {line.address > label.address ? ` + $${hex(line.address - label.address)}` : ""}
          {section ? ` · section "${section.name}"` : ""} · file offset ${hex(romOffset(bank, line.address), 5)}
        </p>
      )}
      {target && (
        <div>
          {refs === null ? (
            <button onClick={showRefs}>Find references to {target.name}</button>
          ) : refs.length === 0 ? (
            <p className="muted">No direct references found (it may be reached through a pointer table).</p>
          ) : (
            <p className="refs">
              {refs.length} reference{refs.length > 1 ? "s" : ""}:{" "}
              {refs.slice(0, 60).map((r, i) => {
                const from = db.before(r.bank, r.address);
                return (
                  <button key={i} className="link small" onClick={() => go({ view: "code", bank: r.bank, address: r.address })}>
                    {r.how} from {from ? `${from.name}` : place(r.bank, r.address)}
                  </button>
                );
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function LabelInfo({ label }: { label: Label }) {
  const { db } = useExplorer();
  const url = sourceUrl(db, label);
  const next = db.after(label.bank, label.address);
  return (
    <p>
      <strong>{label.name}</strong> <span className="muted">at {place(label.bank, label.address)} · {KIND_INFO[label.kind].name}</span>
      {next && label.address < 0x8000 && <span className="muted"> · {(next.address - label.address).toLocaleString()} bytes to the next label</span>}
      {url && (
        <>
          {" · "}
          <a href={url} target="_blank" rel="noreferrer">
            {label.file}:{label.line} ↗
          </a>
        </>
      )}
    </p>
  );
}

const FLAG_ABOUT: Record<string, string> = { Z: "set from the result", N: "set from the operation", H: "set from the half carry", C: "set from the carry" };

function FlagEffects({ flags }: { flags: string }) {
  return (
    <span className="flag-effects">
      {[..."ZNHC"].map((f, i) => {
        const v = flags[i]!;
        const title = v === "-" ? `${f} unchanged` : v === "0" || v === "1" ? `${f} always ${v}` : `${f} ${FLAG_ABOUT[f]}`;
        return (
          <span key={f} title={title} className={v === "-" ? "muted" : ""}>
            {f}
            {v === "0" || v === "1" ? `=${v}` : ""}
          </span>
        );
      })}
    </span>
  );
}
