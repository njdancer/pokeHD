import { useEffect, useState } from "react";
import { checkRom, type RomHeader } from "@pokehd/rom";
import { Cartridge } from "./Cartridge.tsx";
import { GameView } from "./GameView.tsx";
import { forgetRom, loadStoredRom, storeRom } from "./rom-store.ts";

type State = { kind: "loading" } | { kind: "needs-rom"; error?: string } | { kind: "ready"; header: RomHeader };

export function App() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    loadStoredRom().then(async (rom) => {
      const check = rom && (await checkRom(rom));
      setState(check && check.ok ? { kind: "ready", header: check.header } : { kind: "needs-rom" });
    });
  }, []);

  const accept = async (rom: Uint8Array) => {
    const check = await checkRom(rom);
    if (!check.ok) return setState({ kind: "needs-rom", error: check.reason });
    await storeRom(rom);
    setState({ kind: "ready", header: check.header });
  };

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
        </div>
      )}
    </>
  );
}
