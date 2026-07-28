import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyTheme, loadThemeSetting } from "./theme";

// Stamp the theme before the first paint so there's no flash of the wrong palette.
applyTheme(loadThemeSetting());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
