import { useEffect, useState } from "react";
import { cloudBackup, type CloudSave, type CloudStatus } from "./cloud-save.ts";

interface Props {
  romKey: string;
  /** Called after the cloud copy replaces the stored save, so a running emulator can restart on it. */
  onRestored?(sram: Uint8Array): void;
}

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Cloud backup state, and "restore from cloud" when another device has a newer save. */
export function CloudSaveStatus({ romKey, onRestored }: Props) {
  const [status, setStatus] = useState<CloudStatus>();

  useEffect(() => {
    let live = true;
    void cloudBackup(romKey).status().then((s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, [romKey]);

  const restore = async (cloud: CloudSave) => {
    if (!confirm(`Replace the save in this browser with the cloud save from ${when(cloud.savedAt)}?`)) return;
    await cloudBackup(romKey).restore(cloud);
    setStatus({ kind: "in-sync" });
    onRestored?.(cloud.sram);
  };

  switch (status?.kind) {
    case "newer":
      return (
        <button type="button" onClick={() => restore(status.cloud)} title={`Saved ${when(status.cloud.savedAt)}`}>
          Restore from cloud
        </button>
      );
    case "in-sync":
    case "none":
      return <span title="Each in-game save is backed up to your account.">Cloud backup on</span>;
    default:
      return null;
  }
}
