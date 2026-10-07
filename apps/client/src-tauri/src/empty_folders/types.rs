use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmptyFolderOptions {
    pub min_depth: usize,
    pub max_depth: Option<usize>,
    pub include_hidden: bool,
    pub empty_after_removal: bool,
    pub include_names: Vec<String>,
    pub exclude_names: Vec<String>,
    pub include_paths: Vec<String>,
    pub exclude_paths: Vec<String>,
    pub include_regex: String,
    pub exclude_regex: String,
    pub regex_match_path: bool,
    pub match_case: bool,
    pub min_age_days: Option<f64>,
    pub max_age_days: Option<f64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmptyFolder {
    pub path: String,
    pub source: String,
    pub name: String,
    pub relative_path: String,
    pub depth: usize,
    pub modified: Option<u64>,
    pub children: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderError {
    pub path: String,
    pub message: String,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmptyFolderPreview {
    pub folders: Vec<EmptyFolder>,
    pub errors: Vec<FolderError>,
    pub inspected: usize,
    pub cancelled: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovalOutcome {
    pub path: String,
    pub error: Option<String>,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovalResult {
    pub outcomes: Vec<RemovalOutcome>,
    pub cancelled: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderProgress {
    pub id: String,
    pub processed: usize,
    pub total: Option<usize>,
    pub found: usize,
    pub path: String,
}
