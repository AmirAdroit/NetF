import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import {
  normalizeThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
} from "./theme";

async function bootstrap() {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("mock")) {
    const { installDevelopmentMock } = await import("./devMock");
    await installDevelopmentMock();
  }

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
}

void bootstrap();
