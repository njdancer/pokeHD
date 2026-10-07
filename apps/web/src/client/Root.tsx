import { Suspense, lazy } from "react";
import { App } from "./App.tsx";

// Dev pages load lazily, so they never weigh on the game bundle.
const EmuDebug = lazy(() => import("./dev/emu/EmuDebug.tsx").then((m) => ({ default: m.EmuDebug })));
// Dev-only tools, left out of production builds.
const MapViewer = import.meta.env.DEV
  ? lazy(() => import("./dev/MapViewer.tsx").then((m) => ({ default: m.MapViewer })))
  : null;
const LabelViewer = import.meta.env.DEV
  ? lazy(() => import("./dev/LabelViewer.tsx").then((m) => ({ default: m.LabelViewer })))
  : null;

export function Root() {
  const path = location.pathname.replace(/\/$/, "");
  if (path === "/dev/emu") return <Suspense><EmuDebug /></Suspense>;
  if (MapViewer && location.hash === "#maps") return <Suspense><MapViewer /></Suspense>;
  if (LabelViewer && location.hash === "#labels") return <Suspense><LabelViewer /></Suspense>;
  return <App />;
}
