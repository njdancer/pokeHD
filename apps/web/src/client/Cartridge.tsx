import { useState, type DragEvent } from "react";
import type { Account } from "./room/account.ts";

interface Props {
  error?: string;
  /** Who's signed in: undefined while asking, null if nobody. */
  account: Account | null | undefined;
  onRom(rom: Uint8Array): void;
  /** Loads the cartridge Nick shares with the friends he invites (D26). */
  onShared(): Promise<void>;
}

export function Cartridge({ error, account, onRom, onShared }: Props) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const read = async (file: File | undefined) => file && onRom(new Uint8Array(await file.arrayBuffer()));
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    read(e.dataTransfer.files[0]);
  };
  const shared = async () => {
    setBusy(true);
    await onShared();
    setBusy(false);
  };

  return (
    <main className="cartridge">
      <h1>pokeHD</h1>
      {account?.romAccess && (
        <>
          <p>
            You're signed in as <strong className="who">{account.player.name}</strong>, and the game is shared with you.
          </p>
          <button type="button" className="primary" onClick={shared} disabled={busy}>
            {busy ? "Loading…" : "Play"}
          </button>
          <p>Or play with your own Pokémon Blue (USA/Europe) ROM. It stays in this browser.</p>
        </>
      )}
      {account && !account.romAccess && (
        <p>
          You're signed in as <strong className="who">{account.player.name}</strong>. Load your own Pokémon Blue
          (USA/Europe) ROM to play. It stays in this browser.
        </p>
      )}
      {!account && (
        <p>Load your own Pokémon Blue (USA/Europe) ROM. It stays in this browser and is never uploaded.</p>
      )}
      <label
        className={over ? "drop over" : "drop"}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <span>Drop a <code>.gb</code> file here, or click to choose one</span>
        <input type="file" accept=".gb,.gbc,application/octet-stream" onChange={(e) => read(e.target.files?.[0])} />
      </label>
      {error && <p className="status bad" role="alert">{error}</p>}
      {account === null && (
        <p>Invited to play? <a href="/login">Sign in</a> and you won't need a ROM of your own.</p>
      )}
      {account && <p><a href="/login">Your account</a></p>}
    </main>
  );
}
