import { Suspense, lazy, useEffect, useState } from "react";
import { checkRom, type RomHeader } from "@pokehd/rom";
import { Cartridge } from "./Cartridge.tsx";
import { LoadingScreen } from "./LoadingScreen.tsx";
import { loadFanSet } from "./colour/fan-set.ts";
import { fetchDevRom } from "./dev-rom.ts";
import { forgetRom, loadStoredRom, storedRomIsShared, storeRom } from "./rom-store.ts";
import { me, type Account } from "./room/account.ts";
import { romKey } from "./saves/save-store.ts";
import { MAIN_SLOT, markPlayed } from "./saves/slots.ts";

// The game and the renderer (three.js, the emulator) are most of the app, so they load as their
// own chunks. The game starts downloading at once, while the ROM and account are checked.
const gameChunk = import("./game/Game.tsx");
const Game = lazy(() => gameChunk.then((m) => ({ default: m.Game })));
// The Pokédex menu on the modelled dex is the game's menu (Nick 2026-10-11, testing it everywhere);
// ?oldmenu brings back the game's own Start menu and the old dex.
const DEX_MENU = !new URLSearchParams(location.search).has("oldmenu");
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

  // The game plays the main slot (the save everyone already had) until the slot picker ships;
  // noting it played lists it among the player's slots, here and in the cloud.
  const readyKey = state.kind === "ready" ? state.romKey : null;
  // The fan's hand-coloured Pokémon pictures (D43), for players they're shared with.
  useEffect(() => {
    if (readyKey) void loadFanSet();
  }, [readyKey]);
  useEffect(() => {
    if (readyKey) void markPlayed(readyKey, MAIN_SLOT).catch((err) => console.warn("[pokeHD] couldn't update the save slots", err));
  }, [readyKey]);

  if (state.kind === "ready") {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <Game rom={state.rom} romKey={state.romKey} header={state.header} onForget={forget} menu={DEX_MENU} />
      </Suspense>
    );
  }
  // The game keeps the loading screen up until its world has drawn.
  if (state.kind === "loading") return <LoadingScreen />;
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
