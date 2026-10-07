mod filters;
mod types;

#[cfg(feature = "desktop")]
pub mod commands;
#[cfg(test)]
mod tests;

use crate::filesystem::path_string;
use filters::{is_hidden, is_link, FolderFilters};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::UNIX_EPOCH;
pub use types::*;

fn checked_directory(path: &Path) -> Result<PathBuf, String> {
    for ancestor in path.ancestors() {
        if ancestor.as_os_str().is_empty() {
            continue;
        }
        let metadata = fs::symlink_metadata(ancestor).map_err(|error| error.to_string())?;
        if is_link(&metadata) || !metadata.is_dir() {
            return Err(
                "The path contains a link or is no longer a folder. Find folders again.".into(),
            );
        }
    }
    fs::canonicalize(path).map_err(|error| error.to_string())
}

struct PendingFolder {
    path: PathBuf,
    source: PathBuf,
    depth: usize,
    children: Option<Vec<PathBuf>>,
}

pub fn find_empty_folders(
    paths: Vec<String>,
    options: &EmptyFolderOptions,
    cancel: &AtomicBool,
    mut progress: impl FnMut(usize, usize, &str),
) -> Result<EmptyFolderPreview, String> {
    let filters = FolderFilters::new(options)?;
    if paths.is_empty() {
        return Err("Choose at least one source folder.".into());
    }
    let mut result = EmptyFolderPreview::default();
    let mut roots = HashSet::new();
    for raw in paths {
        if cancel.load(Ordering::Relaxed) {
            result.cancelled = true;
            return Ok(result);
        }
        match checked_directory(Path::new(raw.trim().trim_matches('"'))) {
            Ok(path) => {
                roots.insert(path);
            }
            Err(message) => result.errors.push(FolderError { path: raw, message }),
        }
    }
    let mut sources: Vec<_> = roots.iter().cloned().collect();
    sources.sort();
    let mut removable = HashSet::new();
    let mut seen_folders = HashSet::new();
    let mut pending: Vec<_> = sources
        .into_iter()
        .map(|path| PendingFolder {
            source: path.clone(),
            path,
            depth: 0,
            children: None,
        })
        .collect();
    while let Some(folder) = pending.pop() {
        if cancel.load(Ordering::Relaxed) {
            result.cancelled = true;
            break;
        }
        if folder.depth == 0 {
            removable.clear();
        }
        let path = &folder.path;
        let metadata = match fs::symlink_metadata(path) {
            Ok(value) if value.is_dir() && !is_link(&value) => value,
            Ok(_) => continue,
            Err(error) => {
                result.errors.push(FolderError {
                    path: path_string(path),
                    message: error.to_string(),
                });
                continue;
            }
        };
        let name = path
            .file_name()
            .unwrap_or(path.as_os_str())
            .to_string_lossy()
            .to_string();
        let relative = path
            .strip_prefix(&folder.source)
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        if folder.depth > 0
            && ((!options.include_hidden && is_hidden(path, &metadata))
                || filters.excluded(&name, &relative, options))
        {
            continue;
        }
        if let Some(children) = folder.children {
            let modified = metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map(|value| value.as_secs());
            if !roots.contains(path)
                && folder.depth >= options.min_depth
                && filters.included(&name, &relative, modified, options)
                && children.iter().all(|child| removable.contains(child))
                && (options.empty_after_removal || children.is_empty())
            {
                removable.insert(path.clone());
                if seen_folders.insert(path.clone()) {
                    result.folders.push(EmptyFolder {
                        path: path_string(path),
                        source: path_string(&folder.source),
                        name,
                        relative_path: relative,
                        depth: folder.depth,
                        modified,
                        children: children.iter().map(|path| path_string(path)).collect(),
                    });
                }
            }
            progress(result.inspected, result.folders.len(), &path_string(path));
            continue;
        }
        result.inspected += 1;
        progress(result.inspected, result.folders.len(), &path_string(path));
        let entries = match fs::read_dir(path) {
            Ok(entries) => entries,
            Err(error) => {
                result.errors.push(FolderError {
                    path: path_string(path),
                    message: error.to_string(),
                });
                continue;
            }
        };
        let mut subfolders = Vec::new();
        let mut blocked = false;
        for entry in entries {
            if cancel.load(Ordering::Relaxed) {
                result.cancelled = true;
                break;
            }
            match entry {
                Ok(entry) => {
                    let child = entry.path();
                    match entry.file_type() {
                        Ok(kind) if kind.is_dir() => subfolders.push(child),
                        Ok(_) => blocked = true,
                        Err(error) => {
                            blocked = true;
                            result.errors.push(FolderError {
                                path: path_string(&child),
                                message: error.to_string(),
                            });
                        }
                    }
                }
                Err(error) => {
                    blocked = true;
                    result.errors.push(FolderError {
                        path: path_string(path),
                        message: error.to_string(),
                    });
                }
            }
        }
        if result.cancelled {
            break;
        }
        let depth = folder.depth;
        let source = folder.source.clone();
        if !blocked {
            pending.push(PendingFolder {
                children: Some(subfolders.clone()),
                ..folder
            });
        }
        if options.max_depth.is_none_or(|max| depth < max) {
            for path in subfolders {
                pending.push(PendingFolder {
                    path,
                    source: source.clone(),
                    depth: depth + 1,
                    children: None,
                });
            }
        }
    }
    result.folders.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(result)
}

pub fn remove_empty_folders(
    preview: &EmptyFolderPreview,
    selected: Vec<String>,
    cancel: &AtomicBool,
    mut progress: impl FnMut(usize, usize, &str),
) -> Result<RemovalResult, String> {
    if preview.cancelled {
        return Err("The search was cancelled. Find folders again before removing them.".into());
    }
    let approved: HashMap<_, _> = preview
        .folders
        .iter()
        .map(|folder| (folder.path.as_str(), folder))
        .collect();
    let mut paths: Vec<_> = selected
        .into_iter()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    if paths
        .iter()
        .any(|path| !approved.contains_key(path.as_str()))
    {
        return Err("The selection does not match the preview. Find folders again.".into());
    }
    paths.sort_by_key(|path| std::cmp::Reverse(Path::new(path).components().count()));
    let mut result = RemovalResult::default();
    for path in &paths {
        if cancel.load(Ordering::Relaxed) {
            result.cancelled = true;
            break;
        }
        let folder = approved[path.as_str()];
        let error = (|| -> Result<(), String> {
            let actual = checked_directory(Path::new(path))?;
            let root = checked_directory(Path::new(&folder.source))?;
            if path_string(&actual) != *path || actual == root || !actual.starts_with(&root) {
                return Err("The folder path changed. Find folders again.".into());
            }
            let mut entries = fs::read_dir(&actual).map_err(|error| error.to_string())?;
            if let Some(entry) = entries.next() {
                entry.map_err(|error| error.to_string())?;
                return Err(
                    "Folder is no longer empty. Keep its contents or find folders again.".into(),
                );
            }
            fs::remove_dir(&actual).map_err(|error| format!("Could not remove folder: {error}"))
        })()
        .err();
        result.outcomes.push(RemovalOutcome {
            path: path.clone(),
            error,
        });
        progress(result.outcomes.len(), paths.len(), path);
    }
    Ok(result)
}
