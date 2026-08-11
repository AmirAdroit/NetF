import { describe, expect, it } from "vitest";
import { selectedRules, summarizeScan, type ScanReport } from "./scanner";

const report: ScanReport = {
  root: "C:\\Games\\Example",
  executables: [
    { fileName: "game.exe", relativePath: "game.exe", rule: "game\\.exe" },
    {
      fileName: "launcher.exe",
      relativePath: "bin\\launcher.exe",
      rule: "launcher\\.exe",
    },
  ],
  warnings: ["Could not read one directory"],
  skippedReparsePoints: 1,
};

describe("scanner view model", () => {
  it("returns only rules that remain selected", () => {
    expect(selectedRules(report, new Set(["launcher\\.exe"]))).toEqual([
      "game\\.exe",
    ]);
  });

  it("summarizes a completed report", () => {
    expect(summarizeScan(report)).toEqual({
      executableCount: 2,
      warningCount: 1,
      skippedLinkCount: 1,
    });
  });

  it("has a stable empty summary", () => {
    expect(summarizeScan(null)).toEqual({
      executableCount: 0,
      warningCount: 0,
      skippedLinkCount: 0,
    });
  });
});
