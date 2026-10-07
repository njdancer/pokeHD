import { Suspense, lazy } from "react";
import { App } from "./App.tsx";

// Dev pages live under /dev/<task>/ and load lazily, so they never weigh on the game bundle.
const EmuDebug = lazy(() => import("./dev/emu/EmuDebug.tsx").then((m) => ({ default: m.EmuDebug })));

export function Root() {
  const path = location.pathname.replace(/\/$/, "");
  return <Suspense>{path === "/dev/emu" ? <EmuDebug /> : <App />}</Suspense>;
}
