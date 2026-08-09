import { describe, expect, it } from "vitest";
import { enginePresentation, errorMessage } from "./desktop";

describe("desktop state presentation", () => {
  it("does not rely on color to distinguish active and inactive states", () => {
    expect(enginePresentation("connected").label).toContain("ACTIVE");
    expect(enginePresentation("stopped").label).toContain("INACTIVE");
    expect(enginePresentation("failed").label).toContain("ATTENTION");
  });

  it("extracts typed command errors instead of rendering object placeholders", () => {
    expect(errorMessage({ code: "failed", message: "Actionable failure", retryable: true }))
      .toBe("Actionable failure");
  });
});
