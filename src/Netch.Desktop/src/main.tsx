import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import {
  normalizeThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
} from "./theme";

const initialTheme = resolveTheme(
  normalizeThemePreference(localStorage.getItem(THEME_STORAGE_KEY)),
  window.matchMedia("(prefers-color-scheme: dark)").matches,
);
document.documentElement.dataset.theme = initialTheme;
document.documentElement.style.colorScheme = initialTheme;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
