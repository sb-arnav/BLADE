import React from "react";
import ReactDOM from "react-dom/client";
import { GhostOverlay } from "./components/GhostOverlay";

ReactDOM.createRoot(document.getElementById("ghost-overlay-root")!).render(
  <React.StrictMode>
    <GhostOverlay />
  </React.StrictMode>
);
