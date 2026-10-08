import { useRef, useState } from "react";
import type { RomHeader } from "@pokehd/rom";
import { CloudSaveStatus } from "./CloudSaveStatus.tsx";
import { cloudBackup } from "./cloud-save.ts";
import { keepSave } from "./history.ts";
import { checkSav, loadSave, savFileName, storeSave } from "./save-store.ts";

interface Props {
  romKey: string;
  header: RomHeader;
  /** Called after a .sav or the cloud copy replaces the stored save, so a running emulator can restart on it. */
  onImported?(sram: Uint8Array): void;
}

/** Export and import of the battery save as a .sav file, and its cloud backup. */
export function SaveControls({ romKey, header, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string>();

  const exportSav = async () => {
    const sram = await loadSave(romKey);
    if (!sram) return setMessage("No save yet. Save in the game first.");
    const url = URL.createObjectURL(new Blob([sram.slice().buffer], { type: "application/octet-stream" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: savFileName(header) });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setMessage(undefined);
  };

  const importSav = async (file: File | undefined) => {
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    const check = checkSav(new Uint8Array(await file.arrayBuffer()), header);
    if (!check.ok) return setMessage(check.reason);
    const current = await loadSave(romKey);
    if (current) {
      if (!confirm("Replace the save in this browser with this file? The save you have now is kept under Earlier saves.")) return;
      await keepSave(romKey, current, "before-import");
    }
    await storeSave(romKey, check.sram);
    cloudBackup(romKey).onSram(check.sram);
    setMessage("Save imported.");
    onImported?.(check.sram);
  };

  return (
    <>
      <button type="button" onClick={exportSav}>Export save</button>
      <button type="button" onClick={() => inputRef.current?.click()}>Import save</button>
      <input ref={inputRef} type="file" accept=".sav,.srm,application/octet-stream" hidden onChange={(e) => importSav(e.target.files?.[0])} />
      <CloudSaveStatus romKey={romKey} onRestored={(sram) => { setMessage("Save restored from the cloud."); onImported?.(sram); }} />
      {message && <span role="status">{message}</span>}
    </>
  );
}
