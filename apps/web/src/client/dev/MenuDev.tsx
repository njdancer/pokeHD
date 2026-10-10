// The Pokédex menu (p2-dex-menu, D40) in the real game, at /dev/menu until Nick picks it: the
// same save as the main page (the main slot), with the menu in place of Start and Select, the
// game's questions as sheets and the play journal recording. Prototype and decisions:
// /mnt/project-files/dex-menu/.
import { Suspense, lazy, useEffect, useState } from "react";
import { checkRom, type RomHeader } from "@pokehd/rom";
import { fetchDevRom } from "../dev-rom.ts";
import { loadStoredRom } from "../rom-store.ts";
import { romKey } from "../saves/save-store.ts";

const Game = lazy(() => import("../game/Game.tsx").then((m) => ({ default: m.Game })));

export function MenuDev() {
  const [cart, setCart] = useState<{ rom: Uint8Array; header: RomHeader; key: string } | null>(null);
  const [status, setStatus] = useState("Loading the game…");
  useEffect(() => {
    void (async () => {
      const rom = (await fetchDevRom()) ?? (await loadStoredRom());
      if (!rom) return setStatus("No ROM: load one on the main page first.");
      const check = await checkRom(rom);
      if (!check.ok) return setStatus(check.reason);
      setCart({ rom, header: check.header, key: await romKey(rom) });
    })();
  }, []);
  if (!cart) return <p style={{ padding: 16, font: "16px system-ui" }}>{status}</p>;
  return (
    <Suspense>
      <Game rom={cart.rom} romKey={cart.key} header={cart.header} onForget={() => location.assign("/")} menu />
    </Suspense>
  );
}
