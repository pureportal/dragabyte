use super::{get_entry_name_string, options::ScanFilters};
use regex::Regex;
use std::{collections::HashSet, path::Path};

pub(super) struct FilterConfig {
    include_extensions: HashSet<String>,
    exclude_extensions: HashSet<String>,
    include_names: Vec<String>,
    exclude_names: Vec<String>,
    min_size_bytes: Option<u64>,
    max_size_bytes: Option<u64>,
    min_modified_timestamp: Option<u64>,
    max_modified_timestamp: Option<u64>,
    include_regex: Option<Regex>,
    exclude_regex: Option<Regex>,
    include_paths: Vec<String>,
    exclude_paths: Vec<String>,
    flags: FilterFlags,
}

struct FilterFlags {
    has_includes: bool,
    has_file_excludes: bool,
    has_dir_excludes: bool,
    needs_path: bool,
    needs_name: bool,
    needs_extension: bool,
}

pub(super) fn build_filter_config(filters: &ScanFilters) -> Result<FilterConfig, String> {
    if let (Some(min), Some(max)) = (filters.min_size_bytes, filters.max_size_bytes) {
        if min > max {
            return Err("Min size cannot exceed max size".to_string());
        }
    }
    if let (Some(min), Some(max)) = (
        filters.min_modified_timestamp,
        filters.max_modified_timestamp,
    ) {
        if min > max {
            return Err("Min modified timestamp cannot exceed max modified timestamp".to_string());
        }
    }
    let include_regex = match &filters.include_regex {
        Some(pattern) => Some(Regex::new(pattern).map_err(|err| err.to_string())?),
        None => None,
    };
    let exclude_regex = match &filters.exclude_regex {
        Some(pattern) => Some(Regex::new(pattern).map_err(|err| err.to_string())?),
        None => None,
    };
    let include_extensions = normalize_extensions(&filters.include_extensions);
    let exclude_extensions = normalize_extensions(&filters.exclude_extensions);
    let include_names = normalize_list(&filters.include_names);
    let exclude_names = normalize_list(&filters.exclude_names);
    let include_paths = normalize_list(&filters.include_paths);
    let exclude_paths = normalize_list(&filters.exclude_paths);
    let has_include_extensions = !include_extensions.is_empty();
    let has_exclude_extensions = !exclude_extensions.is_empty();
    let has_include_names = !include_names.is_empty();
    let has_exclude_names = !exclude_names.is_empty();
    let has_include_paths = !include_paths.is_empty();
    let has_exclude_paths = !exclude_paths.is_empty();
    let has_include_regex = include_regex.is_some();
    let has_exclude_regex = exclude_regex.is_some();
    let has_includes =
        has_include_extensions || has_include_names || has_include_paths || has_include_regex;
    let has_dir_excludes = has_exclude_paths || has_exclude_names || has_exclude_regex;
    let has_file_excludes = has_dir_excludes || has_exclude_extensions;
    let needs_path =
        has_exclude_paths || has_include_paths || has_include_regex || has_exclude_regex;
    let needs_name = has_exclude_names || has_include_names;
    let needs_extension = has_include_extensions || has_exclude_extensions;
    Ok(FilterConfig {
        include_extensions,
        exclude_extensions,
        include_names,
        exclude_names,
        min_size_bytes: filters.min_size_bytes,
        max_size_bytes: filters.max_size_bytes,
        min_modified_timestamp: filters.min_modified_timestamp,
        max_modified_timestamp: filters.max_modified_timestamp,
        include_regex,
        exclude_regex,
        include_paths,
        exclude_paths,
        flags: FilterFlags {
            has_includes,
            has_file_excludes,
            has_dir_excludes,
            needs_path,
            needs_name,
            needs_extension,
        },
    })
}

fn normalize_extensions(values: &[String]) -> HashSet<String> {
    let mut set = HashSet::new();
    for value in values {
        let cleaned = value.trim().trim_start_matches('.').to_lowercase();
        if !cleaned.is_empty() {
            set.insert(cleaned);
        }
    }
    set
}

fn normalize_list(values: &[String]) -> Vec<String> {
    let mut list = Vec::new();
    for value in values {
        let cleaned = value.trim().to_lowercase();
        if !cleaned.is_empty() {
            list.push(cleaned);
        }
    }
    list
}

pub(super) fn should_skip_dir(root: &Path, path: &Path, filters: &FilterConfig) -> bool {
    if path == root {
        return false;
    }
    if !filters.flags.has_dir_excludes {
        return false;
    }
    let path_str = if filters.flags.needs_path {
        Some(path.to_string_lossy().to_lowercase())
    } else {
        None
    };
    let name_str = if filters.flags.needs_name {
        Some(get_entry_name_string(path).to_lowercase())
    } else {
        None
    };
    if let Some(path_value) = path_str.as_deref() {
        if matches_regex(path_value, &filters.exclude_regex) {
            return true;
        }
        if path_contains_any(path_value, &filters.exclude_paths) {
            return true;
        }
    }
    if let Some(name_value) = name_str.as_deref() {
        return path_contains_any(name_value, &filters.exclude_names);
    }
    false
}

pub(super) fn should_include_file(
    path: &Path,
    size_bytes: u64,
    modified: Option<u64>,
    filters: &FilterConfig,
) -> bool {
    if let Some(min_size) = filters.min_size_bytes {
        if size_bytes < min_size {
            return false;
        }
    }
    if let Some(max_size) = filters.max_size_bytes {
        if size_bytes > max_size {
            return false;
        }
    }
    if let Some(min_ts) = filters.min_modified_timestamp {
        if modified.is_some_and(|ts| ts < min_ts) {
            return false;
        }
    }
    if let Some(max_ts) = filters.max_modified_timestamp {
        if modified.is_some_and(|ts| ts > max_ts) {
            return false;
        }
    }
    let path_str = if filters.flags.needs_path {
        Some(path.to_string_lossy().to_lowercase())
    } else {
        None
    };
    let name_str = if filters.flags.needs_name {
        Some(get_entry_name_string(path).to_lowercase())
    } else {
        None
    };
    let ext = if filters.flags.needs_extension {
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_lowercase())
    } else {
        None
    };
    if filters.flags.has_file_excludes {
        if let Some(path_value) = path_str.as_deref() {
            if matches_regex(path_value, &filters.exclude_regex) {
                return false;
            }
            if path_contains_any(path_value, &filters.exclude_paths) {
                return false;
            }
        }
        if let Some(name_value) = name_str.as_deref() {
            if path_contains_any(name_value, &filters.exclude_names) {
                return false;
            }
        }
        if let Some(ext_value) = ext.as_ref() {
            if filters.exclude_extensions.contains(ext_value) {
                return false;
            }
        }
    }

    if !filters.flags.has_includes {
        return true;
    }

    if let Some(path_value) = path_str.as_deref() {
        if matches_regex(path_value, &filters.include_regex) {
            return true;
        }
        if path_contains_any(path_value, &filters.include_paths) {
            return true;
        }
    }
    if let Some(name_value) = name_str.as_deref() {
        if path_contains_any(name_value, &filters.include_names) {
            return true;
        }
    }
    if let Some(ext_value) = ext.as_ref() {
        return filters.include_extensions.contains(ext_value);
    }

    false
}

fn matches_regex(value: &str, regex: &Option<Regex>) -> bool {
    regex
        .as_ref()
        .is_some_and(|pattern| pattern.is_match(value))
}

fn path_contains_any(path: &str, values: &[String]) -> bool {
    for value in values {
        if value.is_empty() {
            continue;
        }
        if path.contains(value) {
            return true;
        }
    }
    false
}
