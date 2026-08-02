use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedExecutable {
    pub file_name: String,
    pub relative_path: String,
    pub rule: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub root: String,
    pub executables: Vec<ScannedExecutable>,
    pub warnings: Vec<String>,
    pub skipped_reparse_points: usize,
}

#[derive(Debug, Error)]
pub enum ScanError {
    #[error("The selected directory does not exist or is not a directory: {0}")]
    InvalidRoot(String),
    #[error("Could not resolve the selected directory {path}: {source}")]
    ResolveRoot {
        path: String,
        source: std::io::Error,
    },
    #[error(
        "More than {limit} unique executables were found. Choose a narrower directory or raise the safety limit."
    )]
    ResultLimitExceeded { limit: usize },
}

/// Recursively discovers `.exe` files without following directory links.
///
/// Compatibility contract with the legacy Netch process-mode scanner:
/// - a rule is based on the executable filename, not its absolute path;
/// - the C++ regex metacharacters escaped by `StringExtension.ToRegexString`
///   remain escaped in exactly the same way;
/// - output is suitable for one-rule-per-line legacy mode configuration.
///
/// Improvements over the legacy scanner are deterministic ordering,
/// case-insensitive extension matching, duplicate removal, non-fatal warnings
/// for inaccessible descendants, and protection against reparse-point loops.
pub fn scan(root: impl AsRef<Path>, max_results: usize) -> Result<ScanReport, ScanError> {
    let requested_root = root.as_ref();
    if !requested_root.is_dir() {
        return Err(ScanError::InvalidRoot(
            requested_root.to_string_lossy().into_owned(),
        ));
    }

    let root = requested_root
        .canonicalize()
        .map_err(|source| ScanError::ResolveRoot {
            path: requested_root.to_string_lossy().into_owned(),
            source,
        })?;

    let mut pending = vec![root.clone()];
    let mut executables_by_name = BTreeMap::new();
    let mut warnings = Vec::new();
    let mut skipped_reparse_points = 0;

    while let Some(directory) = pending.pop() {
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) => {
                warnings.push(format!(
                    "Could not read {}: {error}",
                    display_relative(&root, &directory)
                ));
                continue;
            }
        };

        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    warnings.push(format!(
                        "Could not read an entry in {}: {error}",
                        display_relative(&root, &directory)
                    ));
                    continue;
                }
            };

            let path = entry.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) => {
                    warnings.push(format!(
                        "Could not inspect {}: {error}",
                        display_relative(&root, &path)
                    ));
                    continue;
                }
            };

            if is_reparse_point(&metadata) {
                skipped_reparse_points += 1;
                continue;
            }

            if metadata.is_dir() {
                pending.push(path);
                continue;
            }

            if !metadata.is_file() || !has_exe_extension(&path) {
                continue;
            }

            let file_name = entry.file_name().to_string_lossy().into_owned();
            let identity = file_name.to_lowercase();
            let relative_path = path
                .strip_prefix(&root)
                .unwrap_or(&path)
                .to_string_lossy()
                .into_owned();

            if !executables_by_name.contains_key(&identity)
                && executables_by_name.len() >= max_results
            {
                return Err(ScanError::ResultLimitExceeded { limit: max_results });
            }

            let candidate = ScannedExecutable {
                rule: escape_legacy_cpp_regex(&file_name),
                file_name,
                relative_path,
            };

            // Legacy rules match filenames, so duplicates add no routing value.
            // Keep the lexicographically first path to make the review output
            // stable even when the filesystem enumerates entries differently.
            executables_by_name
                .entry(identity)
                .and_modify(|existing: &mut ScannedExecutable| {
                    if candidate.relative_path < existing.relative_path {
                        *existing = candidate.clone();
                    }
                })
                .or_insert(candidate);
        }
    }

    let mut executables = executables_by_name.into_values().collect::<Vec<_>>();
    executables.sort_by(|left, right| {
        left.file_name
            .to_lowercase()
            .cmp(&right.file_name.to_lowercase())
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });
    warnings.sort();

    Ok(ScanReport {
        root: root.to_string_lossy().into_owned(),
        executables,
        warnings,
        skipped_reparse_points,
    })
}

fn has_exe_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
}

fn escape_legacy_cpp_regex(value: &str) -> String {
    // Keep this list aligned with the upstream C# implementation. A hyphen is
    // not escaped because filenames are emitted outside a character class.
    const ESCAPED: &[char] = &[
        '\\', '*', '+', '?', '|', '{', '}', '[', ']', '(', ')', '^', '$', '.',
    ];

    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        if ESCAPED.contains(&character) {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

fn display_relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .ok()
        .filter(|relative| !relative.as_os_str().is_empty())
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned()
}

#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use tempfile::tempdir;

    #[test]
    fn escapes_rules_exactly_like_the_legacy_scanner() {
        assert_eq!(
            escape_legacy_cpp_regex(r"game (test)+[x].exe"),
            r"game \(test\)\+\[x\]\.exe"
        );
        assert_eq!(
            escape_legacy_cpp_regex("plain-name.exe"),
            r"plain-name\.exe"
        );
    }

    #[test]
    fn finds_nested_executables_case_insensitively_and_sorts_them() {
        let directory = tempdir().expect("temporary directory");
        let nested = directory.path().join("bin");
        fs::create_dir(&nested).expect("nested directory");
        File::create(directory.path().join("Zeta.EXE")).expect("uppercase executable");
        File::create(nested.join("alpha.exe")).expect("nested executable");
        File::create(nested.join("notes.txt")).expect("non-executable");

        let report = scan(directory.path(), 50).expect("successful scan");

        assert_eq!(
            report
                .executables
                .iter()
                .map(|item| item.file_name.as_str())
                .collect::<Vec<_>>(),
            vec!["alpha.exe", "Zeta.EXE"]
        );
        assert_eq!(report.executables[0].rule, r"alpha\.exe");
        assert!(report.executables[0].relative_path.ends_with("alpha.exe"));
    }

    #[test]
    fn removes_duplicate_filenames_because_legacy_rules_match_names() {
        let directory = tempdir().expect("temporary directory");
        let first = directory.path().join("one");
        let second = directory.path().join("two");
        fs::create_dir(&first).expect("first directory");
        fs::create_dir(&second).expect("second directory");
        File::create(first.join("game.exe")).expect("first executable");
        File::create(second.join("GAME.EXE")).expect("duplicate executable");

        let report = scan(directory.path(), 50).expect("successful scan");

        assert_eq!(report.executables.len(), 1);
        assert!(Path::new(&report.executables[0].relative_path).starts_with("one"));
    }

    #[test]
    fn fails_with_an_actionable_error_at_the_result_limit() {
        let directory = tempdir().expect("temporary directory");
        File::create(directory.path().join("one.exe")).expect("first executable");
        File::create(directory.path().join("two.exe")).expect("second executable");

        let error = scan(directory.path(), 1).expect_err("limit error");

        assert!(matches!(error, ScanError::ResultLimitExceeded { limit: 1 }));
    }

    #[test]
    fn rejects_a_file_as_the_scan_root() {
        let directory = tempdir().expect("temporary directory");
        let file = directory.path().join("game.exe");
        File::create(&file).expect("executable");

        let error = scan(&file, 50).expect_err("invalid root");

        assert!(matches!(error, ScanError::InvalidRoot(_)));
    }
}
