import React from "react";
import ReactDOM from "react-dom/client";
import { HudBar } from "./components/HudBar";

ReactDOM.createRoot(document.getElementById("hud-root")!).render(
  <React.StrictMode>
    <HudBar />
  </React.StrictMode>
);
