import { describe, expect, it } from "vitest";
import { normalizeThemePreference, resolveTheme } from "./theme";

describe("theme preference", () => {
  it.each(["system", "light", "dark"] as const)(
    "preserves a valid %s preference",
    (preference) => {
      expect(normalizeThemePreference(preference)).toBe(preference);
    },
  );

  it("falls back to system for missing or unknown values", () => {
    expect(normalizeThemePreference(null)).toBe("system");
    expect(normalizeThemePreference("midnight")).toBe("system");
  });

  it("resolves system preference in both directions", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("keeps an explicit preference when the system differs", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});
