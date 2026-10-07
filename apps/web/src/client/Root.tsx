import { Suspense, lazy } from "react";
import { App } from "./App.tsx";

// Dev pages load lazily, so they never weigh on the game bundle.
const EmuDebug = lazy(() => import("./dev/emu/EmuDebug.tsx").then((m) => ({ default: m.EmuDebug })));
const LivePlayback = lazy(() => import("./dev/LivePlayback.tsx").then((m) => ({ default: m.LivePlayback })));
const TextDebug = lazy(() => import("./dev/TextDebug.tsx").then((m) => ({ default: m.TextDebug })));
const StyleCompare = lazy(() => import("./dev/StyleCompare.tsx").then((m) => ({ default: m.StyleCompare })));
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
  if (path === "/dev/live") return <Suspense><LivePlayback /></Suspense>;
  if (path === "/dev/text") return <Suspense><TextDebug /></Suspense>;
  if (path === "/dev/styles") return <Suspense><StyleCompare /></Suspense>;
  if (MapViewer && location.hash === "#maps") return <Suspense><MapViewer /></Suspense>;
  if (LabelViewer && location.hash === "#labels") return <Suspense><LabelViewer /></Suspense>;
  return <App />;
}
