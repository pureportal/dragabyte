use std::path::Path;

use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsageSnapshot {
    pub path: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
}

pub fn compute_disk_usage(path: &Path) -> Result<DiskUsageSnapshot, String> {
    let total_bytes =
        fs2::total_space(path).map_err(|error| format!("disk-usage-failed: {error}"))?;
    let free_bytes =
        fs2::available_space(path).map_err(|error| format!("disk-usage-failed: {error}"))?;
    Ok(DiskUsageSnapshot {
        path: path.to_string_lossy().into_owned(),
        total_bytes,
        free_bytes,
    })
}
