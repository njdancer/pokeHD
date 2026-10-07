import { useEffect, useState } from "react";
import { checkRom, type RomHeader } from "@pokehd/rom";
import { Cartridge } from "./Cartridge.tsx";
import { GameView } from "./GameView.tsx";
import { fetchDevRom } from "./dev-rom.ts";
import { forgetRom, loadStoredRom, storeRom } from "./rom-store.ts";
import { SaveControls } from "./saves/SaveControls.tsx";
import { romKey } from "./saves/save-store.ts";

type State = { kind: "loading" } | { kind: "needs-rom"; error?: string } | { kind: "ready"; header: RomHeader; romKey: string };

export function App() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const accept = async (rom: Uint8Array) => {
    const check = await checkRom(rom);
    if (!check.ok) return setState({ kind: "needs-rom", error: check.reason });
    await storeRom(rom);
    setState({ kind: "ready", header: check.header, romKey: await romKey(rom) });
  };

  useEffect(() => {
    (async () => {
      const devRom = await fetchDevRom();
      if (devRom) return accept(devRom);
      const rom = await loadStoredRom();
      const check = rom && (await checkRom(rom));
      if (!rom || !check || !check.ok) return setState({ kind: "needs-rom" });
      setState({ kind: "ready", header: check.header, romKey: await romKey(rom) });
    })();
  }, []);

  const forget = async () => {
    await forgetRom();
    setState({ kind: "needs-rom" });
  };

  return (
    <>
      <GameView />
      {state.kind === "needs-rom" && <Cartridge error={state.error} onRom={accept} />}
      {state.kind === "ready" && (
        <div className="hud">
          <span>{state.header.title} loaded</span>
          <button type="button" onClick={forget}>Forget ROM</button>
          <SaveControls romKey={state.romKey} header={state.header} />
        </div>
      )}
    </>
  );
}
