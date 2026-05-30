import { StrictMode, createElement } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./assets/base.css";
import "./assets/canvas.css";

createRoot(document.getElementById("root")!).render(
  createElement(StrictMode, null, createElement(App)),
);
