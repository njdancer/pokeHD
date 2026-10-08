import { useState, type DragEvent } from "react";

interface Props {
  error?: string;
  onRom(rom: Uint8Array): void;
}

export function Cartridge({ error, onRom }: Props) {
  const [over, setOver] = useState(false);
  const read = async (file: File | undefined) => file && onRom(new Uint8Array(await file.arrayBuffer()));
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    read(e.dataTransfer.files[0]);
  };

  return (
    <main className="cartridge">
      <h1>pokeHD</h1>
      <p>Load your own Pokémon Blue (USA/Europe) ROM. It stays in this browser and is never uploaded.</p>
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
      <p>Invited to play with friends? <a href="/login">Sign in</a>.</p>
    </main>
  );
}
