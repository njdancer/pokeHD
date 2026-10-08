import { useEffect, useState } from "react";
import { checkRom, type RomHeader } from "@pokehd/rom";
import { Cartridge } from "./Cartridge.tsx";
import { GameView } from "./GameView.tsx";
import { fetchDevRom } from "./dev-rom.ts";
import { forgetRom, loadStoredRom, storeRom } from "./rom-store.ts";
import { Game } from "./game/Game.tsx";
import { romKey } from "./saves/save-store.ts";

type State =
  | { kind: "loading" }
  | { kind: "needs-rom"; error?: string }
  | { kind: "ready"; rom: Uint8Array; header: RomHeader; romKey: string };

export function App() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const accept = async (rom: Uint8Array) => {
    const check = await checkRom(rom);
    if (!check.ok) return setState({ kind: "needs-rom", error: check.reason });
    await storeRom(rom);
    setState({ kind: "ready", rom, header: check.header, romKey: await romKey(rom) });
  };

  useEffect(() => {
    (async () => {
      // Locally the dev server's ROM wins, so a rebuilt one is picked up. Deployed, the stored
      // ROM wins and Nick's test ROM only fills in for a browser that has none.
      if (import.meta.env.DEV) {
        const devRom = await fetchDevRom();
        if (devRom) return accept(devRom);
      }
      const rom = await loadStoredRom();
      if (!rom && !import.meta.env.DEV) {
        const devRom = await fetchDevRom();
        if (devRom) return accept(devRom);
      }
      const check = rom && (await checkRom(rom));
      if (!rom || !check || !check.ok) return setState({ kind: "needs-rom" });
      setState({ kind: "ready", rom, header: check.header, romKey: await romKey(rom) });
    })();
  }, []);

  const forget = async () => {
    await forgetRom();
    setState({ kind: "needs-rom" });
  };

  if (state.kind === "ready") {
    return <Game rom={state.rom} romKey={state.romKey} header={state.header} onForget={forget} />;
  }
  if (state.kind === "loading") return null;
  // The look-dev scene stands behind the ROM loader until there's a game to play.
  return (
    <>
      <GameView />
      <Cartridge error={state.error} onRom={accept} />
    </>
  );
}
