import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Root } from "./Root.tsx";
import { lockPage } from "./standalone.ts";
import "./style.css";

lockPage();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
