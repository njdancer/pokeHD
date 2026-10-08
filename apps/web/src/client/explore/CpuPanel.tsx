// The CPU dock: the emulator's screen, run controls, registers and flags, the instruction under
// PC explained, the call stack and the last instructions that ran.
import { useEffect, useRef } from "react";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "@pokehd/emu";
import { bankReader, decode, explain, instructionText, romOffset } from "@pokehd/rom/explore";
import { useEmuVersion, useExplorer } from "./context.ts";
import { bestLabel, hex, labelsFor, namer, place, routeForLabel } from "./format.ts";
import type { BootFrom } from "./session.ts";

export function CpuPanel({ boot, booting }: { boot: (from: BootFrom) => void; booting: string }) {
  const { session } = useExplorer();
  if (!session) {
    return (
      <aside className="cpu">
        <h2>CPU</h2>
        <p className="muted">
          Boot the game in the explorer's own emulator to watch the CPU run it: step through instructions, set breakpoints
          and see which code runs. It never touches your saves.
        </p>
        <div className="boot">
          <button onClick={() => boot("power")}>Power on</button>
          <button onClick={() => boot("resume")}>Where I left off</button>
          <button onClick={() => boot("save")}>From my save</button>
        </div>
        {booting && <p className="muted">{booting}</p>}
      </aside>
    );
  }
  return <LiveCpu />;
}

const INTERRUPTS: Record<number, string> = { 0x40: "VBlank", 0x48: "LCD", 0x50: "Timer", 0x58: "Serial", 0x60: "Joypad" };

const FLAG_NAMES = [
  ["Z", 7, "Zero: the last result was 0 (or a compare was equal)"],
  ["N", 6, "Subtract: the last operation was a subtraction (used by daa)"],
  ["H", 5, "Half carry: a carry out of the low 4 bits (used by daa)"],
  ["C", 4, "Carry: the last add overflowed, a subtract borrowed, or a shift dropped a 1"],
] as const;

function LiveCpu() {
  const { session, db, go, rom } = useExplorer();
  const s = session!;
  useEmuVersion(s);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => s.attachScreen(canvas.current), [s]);

  const regs = s.gb.registers;
  const where = s.dbg.place;
  // Decode what the CPU actually sees: during power-on that's the boot ROM, not the cartridge.
  const ins = decode((a) => s.gb.read(a), regs.pc);
  const booting = regs.pc < 0x100 && s.gb.read(regs.pc) !== rom[regs.pc];
  const routine = db.before(where.bank, regs.pc);
  const name = namer(db, where.bank, routine?.name);
  const running = s.mode !== "paused";
  const f = regs.af & 0xff;

  return (
    <aside className="cpu">
      <div className="screen-wrap">
        <canvas
          ref={canvas}
          width={SCREEN_WIDTH}
          height={SCREEN_HEIGHT}
          className="screen"
          tabIndex={0}
          title="Click, then play with the arrow keys, X (A), Z (B), Enter (Start) and Backspace (Select)"
          onKeyDown={(e) => s.key(e.code, true) && e.preventDefault()}
          onKeyUp={(e) => s.key(e.code, false) && e.preventDefault()}
        />
        <p className="hint">Click the screen to play: arrows, X = A, Z = B, Enter = Start, Backspace = Select.</p>
      </div>
      <div className="controls">
        {running ? (
          <button onClick={() => s.setMode("paused")}>⏸ Pause</button>
        ) : (
          <button onClick={() => s.setMode("running")} title="Run, tracing every instruction (breakpoints work)">
            ▶ Run
          </button>
        )}
        <button onClick={() => s.setMode(s.mode === "fast" ? "running" : "fast")} className={s.mode === "fast" ? "on" : ""} title="Fast-forward: no trace or breakpoints">
          ⏩
        </button>
        <button onClick={() => s.step()} title="Run one instruction">Step</button>
        <button onClick={() => s.stepOver()} title="Run a call or rst to its return">Over</button>
        <button onClick={() => s.stepOut()} title="Run until this routine returns">Out</button>
        <button onClick={() => s.stepFrame()} title="Run to the end of this frame">Frame</button>
      </div>
      <p className="status">
        {s.mode === "running" ? "Running" : s.mode === "fast" ? "Fast-forwarding" : s.lastStop === "breakpoint" ? "Stopped at a breakpoint" : "Paused"}
        {" · "}
        {s.dbg.steps.toLocaleString()} instructions traced, frame {s.dbg.frames.toLocaleString()}
      </p>

      <section>
        <h3>
          Now at{" "}
          <button className="link" onClick={() => go({ view: "code", bank: where.bank, address: regs.pc })}>
            {place(where.bank, regs.pc)}
          </button>
          {routine && <span className="muted"> in {routine.name}</span>}
        </h3>
        {booting && (
          <p className="muted">
            The boot ROM is running: the Game Boy's own little program, mapped over $0000–$00FF at power-on. It scrolls the
            logo, checks the cartridge header, then hands over to the game at $0100.
          </p>
        )}
        <div className="now">
          <code>{instructionText(ins, name)}</code>
          <span className="muted">
            {" "}
            {ins.cycles}
            {ins.cyclesNotTaken ? `/${ins.cyclesNotTaken}` : ""} cycles
          </span>
          <p>{explain(ins, name)}</p>
        </div>
      </section>

      <section>
        <h3>Registers</h3>
        <div className="regs">
          {(["af", "bc", "de", "hl", "sp", "pc"] as const).map((r) => (
            <Register key={r} name={r} value={regs[r]} />
          ))}
        </div>
        <div className="flags">
          {FLAG_NAMES.map(([n, bit, about]) => (
            <span key={n} className={f & (1 << bit) ? "flag on" : "flag"} title={about}>
              {n}
            </span>
          ))}
          <span className="muted"> bank {hex(where.bank)} switched in</span>
        </div>
      </section>

      <CallStack />
      <Trace />
    </aside>
  );
}

function Register({ name, value }: { name: string; value: number }) {
  const { db, go, session } = useExplorer();
  const bank = session!.dbg.place.bank;
  // Only the general-purpose pairs hold pointers worth naming.
  const label = name === "af" || name === "sp" || name === "pc" ? undefined : bestLabel(labelsFor(db, bank, value));
  return (
    <div className="reg" title={label ? `${label.name}` : undefined}>
      <span className="muted">{name.toUpperCase()}</span>{" "}
      {name === "pc" || name === "sp" ? (
        <code>{hex(value, 4)}</code>
      ) : (
        <code>
          {hex(value >> 8)}
          <span className="lo">{hex(value & 0xff)}</span>
        </code>
      )}
      {label && (
        <button className="link small reg-label" onClick={() => go(routeForLabel(label))}>
          {label.name}
        </button>
      )}
    </div>
  );
}

function CallStack() {
  const { db, go, session } = useExplorer();
  const stack = session!.dbg.stack;
  if (!stack.length) return null;
  return (
    <section>
      <h3>Call stack</h3>
      <ol className="stack">
        {[...stack].reverse().slice(0, 24).map((frame, i) => {
          const into = frame.kind === "interrupt" ? { name: `${INTERRUPTS[frame.to.pc]} interrupt` } : db.before(frame.to.bank, frame.to.pc);
          const from = db.before(frame.from.bank, frame.from.pc);
          return (
            <li key={i}>
              <span className={`tag ${frame.kind}`}>{frame.kind === "interrupt" ? "irq" : frame.kind}</span>{" "}
              <button className="link" onClick={() => go({ view: "code", bank: frame.to.bank, address: frame.to.pc })}>
                {into?.name ?? place(frame.to.bank, frame.to.pc)}
              </button>
              <span className="muted"> from </span>
              <button className="link muted" onClick={() => go({ view: "code", bank: frame.from.bank, address: frame.from.pc })}>
                {from ? `${from.name}+${hex(frame.from.pc - from.address)}` : place(frame.from.bank, frame.from.pc)}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Trace() {
  const { db, go, session, rom } = useExplorer();
  const trace = session!.dbg.trace();
  // Collapse repeats (a halted CPU, tight loops) into counts.
  const rows: { bank: number; pc: number; n: number }[] = [];
  for (const p of trace) {
    const last = rows.at(-1);
    if (last && last.bank === p.bank && last.pc === p.pc) last.n++;
    else rows.push({ ...p, n: 1 });
  }
  return (
    <section>
      <h3>Last instructions</h3>
      <ol className="trace">
        {rows.slice(-40).reverse().map((r, i) => {
          const routine = db.before(r.bank, r.pc);
          const ins = decode(bankReader(rom, r.bank), r.pc);
          return (
            <li key={i}>
              <button className="link" onClick={() => go({ view: "code", bank: r.bank, address: r.pc })}>
                {place(r.bank, r.pc)}
              </button>{" "}
              <code>{instructionText(ins, namer(db, r.bank, routine?.name))}</code>
              {r.pc > 0 && rom[romOffset(r.bank, r.pc - 1)] === 0x76 && <span className="muted"> (after halt: waited for an interrupt)</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
