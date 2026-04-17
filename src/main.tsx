import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { initPlatform } from "./lib/platform";
import "./index.css";

// Tag the document with the detected OS before the first paint so CSS can
// branch on :root[data-platform="macos" | "windows" | "linux"].
initPlatform().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
