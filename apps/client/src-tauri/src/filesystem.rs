use std::path::Path;

pub fn path_string(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(unc) = value.strip_prefix("\\\\?\\UNC\\") {
        return format!("\\\\{unc}");
    }
    value.strip_prefix("\\\\?\\").unwrap_or(&value).to_string()
}

#[cfg(feature = "desktop")]
#[derive(Clone, serde::Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum FilesystemChange {
    Delete { path: String },
    Relocate { path: String, new_path: String },
    Create { path: String },
    Copy { path: String, new_path: String },
    Refresh { path: String },
}

#[cfg(feature = "desktop")]
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesystemChangeEvent {
    pub source_window: String,
    pub change: FilesystemChange,
}

#[cfg(feature = "desktop")]
pub fn emit_filesystem_change(window: &tauri::Window, change: FilesystemChange) {
    use tauri::{Emitter, Manager};
    if let Err(error) = window.app_handle().emit(
        "filesystem-changed",
        FilesystemChangeEvent {
            source_window: window.label().to_string(),
            change,
        },
    ) {
        eprintln!("Failed to update other windows after a filesystem change: {error}");
    }
}
