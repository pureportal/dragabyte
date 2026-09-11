use serde::Deserialize;

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScanPriorityMode {
    Performance,
    #[default]
    Balanced,
    Low,
}

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScanThrottleLevel {
    #[default]
    Off,
    Low,
    Medium,
    High,
}

#[derive(Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ScanFilters {
    pub include_extensions: Vec<String>,
    pub exclude_extensions: Vec<String>,
    pub include_names: Vec<String>,
    pub exclude_names: Vec<String>,
    pub min_size_bytes: Option<u64>,
    pub max_size_bytes: Option<u64>,
    pub min_modified_timestamp: Option<u64>,
    pub max_modified_timestamp: Option<u64>,
    pub include_regex: Option<String>,
    pub exclude_regex: Option<String>,
    pub include_paths: Vec<String>,
    pub exclude_paths: Vec<String>,
}

#[derive(Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ScanOptions {
    pub priority_mode: ScanPriorityMode,
    pub throttle_level: ScanThrottleLevel,
    pub filters: ScanFilters,
}
