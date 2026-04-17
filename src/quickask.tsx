import React from "react";
import ReactDOM from "react-dom/client";
import { QuickAsk } from "./components/QuickAsk";
import "./index.css";

ReactDOM.createRoot(document.getElementById("quickask-root")!).render(
  <React.StrictMode>
    <QuickAsk />
  </React.StrictMode>
);
