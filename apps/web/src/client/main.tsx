import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./style.css";

// Dev-only tools, left out of production builds.
const MapViewer = import.meta.env.DEV
  ? lazy(() => import("./dev/MapViewer.tsx").then((m) => ({ default: m.MapViewer })))
  : null;
const LabelViewer = import.meta.env.DEV
  ? lazy(() => import("./dev/LabelViewer.tsx").then((m) => ({ default: m.LabelViewer })))
  : null;

const DevPage = { "#maps": MapViewer, "#labels": LabelViewer }[location.hash];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense>
      {DevPage ? <DevPage /> : <App />}
    </Suspense>
  </StrictMode>,
);
