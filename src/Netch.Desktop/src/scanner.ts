export interface ScannedExecutable {
  fileName: string;
  relativePath: string;
  rule: string;
}

export interface ScanReport {
  root: string;
  executables: ScannedExecutable[];
  warnings: string[];
  skippedReparsePoints: number;
}

export function selectedRules(
  report: ScanReport | null,
  excludedRules: ReadonlySet<string>,
): string[] {
  if (!report) return [];

  return report.executables
    .map((executable) => executable.rule)
    .filter((rule) => !excludedRules.has(rule));
}

export function summarizeScan(report: ScanReport | null) {
  return {
    executableCount: report?.executables.length ?? 0,
    warningCount: report?.warnings.length ?? 0,
    skippedLinkCount: report?.skippedReparsePoints ?? 0,
  };
}
