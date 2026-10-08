import { Suspense, lazy, useEffect, useState } from "react";
import { checkRom, type RomHeader } from "@pokehd/rom";
import { Cartridge } from "./Cartridge.tsx";
import { fetchDevRom } from "./dev-rom.ts";
import { forgetRom, loadStoredRom, storedRomIsShared, storeRom } from "./rom-store.ts";
import { me, type Account } from "./room/account.ts";
import { romKey } from "./saves/save-store.ts";

// The game and the renderer (three.js, the emulator) are most of the app, so they load as their
// own chunks. The game starts downloading at once, while the ROM and account are checked.
const gameChunk = import("./game/Game.tsx");
const Game = lazy(() => gameChunk.then((m) => ({ default: m.Game })));
const GameView = lazy(() => import("./GameView.tsx").then((m) => ({ default: m.GameView })));

type State =
  | { kind: "loading" }
  | { kind: "needs-rom"; error?: string }
  | { kind: "ready"; rom: Uint8Array; header: RomHeader; romKey: string };

/** Who's signed in: undefined while asking, null if nobody (or the server can't be reached). */
type Who = Account | null | undefined;

export function App() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [account, setAccount] = useState<Who>(undefined);

  const accept = async (rom: Uint8Array, shared = false) => {
    const check = await checkRom(rom);
    if (!check.ok) return setState({ kind: "needs-rom", error: check.reason });
    await storeRom(rom, shared);
    setState({ kind: "ready", rom, header: check.header, romKey: await romKey(rom) });
  };

  /** Loads Nick's cartridge (D26), for Nick and the friends he shares it with. */
  const loadShared = async () => {
    const rom = await fetchDevRom();
    if (rom) return accept(rom, true);
    setState({ kind: "needs-rom", error: "Couldn't fetch the shared cartridge. Check your connection and try again." });
  };

  useEffect(() => {
    (async () => {
      // Locally the dev server's ROM wins, so a rebuilt one is picked up.
      if (import.meta.env.DEV) {
        const devRom = await fetchDevRom();
        if (devRom) return accept(devRom);
      }
      // A network failure leaves the account unknown: play on with what's stored.
      const who = await me().catch(() => undefined);
      setAccount(who ?? null);
      let rom = await loadStoredRom();
      // Nick's cartridge goes once he stops sharing it, or the player signs out.
      if (rom && who !== undefined && !who?.romAccess && (await storedRomIsShared())) {
        await forgetRom();
        rom = null;
      }
      // Deployed, the stored ROM wins and Nick's cartridge fills in for a browser that has none.
      if (!rom && who?.romAccess && !import.meta.env.DEV) return loadShared();
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
    return (
      <Suspense>
        <Game rom={state.rom} romKey={state.romKey} header={state.header} onForget={forget} />
      </Suspense>
    );
  }
  if (state.kind === "loading") return null;
  // The look-dev scene stands behind the ROM loader until there's a game to play.
  return (
    <>
      <Suspense>
        <GameView />
      </Suspense>
      <Cartridge error={state.error} account={account} onRom={accept} onShared={loadShared} />
    </>
  );
}
