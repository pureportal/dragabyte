use super::{send_remote_error, send_remote_event};
use crate::disk::compute_disk_usage;
use base64::prelude::*;
use serde::Serialize;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteListEntry {
    name: String,
    path: String,
    is_dir: bool,
}

pub(super) fn handle_remote_disk(sender: &super::Client, id: Option<String>, path: String) {
    let target = PathBuf::from(&path);
    match compute_disk_usage(&target) {
        Ok(snapshot) => {
            send_remote_event(
                sender,
                serde_json::json!({ "event": "disk-info", "id": id, "data": snapshot }),
            );
        }
        Err(message) => {
            send_remote_event(
                sender,
                serde_json::json!({ "event": "disk-error", "id": id, "message": message }),
            );
        }
    }
}

pub(super) fn handle_remote_read(sender: &super::Client, id: Option<String>, path: String) {
    let target = PathBuf::from(&path);
    if !target.exists() {
        send_remote_error(sender, id.as_deref(), "path-not-found");
        return;
    }
    if !target.is_file() {
        send_remote_error(sender, id.as_deref(), "not-a-file");
        return;
    }
    match fs::metadata(&target) {
        Ok(meta) => {
            if meta.len() > 5 * 1024 * 1024 {
                send_remote_error(sender, id.as_deref(), "file-too-large");
                return;
            }
        }
        Err(e) => {
            send_remote_error(sender, id.as_deref(), &e.to_string());
            return;
        }
    }
    let content = fs::File::open(&target).and_then(|file| {
        let mut bytes = Vec::new();
        file.take(5 * 1024 * 1024 + 1).read_to_end(&mut bytes)?;
        Ok(bytes)
    });
    match content {
        Ok(bytes) if bytes.len() > 5 * 1024 * 1024 => {
            send_remote_error(sender, id.as_deref(), "file-too-large");
        }
        Ok(bytes) => {
            let data = BASE64_STANDARD.encode(&bytes);
            send_remote_event(
                sender,
                serde_json::json!({ "event": "read-complete", "id": id, "data": { "path": path, "content": data } }),
            );
        }
        Err(e) => {
            send_remote_error(sender, id.as_deref(), &e.to_string());
        }
    }
}

pub(super) fn handle_remote_list(sender: &super::Client, id: Option<String>, path: Option<String>) {
    let target = resolve_list_target(path.as_deref());
    let (entries, list_path) = match target {
        Ok(value) => value,
        Err(message) => {
            send_remote_event(
                sender,
                serde_json::json!({ "event": "list-error", "id": id, "message": message }),
            );
            return;
        }
    };
    let payload = serde_json::json!({
      "event": "list-complete",
      "id": id,
      "data": {
        "path": list_path,
        "entries": entries,
        "os": if cfg!(target_os = "windows") { "windows" } else { "unix" }
      }
    });
    send_remote_event(sender, payload);
}

fn resolve_list_target(
    path: Option<&str>,
) -> Result<(Vec<RemoteListEntry>, Option<String>), String> {
    let trimmed = path.unwrap_or("").trim();
    if trimmed.is_empty() {
        #[cfg(target_os = "windows")]
        {
            return Ok((list_windows_drives(), None));
        }
        #[cfg(not(target_os = "windows"))]
        {
            let root = PathBuf::from("/");
            let entries = list_directory_entries(&root)?;
            return Ok((entries, Some("/".to_string())));
        }
    }
    #[cfg(target_os = "windows")]
    {
        if trimmed == "/" || trimmed == "\\" {
            return Ok((list_windows_drives(), None));
        }
    }
    let target = PathBuf::from(trimmed);
    if !target.exists() {
        return Err("path-not-found".to_string());
    }
    let entries = list_directory_entries(&target)?;
    Ok((entries, Some(trimmed.to_string())))
}

fn list_directory_entries(path: &Path) -> Result<Vec<RemoteListEntry>, String> {
    let mut entries: Vec<RemoteListEntry> = Vec::new();
    let read_dir = fs::read_dir(path).map_err(|error| format!("list-failed: {error}"))?;
    for entry in read_dir {
        let entry = entry.map_err(|error| format!("list-failed: {error}"))?;
        let entry_path = entry.path();
        let is_dir = entry
            .file_type()
            .map_err(|error| format!("list-failed: {error}"))?
            .is_dir();
        if !is_dir {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let path_str = entry_path.to_string_lossy().to_string();
        entries.push(RemoteListEntry {
            name,
            path: path_str,
            is_dir,
        });
    }
    entries.sort_by_key(|entry| entry.name.to_lowercase());
    Ok(entries)
}

#[cfg(target_os = "windows")]
fn list_windows_drives() -> Vec<RemoteListEntry> {
    let mut entries = Vec::new();
    for letter in b'A'..=b'Z' {
        let drive = format!("{}:\\", letter as char);
        let path = Path::new(&drive);
        if !path.exists() {
            continue;
        }
        entries.push(RemoteListEntry {
            name: drive.clone(),
            path: drive,
            is_dir: true,
        });
    }
    entries
}
