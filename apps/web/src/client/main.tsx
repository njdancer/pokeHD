import { StrictMode, type ErrorInfo } from "react";
import { createRoot } from "react-dom/client";
import { installErrorReporting, reportError } from "./errors.ts";
import { Root } from "./Root.tsx";
import { lockPage } from "./standalone.ts";
import "./style.css";

installErrorReporting();
lockPage();

/** React's render failures, with the component stack that says which screen it was. */
const reactError = (error: unknown, info: ErrorInfo) => {
  console.error(error);
  reportError("react", error, info.componentStack ? { componentStack: info.componentStack } : {});
};

createRoot(document.getElementById("root")!, { onUncaughtError: reactError, onCaughtError: reactError }).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
