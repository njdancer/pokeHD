import { useEffect, useState } from "react";
import { describeSave, keepSave, listHistory, reasonText, type HistoryEntry } from "./history.ts";
import { loadSave } from "./save-store.ts";

interface Props {
  romKey: string;
  /** Replaces the save with an earlier one and restarts the game on it. */
  onRestore(sram: Uint8Array): void;
}

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Settings' list of earlier saves (history.ts), each one tap (and a confirm) from coming back. */
export function EarlierSaves({ romKey, onRestore }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void listHistory(romKey).then((e) => live && setEntries(e), () => live && setEntries([]));
    return () => {
      live = false;
    };
  }, [romKey, open]);

  const restore = async (entry: HistoryEntry) => {
    if (!entry.sram || !entry.summary) return;
    if (!confirm(`Go back to ${describeSave(entry.summary)}, saved ${when(entry.takenAt)}? The save you have now is kept in this list.`)) return;
    const current = await loadSave(romKey);
    if (current) await keepSave(romKey, current, "before-rollback");
    onRestore(entry.sram);
  };

  if (!open) return <button type="button" onClick={() => setOpen(true)}>Earlier saves…</button>;
  if (!entries) return <span>Looking for earlier saves…</span>;
  if (entries.length === 0) return <span>No earlier saves yet. One is kept every half hour of play.</span>;
  return (
    <ul className="earlier-saves">
      {entries.map((entry) => (
        <li key={entry.id}>
          <span>
            {describeSave(entry.summary!)}
            <small>
              {when(entry.takenAt)}
              {reasonText(entry.reason) ? `, ${reasonText(entry.reason)}` : ""}
              {entry.cloud ? " · in the cloud" : ""}
            </small>
          </span>
          <button type="button" onClick={() => restore(entry)}>Go back</button>
        </li>
      ))}
    </ul>
  );
}
