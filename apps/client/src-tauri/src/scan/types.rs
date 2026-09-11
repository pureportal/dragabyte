use serde::Serialize;
use std::sync::Arc;

#[derive(Clone)]
pub enum ScanEvent {
    Progress(ScanUpdate),
    Complete(ScanUpdate),
    Cancelled(ScanUpdate),
    Error(ScanFailure),
}

pub type ScanEmitter = Arc<dyn Fn(ScanEvent) + Send + Sync>;

#[derive(Clone, Serialize)]
pub struct ScanFailure {
    pub id: Option<String>,
    pub message: String,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ScanState {
    Scanning,
    Complete,
    Incomplete,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanFolder {
    pub id: usize,
    pub parent_id: Option<usize>,
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
    pub file_count: u64,
    pub dir_count: u64,
    pub state: ScanState,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanFile {
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
    pub modified: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredFile {
    pub parent_id: usize,
    pub file: ScanFile,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanUpdate {
    pub id: Option<String>,
    pub sequence: u64,
    pub folders: Vec<ScanFolder>,
    pub files: Vec<DiscoveredFile>,
    pub total_bytes: u64,
    pub file_count: u64,
    pub dir_count: u64,
    pub skipped_entries: u64,
    pub largest_files: Vec<ScanFile>,
    pub duration_ms: u128,
}
