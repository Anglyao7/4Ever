import { StrictMode, createElement } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./assets/base.css";

createRoot(document.getElementById("app")!).render(
  createElement(StrictMode, null, createElement(App)),
);
