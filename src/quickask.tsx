import React from "react";
import ReactDOM from "react-dom/client";
import { QuickAsk } from "./components/QuickAsk";
import { initPlatform } from "./lib/platform";
import "./index.css";

initPlatform().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <QuickAsk />
    </React.StrictMode>,
  );
});
