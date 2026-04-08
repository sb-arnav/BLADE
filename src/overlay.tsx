import React from "react";
import ReactDOM from "react-dom/client";
import { ScreenOverlay } from "./components/ScreenOverlay";

ReactDOM.createRoot(document.getElementById("overlay-root")!).render(
  <React.StrictMode>
    <ScreenOverlay />
  </React.StrictMode>
);
