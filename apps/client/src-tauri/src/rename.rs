use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOptions {
    pub contents: bool,
    pub include_files: bool,
    pub include_folders: bool,
    pub min_depth: usize,
    pub max_depth: Option<usize>,
    pub pattern: String,
    pub match_path: bool,
    pub match_case: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItem {
    pub path: String,
    pub name: String,
    pub is_directory: bool,
    pub size: u64,
    pub depth: usize,
    pub relative_path: String,
}

fn path_string(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(unc) = value.strip_prefix("\\\\?\\UNC\\") {
        return format!("\\\\{unc}");
    }
    value.strip_prefix("\\\\?\\").unwrap_or(&value).to_string()
}

pub fn collect_items(
    paths: Vec<String>,
    options: ImportOptions,
) -> Result<Vec<ImportItem>, String> {
    if options.max_depth.is_some_and(|max| max < options.min_depth) {
        return Err("Maximum depth must be at least the minimum depth.".into());
    }
    if !options.include_files && !options.include_folders {
        return Err("Choose files, folders, or both.".into());
    }
    let pattern = if options.pattern.is_empty() {
        None
    } else {
        Some(
            RegexBuilder::new(&options.pattern)
                .case_insensitive(!options.match_case)
                .build()
                .map_err(|error| format!("Invalid regex: {error}"))?,
        )
    };
    let mut items = Vec::new();
    let mut seen = HashSet::new();
    for raw in paths {
        let root = fs::canonicalize(raw.trim().trim_matches('"'))
            .map_err(|error| format!("Cannot open {raw}: {error}"))?;
        let mut pending = vec![(root.clone(), 0)];
        while let Some((path, depth)) = pending.pop() {
            let metadata = fs::symlink_metadata(&path)
                .map_err(|error| format!("Cannot read {}: {error}", path_string(&path)))?;
            if metadata.file_type().is_symlink() || (!metadata.is_dir() && !metadata.is_file()) {
                continue;
            }
            let is_directory = metadata.is_dir();
            let name = path
                .file_name()
                .unwrap_or(path.as_os_str())
                .to_string_lossy()
                .to_string();
            let relative_path = if depth == 0 {
                name.clone()
            } else {
                path.strip_prefix(&root)
                    .map_err(|error| error.to_string())?
                    .to_string_lossy()
                    .replace('\\', "/")
            };
            let matches = pattern.as_ref().is_none_or(|regex| {
                regex.is_match(if options.match_path {
                    &relative_path
                } else {
                    &name
                })
            });
            let item_path = path_string(&path);
            let identity = if cfg!(windows) {
                item_path.to_lowercase()
            } else {
                item_path.clone()
            };
            if (depth >= options.min_depth || depth == 0 && !is_directory)
                && (is_directory && options.include_folders
                    || !is_directory && options.include_files)
                && matches
                && seen.insert(identity)
            {
                items.push(ImportItem {
                    path: item_path,
                    name,
                    is_directory,
                    size: if is_directory { 0 } else { metadata.len() },
                    depth,
                    relative_path,
                });
            }
            if is_directory && options.contents && options.max_depth.is_none_or(|max| depth < max) {
                let entries = fs::read_dir(&path)
                    .map_err(|error| format!("Cannot read {}: {error}", path_string(&path)))?;
                for entry in entries {
                    let entry = entry.map_err(|error| error.to_string())?;
                    pending.push((entry.path(), depth + 1));
                }
            }
        }
    }
    items.sort_by(|a, b| {
        a.path
            .to_lowercase()
            .cmp(&b.path.to_lowercase())
            .then_with(|| a.path.cmp(&b.path))
    });
    Ok(items)
}

#[derive(Clone, Deserialize)]
pub struct BatchRenameItem {
    pub path: String,
    pub new_path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameOutcome {
    pub path: String,
    pub new_path: String,
    pub error: Option<String>,
}

fn rename_one(item: &BatchRenameItem) -> Result<(), String> {
    let source = Path::new(&item.path);
    let destination = Path::new(&item.new_path);
    let name = destination
        .file_name()
        .ok_or("Enter a file or folder name.")?
        .to_string_lossy();
    if name.is_empty()
        || name.contains(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])
        || name.chars().any(char::is_control)
        || name.ends_with(['.', ' '])
    {
        return Err("Use a name without reserved characters or trailing dots and spaces.".into());
    }
    let stem = name.split('.').next().unwrap_or_default().to_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && matches!(stem.as_bytes()[3], b'1'..=b'9')
    {
        return Err("Choose a name that is not reserved by the operating system.".into());
    }
    if source.parent() != destination.parent() {
        return Err("Rename must keep the item in its folder.".into());
    }
    let actual_source = fs::canonicalize(source).map_err(|error| error.to_string())?;
    if destination.exists() {
        let actual_destination =
            fs::canonicalize(destination).map_err(|error| error.to_string())?;
        let same = if cfg!(windows) {
            actual_source.to_string_lossy().to_lowercase()
                == actual_destination.to_string_lossy().to_lowercase()
        } else {
            actual_source == actual_destination
        };
        if !same {
            return Err(format!("A file or folder named {name} already exists."));
        }
    }
    fs::rename(source, destination).map_err(|error| error.to_string())
}

pub fn rename_batch(mut items: Vec<BatchRenameItem>) -> Vec<RenameOutcome> {
    items.sort_by_key(|item| std::cmp::Reverse(Path::new(&item.path).components().count()));
    let mut outcomes: Vec<RenameOutcome> = Vec::new();
    let mut seen = HashSet::new();
    for item in items {
        let error = if !seen.insert(item.path.clone()) {
            Some("Item appears more than once.".into())
        } else {
            rename_one(&item).err()
        };
        if error.is_none() {
            for previous in &mut outcomes {
                if let Ok(relative) = Path::new(&previous.new_path).strip_prefix(&item.path) {
                    previous.new_path = path_string(&PathBuf::from(&item.new_path).join(relative));
                }
            }
        }
        outcomes.push(RenameOutcome {
            path: item.path,
            new_path: item.new_path,
            error,
        });
    }
    outcomes
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> ImportOptions {
        ImportOptions {
            contents: true,
            include_files: true,
            include_folders: true,
            min_depth: 1,
            max_depth: None,
            pattern: String::new(),
            match_path: false,
            match_case: false,
        }
    }

    #[test]
    fn imports_only_folders_at_exact_depth_without_pruning_nonmatching_parents() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("parent/album/deeper")).unwrap();
        fs::write(root.path().join("parent/album/photo.jpg"), "image").unwrap();
        let configured = ImportOptions {
            include_files: false,
            min_depth: 2,
            max_depth: Some(2),
            pattern: "^album$".into(),
            ..options()
        };
        let items = collect_items(vec![path_string(root.path())], configured).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "album");
        assert_eq!(items[0].depth, 2);
        assert_eq!(items[0].relative_path, "parent/album");
    }

    #[test]
    fn imports_roots_files_nested_contents_and_deduplicates_overlapping_sources() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("child")).unwrap();
        fs::write(root.path().join("child/a.txt"), "abc").unwrap();
        let roots = vec![
            path_string(root.path()),
            path_string(&root.path().join("child")),
        ];
        let items = collect_items(
            roots,
            ImportOptions {
                min_depth: 0,
                ..options()
            },
        )
        .unwrap();
        assert_eq!(items.len(), 3);
        assert_eq!(
            items.iter().find(|item| item.name == "a.txt").unwrap().size,
            3
        );
        let items = collect_items(
            vec![path_string(&root.path().join("child/a.txt"))],
            ImportOptions {
                contents: false,
                min_depth: 0,
                ..options()
            },
        )
        .unwrap();
        assert_eq!(items.len(), 1);
        let items = collect_items(
            vec![path_string(root.path())],
            ImportOptions {
                max_depth: Some(1),
                ..options()
            },
        )
        .unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "child");
    }

    #[test]
    fn reports_invalid_regex_depth_and_missing_source() {
        assert!(collect_items(
            vec![],
            ImportOptions {
                pattern: "[".into(),
                ..options()
            }
        )
        .is_err());
        assert!(collect_items(
            vec![],
            ImportOptions {
                min_depth: 3,
                max_depth: Some(2),
                ..options()
            }
        )
        .is_err());
        assert!(collect_items(vec!["missing-rename-source".into()], options()).is_err());
    }

    #[test]
    fn renames_children_before_parents_and_reports_final_paths() {
        let root = tempfile::tempdir().unwrap();
        let parent = root.path().join("old");
        fs::create_dir(&parent).unwrap();
        fs::write(parent.join("a.txt"), "a").unwrap();
        let outcomes = rename_batch(vec![
            BatchRenameItem {
                path: path_string(&parent),
                new_path: path_string(&root.path().join("new")),
            },
            BatchRenameItem {
                path: path_string(&parent.join("a.txt")),
                new_path: path_string(&parent.join("b.txt")),
            },
        ]);
        assert!(outcomes.iter().all(|outcome| outcome.error.is_none()));
        assert!(root.path().join("new/b.txt").exists());
        assert_eq!(
            outcomes[0].new_path,
            path_string(&root.path().join("new").join("b.txt"))
        );
    }

    #[test]
    fn collisions_and_invalid_names_do_not_overwrite_files_or_report_success() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("a.txt"), "a").unwrap();
        fs::write(root.path().join("b.txt"), "b").unwrap();
        let outcomes = rename_batch(vec![BatchRenameItem {
            path: path_string(&root.path().join("a.txt")),
            new_path: path_string(&root.path().join("b.txt")),
        }]);
        assert!(outcomes[0].error.is_some());
        assert_eq!(fs::read_to_string(root.path().join("b.txt")).unwrap(), "b");
        let outcomes = rename_batch(vec![BatchRenameItem {
            path: path_string(&root.path().join("a.txt")),
            new_path: path_string(&root.path().join("CON.txt")),
        }]);
        assert!(outcomes[0].error.is_some());
    }
}
