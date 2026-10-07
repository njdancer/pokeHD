import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./style.css";

// Dev-only tools, left out of production builds.
const MapViewer = import.meta.env.DEV
  ? lazy(() => import("./dev/MapViewer.tsx").then((m) => ({ default: m.MapViewer })))
  : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {MapViewer && location.hash === "#maps" ? (
      <Suspense>
        <MapViewer />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
