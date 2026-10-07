use super::types::EmptyFolderOptions;
use regex::{Regex, RegexBuilder};
use std::fs::Metadata;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub(super) struct FolderFilters {
    include_names: Vec<String>,
    exclude_names: Vec<String>,
    include_paths: Vec<String>,
    exclude_paths: Vec<String>,
    include_regex: Option<Regex>,
    exclude_regex: Option<Regex>,
    now: f64,
}

fn normalized(values: &[String], match_case: bool) -> Vec<String> {
    values
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| {
            if match_case {
                value.to_string()
            } else {
                value.to_lowercase()
            }
        })
        .collect()
}

impl FolderFilters {
    pub fn new(options: &EmptyFolderOptions) -> Result<Self, String> {
        if options.min_depth == 0
            || options.min_depth > 1000
            || options
                .max_depth
                .is_some_and(|max| max > 1000 || max < options.min_depth)
        {
            return Err("Use depths from 1 to 1000, with maximum at least minimum.".into());
        }
        for value in [options.min_age_days, options.max_age_days]
            .into_iter()
            .flatten()
        {
            if !value.is_finite() || value < 0.0 {
                return Err("Folder ages must be nonnegative numbers.".into());
            }
        }
        if matches!((options.min_age_days, options.max_age_days), (Some(min), Some(max)) if min > max)
        {
            return Err("Maximum age must be at least the minimum age.".into());
        }
        let compile = |pattern: &str, label: &str| -> Result<Option<Regex>, String> {
            if pattern.is_empty() {
                return Ok(None);
            }
            RegexBuilder::new(pattern)
                .case_insensitive(!options.match_case)
                .build()
                .map(Some)
                .map_err(|error| format!("Invalid {label} regex: {error}"))
        };
        Ok(Self {
            include_names: normalized(&options.include_names, options.match_case),
            exclude_names: normalized(&options.exclude_names, options.match_case),
            include_paths: normalized(&options.include_paths, options.match_case),
            exclude_paths: normalized(&options.exclude_paths, options.match_case),
            include_regex: compile(&options.include_regex, "include")?,
            exclude_regex: compile(&options.exclude_regex, "exclude")?,
            now: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|error| error.to_string())?
                .as_secs_f64(),
        })
    }

    pub fn excluded(&self, name: &str, relative: &str, options: &EmptyFolderOptions) -> bool {
        let normalized_name = if options.match_case {
            name.to_string()
        } else {
            name.to_lowercase()
        };
        let normalized_path = if options.match_case {
            relative.to_string()
        } else {
            relative.to_lowercase()
        };
        self.exclude_names
            .iter()
            .any(|value| normalized_name.contains(value))
            || self
                .exclude_paths
                .iter()
                .any(|value| normalized_path.contains(value))
            || self.exclude_regex.as_ref().is_some_and(|regex| {
                regex.is_match(if options.regex_match_path {
                    relative
                } else {
                    name
                })
            })
    }

    pub fn included(
        &self,
        name: &str,
        relative: &str,
        modified: Option<u64>,
        options: &EmptyFolderOptions,
    ) -> bool {
        if options.min_age_days.is_some() || options.max_age_days.is_some() {
            let Some(modified) = modified else {
                return false;
            };
            let age = (self.now - modified as f64).max(0.0) / 86_400.0;
            if options.min_age_days.is_some_and(|min| age < min)
                || options.max_age_days.is_some_and(|max| age > max)
            {
                return false;
            }
        }
        let normalized_name = if options.match_case {
            name.to_string()
        } else {
            name.to_lowercase()
        };
        let normalized_path = if options.match_case {
            relative.to_string()
        } else {
            relative.to_lowercase()
        };
        (self.include_names.is_empty()
            || self
                .include_names
                .iter()
                .any(|value| normalized_name.contains(value)))
            && (self.include_paths.is_empty()
                || self
                    .include_paths
                    .iter()
                    .any(|value| normalized_path.contains(value)))
            && self.include_regex.as_ref().is_none_or(|regex| {
                regex.is_match(if options.regex_match_path {
                    relative
                } else {
                    name
                })
            })
    }
}

pub(super) fn is_link(metadata: &Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    false
}

pub(super) fn is_hidden(path: &Path, metadata: &Metadata) -> bool {
    if path
        .file_name()
        .is_some_and(|name| name.to_string_lossy().starts_with('.'))
    {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x6 != 0 {
            return true;
        }
    }
    let _ = metadata;
    false
}
