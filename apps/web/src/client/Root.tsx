import { Suspense, lazy } from "react";
import { App } from "./App.tsx";

// The friends sign-in page (D23) and dev pages load lazily, so they never weigh on the game bundle.
const Login = lazy(() => import("./room/Login.tsx").then((m) => ({ default: m.Login })));
const EmuDebug = lazy(() => import("./dev/emu/EmuDebug.tsx").then((m) => ({ default: m.EmuDebug })));
const LivePlayback = lazy(() => import("./dev/LivePlayback.tsx").then((m) => ({ default: m.LivePlayback })));
const TextDebug = lazy(() => import("./dev/TextDebug.tsx").then((m) => ({ default: m.TextDebug })));
const BattleDev = lazy(() => import("./dev/BattleDev.tsx").then((m) => ({ default: m.BattleDev })));
const UiLooks = lazy(() => import("./dev/UiLooks.tsx").then((m) => ({ default: m.UiLooks })));
const Bench = lazy(() => import("./dev/Bench.tsx").then((m) => ({ default: m.Bench })));
// Crash reports (/admin/errors), for Nick.
const Errors = lazy(() => import("./admin/Errors.tsx").then((m) => ({ default: m.Errors })));
// Perf telemetry (/admin/perf), for Nick.
const Perf = lazy(() => import("./admin/Perf.tsx").then((m) => ({ default: m.Perf })));
// The relief lab (/admin/lab): training runs from Nick's Mac, for Nick.
const Lab = lazy(() => import("./admin/lab/Lab.tsx").then((m) => ({ default: m.Lab })));
// The ROM explorer (/explore), with its ~850 KB label table, only loads when opened.
const Explorer = lazy(() => import("./explore/Explorer.tsx").then((m) => ({ default: m.Explorer })));
// The Pokédex's looks, side by side while Nick picks (p2-dex).
const DexDev = lazy(() => import("./dev/DexDev.tsx").then((m) => ({ default: m.DexDev })));
const DexShapeDev = lazy(() => import("./dev/DexShapeDev.tsx").then((m) => ({ default: m.DexShapeDev })));
const MenuDev = lazy(() => import("./dev/MenuDev.tsx").then((m) => ({ default: m.MenuDev })));
const SavesDev = lazy(() => import("./dev/SavesDev.tsx").then((m) => ({ default: m.SavesDev })));
// The Pokédex menu in the real game (p2-dex-menu), until Nick picks it.
const MenuLive = lazy(() => import("./dev/MenuLive.tsx").then((m) => ({ default: m.MenuLive })));
const DialogDev = lazy(() => import("./dev/DialogDev.tsx").then((m) => ({ default: m.DialogDev })));
// The relief editor: paint which way each pixel faces, for training data only (never used in play).
const ReliefEditor = lazy(() => import("./tools/relief/ReliefEditor.tsx").then((m) => ({ default: m.ReliefEditor })));
// The QA stream's broadcast overlay (Claude plays, Opus fixes), captured by OBS at 1920×1080.
const StreamHost = lazy(() => import("./dev/stream/StreamHost.tsx").then((m) => ({ default: m.StreamHost })));
const WatchPage = lazy(() => import("./dev/stream/WatchPage.tsx").then((m) => ({ default: m.WatchPage })));
const StreamPage = lazy(() => import("./dev/stream/StreamPage.tsx").then((m) => ({ default: m.StreamPage })));
const StyleCompare = lazy(() => import("./dev/StyleCompare.tsx").then((m) => ({ default: m.StyleCompare })));
// Dev-only tools, left out of production builds.
const MapViewer = import.meta.env.DEV
  ? lazy(() => import("./dev/MapViewer.tsx").then((m) => ({ default: m.MapViewer })))
  : null;
// The screenshot regression tests' page (e2e/shots.e2e.ts).
const Shots = import.meta.env.DEV
  ? lazy(() => import("./dev/Shots.tsx").then((m) => ({ default: m.Shots })))
  : null;
const LabelViewer = import.meta.env.DEV
  ? lazy(() => import("./dev/LabelViewer.tsx").then((m) => ({ default: m.LabelViewer })))
  : null;

export function Root() {
  const path = location.pathname.replace(/\/$/, "");
  // `/join` was the D19 page; old bookmarks still land on sign-in.
  if (path === "/login" || path === "/join") return <Suspense><Login /></Suspense>;
  if (path === "/admin/errors") return <Suspense><Errors /></Suspense>;
  if (path === "/admin/perf") return <Suspense><Perf /></Suspense>;
  if (path === "/admin/lab") return <Suspense><Lab /></Suspense>;
  if (path === "/explore") return <Suspense><Explorer /></Suspense>;
  if (path === "/dev/emu") return <Suspense><EmuDebug /></Suspense>;
  if (path === "/dev/live") return <Suspense><LivePlayback /></Suspense>;
  if (path === "/dev/text") return <Suspense><TextDebug /></Suspense>;
  if (path === "/dev/battle") return <Suspense><BattleDev /></Suspense>;
  if (path === "/dev/ui") return <Suspense><UiLooks /></Suspense>;
  if (path === "/dev/bench") return <Suspense><Bench /></Suspense>;
  if (path === "/dev/dex") return <Suspense><DexDev /></Suspense>;
  if (path === "/dev/dex/shape") return <Suspense><DexShapeDev /></Suspense>;
  if (path === "/dev/menu") return <Suspense><MenuDev /></Suspense>;
  if (path === "/dev/saves") return <Suspense><SavesDev /></Suspense>;
  if (path === "/dev/menu/live") return <Suspense><MenuLive /></Suspense>;
  if (path === "/dev/dialog") return <Suspense><DialogDev /></Suspense>;
  if (path === "/tools/relief") return <Suspense><ReliefEditor /></Suspense>;
  if (path === "/dev/stream") return <Suspense><StreamHost /></Suspense>;
  if (path === "/dev/stream/overlay") return <Suspense><StreamPage /></Suspense>;
  if (path === "/dev/watch") return <Suspense><WatchPage /></Suspense>;
  if (path === "/dev/styles") return <Suspense><StyleCompare /></Suspense>;
  if (Shots && path === "/dev/shots") return <Suspense><Shots /></Suspense>;
  if (MapViewer && location.hash === "#maps") return <Suspense><MapViewer /></Suspense>;
  if (LabelViewer && location.hash === "#labels") return <Suspense><LabelViewer /></Suspense>;
  return <App />;
}
