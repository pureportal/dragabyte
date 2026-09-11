#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use dragabyte::disk::{compute_disk_usage, DiskUsageSnapshot};
use dragabyte::remote::{start_remote_server, wire::LineReader, TcpConfig};
use dragabyte::scan::{
    build_scan_config, run_scan, ScanEmitter, ScanEvent, ScanFailure, ScanOptions,
};

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufReader, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime};

const MAX_LINE_LENGTH: usize = 10 * 1024 * 1024;
#[cfg(target_os = "windows")]
const LAUNCH_COALESCE_WINDOW_MS: u64 = 450;
#[cfg(target_os = "windows")]
const LAUNCH_COALESCE_STALE_MS: u128 = 5_000;

#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

use base64::prelude::*;
#[cfg(target_os = "windows")]
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_window_state::{StateFlags, WindowExt};

struct StartupPath(Mutex<Option<String>>);
struct LaunchContextState(Mutex<LaunchContext>);
struct ScanCancellation(Mutex<HashMap<String, Arc<AtomicBool>>>);
struct RemoteClientState(Mutex<Option<RemoteClientHandle>>);
struct SettingsState {
    path: PathBuf,
    value: Mutex<AppSettings>,
}

#[derive(Clone, Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct LaunchContext {
    path: Option<String>,
    paths: Vec<String>,
    mode: String,
}

#[cfg(target_os = "windows")]
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingLaunchContext {
    leader_pid: u32,
    updated_at_ms: u128,
    paths: Vec<String>,
}

struct RuntimeState {
    tcp_bind: Option<String>,
    tcp_enabled: bool,
}

struct RuntimeOptions {
    headless: bool,
    tcp: Option<TcpConfig>,
    startup_path: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    local_token: Option<String>,
    tcp_bind: Option<String>,
    headless: Option<bool>,
    auto_update: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettingsUpdate {
    local_token: Option<String>,
    tcp_bind: Option<String>,
    headless: Option<bool>,
    auto_update: Option<bool>,
}

#[derive(Deserialize)]
struct RemoteConnectPayload {
    host: String,
    port: u16,
    token: Option<String>,
}

#[derive(Deserialize)]
struct RemoteSendPayload {
    #[serde(default)]
    payload: JsonValue,
}

fn emit_to_window(window: &tauri::Window, event: ScanEvent) {
    match event {
        ScanEvent::Progress(summary) => {
            let _ = window.emit("scan-progress", summary);
        }
        ScanEvent::Complete(summary) => {
            let _ = window.emit("scan-complete", summary);
        }
        ScanEvent::Error(failure) => {
            let _ = window.emit("scan-error", failure);
        }
        ScanEvent::Cancelled(update) => {
            let _ = window.emit("scan-cancelled", update);
        }
    }
}

#[derive(Deserialize)]
struct BatchRenameItem {
    path: String,
    new_path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RenameContextItem {
    path: String,
    name: String,
    is_directory: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchRenameResult {
    success_count: u32,
    errors: Vec<String>,
}

#[tauri::command]
fn batch_rename(items: Vec<BatchRenameItem>) -> Result<BatchRenameResult, String> {
    let mut success_count = 0;
    let mut errors = Vec::new();

    for item in items {
        let source = PathBuf::from(&item.path);
        let dest = PathBuf::from(&item.new_path);

        if !source.exists() {
            errors.push(format!("Source does not exist: {}", item.path));
            continue;
        }

        // Safety check to prevent accidental overwrites
        if dest.exists() {
            // Check if it's a case-only rename (e.g. "a.txt" -> "A.TXT")
            let source_str = source.to_string_lossy().to_string();
            let dest_str = dest.to_string_lossy().to_string();

            // If paths are different but look the same in lowercase, it's likely a case rename.
            // On case-insensitive filesystems (Windows/macOS default), dest.exists() is true for case rename.
            // On case-sensitive (Linux), it is false unless a file named "A.TXT" actually exists.

            // If it is NOT a case-only rename, fail.
            if source_str != dest_str && source_str.to_lowercase() != dest_str.to_lowercase() {
                errors.push(format!("Destination already exists: {}", item.new_path));
                continue;
            }
        }

        match fs::rename(&source, &dest) {
            Ok(_) => success_count += 1,
            Err(e) => errors.push(format!("Failed to rename {}: {}", item.path, e)),
        }
    }

    Ok(BatchRenameResult {
        success_count,
        errors,
    })
}

#[tauri::command]
fn get_startup_path(state: tauri::State<StartupPath>) -> Option<String> {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn get_launch_context(state: tauri::State<LaunchContextState>) -> LaunchContext {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn collect_rename_items(
    paths: Vec<String>,
    recursive: bool,
) -> Result<Vec<RenameContextItem>, String> {
    let mut items = Vec::new();
    let mut seen = HashSet::new();

    for raw_path in paths {
        let Some(path) = normalize_context_path(&raw_path) else {
            continue;
        };
        collect_rename_items_from_path(Path::new(&path), recursive, &mut items, &mut seen)?;
    }

    items.sort_by(|left, right| {
        left.path
            .to_lowercase()
            .cmp(&right.path.to_lowercase())
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(items)
}

#[tauri::command]
fn scan_path(
    window: tauri::Window,
    path: String,
    options: ScanOptions,
    id: Option<String>,
    state: tauri::State<ScanCancellation>,
) -> Result<(), String> {
    let root = PathBuf::from(&path);
    let config = build_scan_config(&options)?;
    let label = window.label().to_string();
    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut cancellations = state
            .0
            .lock()
            .map_err(|_| "Failed to lock scan state".to_string())?;
        if let Some(existing) = cancellations.get(&label) {
            existing.store(true, Ordering::SeqCst);
        }
        cancellations.insert(label.clone(), Arc::clone(&cancel_flag));
    }
    let window_for_task = window.clone();
    let label_for_task = label.clone();
    let task_id = id.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let app_handle = window_for_task.app_handle();
        let emitter_window = window_for_task.clone();
        let emitter: ScanEmitter = Arc::new(move |event| emit_to_window(&emitter_window, event));
        if let Err(message) = run_scan(
            root,
            config,
            Arc::clone(&cancel_flag),
            emitter,
            task_id.clone(),
        ) {
            let _ = window_for_task.emit(
                "scan-error",
                ScanFailure {
                    id: task_id,
                    message,
                },
            );
        }
        let cancellations = app_handle.state::<ScanCancellation>();
        if let Ok(mut map) = cancellations.0.lock() {
            if map
                .get(&label_for_task)
                .is_some_and(|flag| Arc::ptr_eq(flag, &cancel_flag))
            {
                map.remove(&label_for_task);
            }
        };
    });

    Ok(())
}

#[tauri::command]
fn cancel_scan(window: tauri::Window, state: tauri::State<ScanCancellation>) -> Result<(), String> {
    let label = window.label().to_string();
    let cancellations = state
        .0
        .lock()
        .map_err(|_| "Failed to lock scan state".to_string())?;
    if let Some(flag) = cancellations.get(&label) {
        flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
fn get_disk_usage(path: String) -> Result<DiskUsageSnapshot, String> {
    let target = PathBuf::from(&path);
    compute_disk_usage(&target)
}

#[tauri::command]
fn delete_item(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err("Path does not exist".to_string());
    }
    if target.is_file() {
        fs::remove_file(target).map_err(|e| e.to_string())?;
    } else {
        fs::remove_dir_all(target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn rename_item(path: String, new_path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let dest = PathBuf::from(&new_path);
    if !target.exists() {
        return Err("Source path does not exist".to_string());
    }
    if dest.exists() {
        return Err("Destination already exists".to_string());
    }
    fs::rename(target, dest).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn create_folder(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if target.exists() {
        return Err("Path already exists".to_string());
    }
    fs::create_dir_all(target).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn copy_item(path: String, new_path: String) -> Result<(), String> {
    let source = PathBuf::from(&path);
    let dest = PathBuf::from(&new_path);
    if !source.exists() {
        return Err("Source does not exist".to_string());
    }
    if dest.exists() {
        return Err("Destination exists".to_string());
    }
    if source.is_file() {
        fs::copy(source, dest).map_err(|e| e.to_string())?;
    } else {
        copy_dir_recursive(&source, &dest)?;
    }
    Ok(())
}

fn copy_dir_recursive(source: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let dest_path = dest.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else {
            fs::copy(entry.path(), dest_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn get_path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[cfg(target_os = "windows")]
fn normalize_context_path(value: &str) -> Option<String> {
    let mut candidate = value.trim().trim_matches('"').replace('/', "\\");
    if candidate.is_empty() {
        return None;
    }

    if candidate.len() == 2 {
        let bytes = candidate.as_bytes();
        if bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
            candidate.push('\\');
            return Some(candidate);
        }
    }

    if candidate.ends_with('.') {
        let trimmed = candidate.trim_end_matches('.');
        if !trimmed.is_empty() && Path::new(trimmed).exists() {
            candidate = trimmed.to_string();
        }
    }

    Some(candidate)
}

#[cfg(not(target_os = "windows"))]
fn normalize_context_path(value: &str) -> Option<String> {
    let candidate = value.trim().trim_matches('"');
    if candidate.is_empty() {
        return None;
    }
    Some(candidate.to_string())
}

fn push_rename_context_item(
    path: &Path,
    is_directory: bool,
    items: &mut Vec<RenameContextItem>,
    seen: &mut HashSet<String>,
) {
    let item_path = get_path_string(path);
    if !seen.insert(item_path.clone()) {
        return;
    }
    items.push(RenameContextItem {
        path: item_path,
        name: get_entry_name_string(path),
        is_directory,
    });
}

fn collect_rename_files_recursive(
    dir: &Path,
    items: &mut Vec<RenameContextItem>,
    seen: &mut HashSet<String>,
) -> Result<(), String> {
    let read_dir =
        fs::read_dir(dir).map_err(|e| format!("Failed to read {}: {}", get_path_string(dir), e))?;

    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_dir() {
            collect_rename_files_recursive(&entry_path, items, seen)?;
            continue;
        }
        if file_type.is_file() {
            push_rename_context_item(&entry_path, false, items, seen);
        }
    }

    Ok(())
}

fn collect_rename_items_from_path(
    path: &Path,
    recursive: bool,
    items: &mut Vec<RenameContextItem>,
    seen: &mut HashSet<String>,
) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    if path.is_file() {
        push_rename_context_item(path, false, items, seen);
        return Ok(());
    }

    if !path.is_dir() {
        return Ok(());
    }

    if recursive {
        return collect_rename_files_recursive(path, items, seen);
    }

    let read_dir = fs::read_dir(path)
        .map_err(|e| format!("Failed to read {}: {}", get_path_string(path), e))?;

    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if !file_type.is_dir() && !file_type.is_file() {
            continue;
        }
        push_rename_context_item(&entry_path, file_type.is_dir(), items, seen);
    }

    Ok(())
}

fn get_entry_name_string(path: &Path) -> String {
    path.file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| get_path_string(path))
}

fn parse_runtime_options(
    args: &[String],
    startup_path: Option<String>,
    settings: &AppSettings,
) -> Result<RuntimeOptions, String> {
    let headless = has_flag(args, "--headless")
        || env_flag("DRAGABYTE_HEADLESS")
        || settings.headless.unwrap_or(false);
    let tcp = parse_tcp_config(args, settings)?;
    Ok(RuntimeOptions {
        headless,
        tcp,
        startup_path,
    })
}

fn parse_tcp_config(args: &[String], settings: &AppSettings) -> Result<Option<TcpConfig>, String> {
    let bind_arg = get_arg_value(args, "--tcp-bind");
    let env_bind = std::env::var("DRAGABYTE_TCP_BIND").ok();
    let token = get_arg_value(args, "--tcp-token")
        .or_else(|| std::env::var("DRAGABYTE_TCP_TOKEN").ok())
        .or_else(|| settings.local_token.clone());
    let enabled = has_flag(args, "--tcp")
        || bind_arg.is_some()
        || env_bind.is_some()
        || settings.tcp_bind.is_some()
        || settings.local_token.is_some();
    if !enabled {
        return Ok(None);
    }
    let bind_raw = bind_arg
        .or_else(|| env_bind)
        .or_else(|| settings.tcp_bind.clone())
        .unwrap_or_else(|| "127.0.0.1:4799".to_string());
    let bind_addr = bind_raw
        .parse::<SocketAddr>()
        .map_err(|_| "Invalid TCP bind address".to_string())?;
    if !bind_addr.ip().is_loopback() && token.is_none() {
        return Err("DRAGABYTE_TCP_TOKEN is required when binding to non-loopback".to_string());
    }
    Ok(Some(TcpConfig { bind_addr, token }))
}

fn env_flag(name: &str) -> bool {
    match std::env::var(name) {
        Ok(value) => matches!(value.to_lowercase().as_str(), "1" | "true" | "yes"),
        Err(_) => false,
    }
}

fn has_flag(args: &[String], flag: &str) -> bool {
    args.iter().any(|value| value == flag)
}

fn get_arg_value(args: &[String], prefix: &str) -> Option<String> {
    for value in args {
        if let Some(stripped) = value.strip_prefix(&format!("{}=", prefix)) {
            return Some(stripped.to_string());
        }
    }
    None
}

struct RemoteClientHandle {
    sender: mpsc::Sender<String>,
    shutdown: mpsc::Sender<()>,
    join: thread::JoinHandle<()>,
    token: Option<String>,
    address: String,
}

fn write_remote_lines(mut stream: TcpStream, receiver: mpsc::Receiver<String>) {
    for line in receiver {
        eprintln!("[remote] sending line bytes={}", line.len());
        if let Err(error) = stream.write_all(line.as_bytes()) {
            eprintln!("[remote] write failed: {error}");
            break;
        }
        if let Err(error) = stream.flush() {
            eprintln!("[remote] flush failed: {error}");
            break;
        }
    }
}

fn resolve_settings_path(args: &[String]) -> PathBuf {
    if let Some(path) = get_arg_value(args, "--settings") {
        return PathBuf::from(path);
    }
    if let Ok(path) = std::env::var("DRAGABYTE_SETTINGS_PATH") {
        return PathBuf::from(path);
    }
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("dragabyte.settings.json")
}

fn load_settings(path: &Path) -> AppSettings {
    let contents = fs::read_to_string(path).unwrap_or_default();
    if contents.trim().is_empty() {
        return AppSettings::default();
    }
    serde_json::from_str(&contents).unwrap_or_default()
}

fn save_settings(path: &Path, settings: &AppSettings) -> Result<(), String> {
    let payload = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("Failed to serialize settings: {error}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(file) = fs::File::create(path) {
            let mut perms = file.metadata().map_err(|e| e.to_string())?.permissions();
            perms.set_mode(0o600); // Read/write for owner only
            file.set_permissions(perms).map_err(|e| e.to_string())?;
            // Write content after setting permissions
            let mut writer = std::io::BufWriter::new(file);
            writer
                .write_all(payload.as_bytes())
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
    }

    fs::write(path, payload).map_err(|error| format!("Failed to save settings: {error}"))
}

fn apply_settings_update(settings: &mut AppSettings, update: AppSettingsUpdate) {
    if update.local_token.is_some() {
        settings.local_token = update.local_token;
    }
    if update.tcp_bind.is_some() {
        settings.tcp_bind = update.tcp_bind;
    }
    if update.headless.is_some() {
        settings.headless = update.headless;
    }
    if update.auto_update.is_some() {
        settings.auto_update = update.auto_update;
    }
}

#[tauri::command]
fn get_settings(state: tauri::State<SettingsState>) -> Result<AppSettings, String> {
    let guard = state
        .value
        .lock()
        .map_err(|_| "Failed to lock settings".to_string())?;
    Ok(guard.clone())
}

#[tauri::command]
fn update_settings(
    state: tauri::State<SettingsState>,
    update: AppSettingsUpdate,
) -> Result<AppSettings, String> {
    let mut guard = state
        .value
        .lock()
        .map_err(|_| "Failed to lock settings".to_string())?;
    apply_settings_update(&mut guard, update);
    save_settings(&state.path, &guard)?;
    Ok(guard.clone())
}

fn emit_remote_status(
    app: &tauri::AppHandle,
    status: &str,
    message: Option<String>,
    address: Option<String>,
) {
    let payload = serde_json::json!({
      "status": status,
      "message": message,
      "address": address
    });
    let _ = app.emit("remote-status", payload);
}

fn build_remote_payload(payload: JsonValue, token: Option<&str>) -> Result<String, String> {
    eprintln!("[remote] build payload input={}", payload);
    let mut value = payload;
    if let Some(secret) = token {
        match value {
            JsonValue::Object(ref mut map) => {
                map.entry("token".to_string())
                    .or_insert_with(|| JsonValue::String(secret.to_string()));
            }
            _ => return Err("Payload must be an object".to_string()),
        }
    }
    Ok(format!("{}\n", value))
}

fn stop_remote_client(handle: RemoteClientHandle) {
    let _ = handle.shutdown.send(());
    drop(handle.sender);
    let _ = handle.join.join();
}

fn spawn_remote_client(
    app: tauri::AppHandle,
    stream: TcpStream,
    token: Option<String>,
    address: String,
) -> Result<RemoteClientHandle, String> {
    stream
        .set_read_timeout(Some(Duration::from_millis(200)))
        .map_err(|error| format!("Failed to configure TCP stream: {error}"))?;
    let (sender, receiver) = mpsc::channel::<String>();
    let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>();
    let writer_stream = stream
        .try_clone()
        .map_err(|error| format!("Failed to clone TCP stream: {error}"))?;
    thread::spawn(move || write_remote_lines(writer_stream, receiver));
    let app_clone = app.clone();
    let address_clone = address.clone();
    let join = thread::spawn(move || {
        let mut reader = BufReader::new(stream);
        let mut lines = LineReader::default();
        loop {
            if shutdown_rx.try_recv().is_ok() {
                break;
            }
            match lines.read(&mut reader, MAX_LINE_LENGTH) {
                Ok(None) => break,
                Ok(Some(line)) => {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    if let Ok(mut value) = serde_json::from_str::<JsonValue>(trimmed) {
                        if let JsonValue::Object(ref mut map) = value {
                            map.insert(
                                "_address".to_string(),
                                JsonValue::String(address_clone.clone()),
                            );
                        }
                        let _ = app_clone.emit("remote-event", value);
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => continue,
                Err(error) if error.kind() == std::io::ErrorKind::TimedOut => continue,
                Err(_) => break,
            }
        }
        emit_remote_status(&app_clone, "disconnected", None, Some(address_clone));
    });
    Ok(RemoteClientHandle {
        sender,
        shutdown: shutdown_tx,
        join,
        token,
        address,
    })
}

#[tauri::command]
fn remote_connect(
    app: tauri::AppHandle,
    state: tauri::State<RemoteClientState>,
    payload: RemoteConnectPayload,
) -> Result<(), String> {
    let address = format!("{}:{}", payload.host.trim(), payload.port);
    eprintln!("[remote] connect attempt {}", address);
    emit_remote_status(&app, "connecting", None, Some(address.clone()));
    let stream = TcpStream::connect(&address).map_err(|error| {
        emit_remote_status(
            &app,
            "error",
            Some(format!("Failed to connect: {error}")),
            Some(address.clone()),
        );
        format!("Failed to connect to {address}: {error}")
    })?;
    eprintln!("[remote] connect success {}", address);
    let mut state_guard = state
        .0
        .lock()
        .map_err(|_| "Failed to lock remote state".to_string())?;
    if let Some(existing) = state_guard.take() {
        stop_remote_client(existing);
    }
    let handle = spawn_remote_client(app.clone(), stream, payload.token, address.clone())?;
    *state_guard = Some(handle);
    emit_remote_status(&app, "connected", None, Some(address));
    Ok(())
}

#[tauri::command]
fn remote_disconnect(
    app: tauri::AppHandle,
    state: tauri::State<RemoteClientState>,
) -> Result<(), String> {
    let mut state_guard = state
        .0
        .lock()
        .map_err(|_| "Failed to lock remote state".to_string())?;
    if let Some(handle) = state_guard.take() {
        let address = handle.address.clone();
        stop_remote_client(handle);
        emit_remote_status(&app, "disconnected", None, Some(address));
    }
    Ok(())
}

#[tauri::command]
fn remote_send(
    state: tauri::State<RemoteClientState>,
    payload: RemoteSendPayload,
) -> Result<(), String> {
    eprintln!("[remote] send from ui payload={}", payload.payload);
    let state_guard = state
        .0
        .lock()
        .map_err(|_| "Failed to lock remote state".to_string())?;
    let handle = state_guard
        .as_ref()
        .ok_or_else(|| "Remote is not connected".to_string())?;
    let safe_payload = match payload.payload {
        JsonValue::Object(_) => payload.payload,
        _ => JsonValue::Object(serde_json::Map::new()),
    };
    let line = build_remote_payload(safe_payload, handle.token.as_deref())?;
    handle
        .sender
        .send(line)
        .map_err(|_| "Failed to send remote payload".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteStatusSnapshot {
    connected: bool,
    address: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TcpStatusSnapshot {
    enabled: bool,
    bind: Option<String>,
}

#[tauri::command]
fn remote_status(state: tauri::State<RemoteClientState>) -> Result<RemoteStatusSnapshot, String> {
    let guard = state
        .0
        .lock()
        .map_err(|_| "Failed to lock remote state".to_string())?;
    let address = guard.as_ref().map(|handle| handle.address.clone());
    Ok(RemoteStatusSnapshot {
        connected: address.is_some(),
        address,
    })
}

#[tauri::command]
fn get_tcp_status(state: tauri::State<RuntimeState>) -> TcpStatusSnapshot {
    TcpStatusSnapshot {
        enabled: state.tcp_enabled,
        bind: state.tcp_bind.clone(),
    }
}

fn extract_context_paths(value: &str) -> Vec<String> {
    if let Some(candidate) = normalize_context_path(value) {
        if Path::new(&candidate).exists() {
            return vec![candidate];
        }
    }

    #[cfg(target_os = "windows")]
    {
        let mut resolved = Vec::new();
        for token in split_context_argument(value) {
            let Some(candidate) = normalize_context_path(&token) else {
                continue;
            };
            if Path::new(&candidate).exists() && !resolved.contains(&candidate) {
                resolved.push(candidate);
            }
        }
        return resolved;
    }

    #[cfg(not(target_os = "windows"))]
    {
        Vec::new()
    }
}

fn resolve_launch_context(args: &[String]) -> LaunchContext {
    let mut paths = Vec::new();
    let mut mode = "scan".to_string();

    for arg in args.iter().skip(1) {
        if arg == "--rename" {
            mode = "rename".to_string();
            continue;
        }

        if arg.starts_with('-') {
            continue;
        }

        for candidate in extract_context_paths(arg) {
            if !paths.contains(&candidate) {
                paths.push(candidate);
            }
        }
    }

    let path = paths.first().cloned();

    LaunchContext { path, paths, mode }
}

#[cfg(target_os = "windows")]
fn current_unix_time_ms() -> u128 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[cfg(target_os = "windows")]
fn dedupe_paths(paths: Vec<String>) -> Vec<String> {
    let mut unique = Vec::new();
    for path in paths {
        if !unique.contains(&path) {
            unique.push(path);
        }
    }
    unique
}

#[cfg(target_os = "windows")]
fn merge_paths(target: &mut Vec<String>, additions: &[String]) {
    for path in additions {
        if !target.contains(path) {
            target.push(path.clone());
        }
    }
}

#[cfg(target_os = "windows")]
fn split_context_argument(value: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;

    for ch in value.chars() {
        match ch {
            '"' => {
                in_quotes = !in_quotes;
            }
            c if c.is_whitespace() && !in_quotes => {
                let token = current.trim();
                if !token.is_empty() {
                    parts.push(token.to_string());
                }
                current.clear();
            }
            _ => current.push(ch),
        }
    }

    let token = current.trim();
    if !token.is_empty() {
        parts.push(token.to_string());
    }

    parts
}

#[cfg(target_os = "windows")]
fn launch_coalesce_dir() -> PathBuf {
    std::env::temp_dir().join("dragabyte")
}

#[cfg(target_os = "windows")]
fn pending_launch_state_path(mode: &str) -> PathBuf {
    launch_coalesce_dir().join(format!("launch-context-{}.json", mode))
}

#[cfg(target_os = "windows")]
fn pending_launch_lock_path(mode: &str) -> PathBuf {
    launch_coalesce_dir().join(format!("launch-context-{}.lock", mode))
}

#[cfg(target_os = "windows")]
fn read_pending_launch_context(path: &Path) -> Option<PendingLaunchContext> {
    let contents = fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

#[cfg(target_os = "windows")]
fn write_pending_launch_context(path: &Path, state: &PendingLaunchContext) -> Result<(), String> {
    let payload = serde_json::to_string(state).map_err(|e| e.to_string())?;
    fs::write(path, payload).map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn coalesce_launch_context(launch_context: LaunchContext) -> Result<Option<LaunchContext>, String> {
    if launch_context.paths.is_empty() {
        return Ok(Some(launch_context));
    }

    let coalesce_dir = launch_coalesce_dir();
    fs::create_dir_all(&coalesce_dir).map_err(|e| e.to_string())?;

    let state_path = pending_launch_state_path(&launch_context.mode);
    let lock_path = pending_launch_lock_path(&launch_context.mode);
    let current_pid = std::process::id();
    let now = current_unix_time_ms();

    let lock_file = fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&lock_path)
        .map_err(|e| e.to_string())?;
    lock_file.lock_exclusive().map_err(|e| e.to_string())?;

    let existing = read_pending_launch_context(&state_path);
    let mut is_leader = true;
    let next_state = match existing {
        Some(mut state) if now.saturating_sub(state.updated_at_ms) <= LAUNCH_COALESCE_STALE_MS => {
            is_leader = false;
            state.updated_at_ms = now;
            merge_paths(&mut state.paths, &launch_context.paths);
            state
        }
        _ => PendingLaunchContext {
            leader_pid: current_pid,
            updated_at_ms: now,
            paths: launch_context.paths.clone(),
        },
    };

    write_pending_launch_context(&state_path, &next_state)?;
    let _ = lock_file.unlock();
    drop(lock_file);

    if !is_leader {
        return Ok(None);
    }

    thread::sleep(Duration::from_millis(LAUNCH_COALESCE_WINDOW_MS));

    let lock_file = fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&lock_path)
        .map_err(|e| e.to_string())?;
    lock_file.lock_exclusive().map_err(|e| e.to_string())?;

    let mut resolved = launch_context;
    if let Some(state) = read_pending_launch_context(&state_path) {
        if state.leader_pid == current_pid {
            resolved.paths = dedupe_paths(state.paths);
            resolved.path = resolved.paths.first().cloned();
            let _ = fs::remove_file(&state_path);
        }
    }

    let _ = lock_file.unlock();
    Ok(Some(resolved))
}

#[cfg(target_os = "windows")]
fn hide_console_window() {
    use windows_sys::Win32::System::Console::GetConsoleWindow;
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};

    unsafe {
        let window = GetConsoleWindow();
        if window != 0 {
            ShowWindow(window, SW_HIDE);
        }
    }
}

#[cfg(target_os = "windows")]
fn is_context_menu_key_valid(hkcu: &RegKey, key_path: &str, exe_str: &str) -> bool {
    let key = match hkcu.open_subkey(key_path) {
        Ok(entry) => entry,
        Err(_) => return false,
    };
    let cmd_key = match key.open_subkey("command") {
        Ok(entry) => entry,
        Err(_) => return false,
    };
    let cmd_val: String = match cmd_key.get_value("") {
        Ok(value) => value,
        Err(_) => return false,
    };
    let cmd_lower = cmd_val.to_lowercase();
    let exe_lower = exe_str.to_lowercase();
    if !cmd_lower.contains(&exe_lower) {
        return false;
    }

    if key_path.contains("DragabyteRename") {
        if key_path.contains("Background") {
            return cmd_lower.contains("--rename") && cmd_lower.contains("%v.");
        }
        if key_path.contains("AllFileSystemObjects") {
            let multi_select_model: String = match key.get_value("MultiSelectModel") {
                Ok(value) => value,
                Err(_) => return false,
            };
            if multi_select_model.to_lowercase() != "player" {
                return false;
            }
            return cmd_lower.contains("--rename") && cmd_lower.contains("%*");
        }
        if key_path.contains("Drive") {
            return cmd_lower.contains("--rename") && cmd_lower.contains("%1.");
        }
        return cmd_lower.contains("--rename") && cmd_lower.contains("%1");
    }

    if key_path.contains("Background") {
        return cmd_lower.contains("%v.");
    }

    cmd_lower.contains("%1.")
}

#[cfg(target_os = "windows")]
fn has_any_context_menu_registration(hkcu: &RegKey) -> bool {
    [
        "Software\\Classes\\Directory\\shell\\Dragabyte",
        "Software\\Classes\\Drive\\shell\\Dragabyte",
        "Software\\Classes\\directory\\Background\\shell\\Dragabyte",
        "Software\\Classes\\AllFileSystemObjects\\shell\\DragabyteRename",
        "Software\\Classes\\Drive\\shell\\DragabyteRename",
        "Software\\Classes\\directory\\Background\\shell\\DragabyteRename",
        "Software\\Classes\\Directory\\shell\\DragabyteRename",
        "Software\\Classes\\*\\shell\\DragabyteRename",
    ]
    .iter()
    .any(|key_path| hkcu.open_subkey(key_path).is_ok())
}

#[cfg(target_os = "windows")]
fn repair_context_menu_if_needed() -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if !has_any_context_menu_registration(&hkcu) || is_context_menu_enabled() {
        return Ok(());
    }
    reset_context_menu()
}

#[tauri::command]
fn is_context_menu_enabled() -> bool {
    #[cfg(target_os = "windows")]
    {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let exe_path = match std::env::current_exe() {
            Ok(path) => path,
            Err(_) => return false,
        };
        let exe_str = match exe_path.to_str() {
            Some(value) => value,
            None => return false,
        };
        let scan_keys = [
            "Software\\Classes\\Directory\\shell\\Dragabyte",
            "Software\\Classes\\Drive\\shell\\Dragabyte",
            "Software\\Classes\\directory\\Background\\shell\\Dragabyte",
        ];
        let rename_keys = [
            "Software\\Classes\\AllFileSystemObjects\\shell\\DragabyteRename",
            "Software\\Classes\\Drive\\shell\\DragabyteRename",
            "Software\\Classes\\directory\\Background\\shell\\DragabyteRename",
        ];
        let legacy_rename_keys = [
            "Software\\Classes\\Directory\\shell\\DragabyteRename",
            "Software\\Classes\\*\\shell\\DragabyteRename",
        ];
        scan_keys
            .iter()
            .all(|key_path| is_context_menu_key_valid(&hkcu, key_path, exe_str))
            && rename_keys
                .iter()
                .all(|key_path| is_context_menu_key_valid(&hkcu, key_path, exe_str))
            && legacy_rename_keys
                .iter()
                .all(|key_path| hkcu.open_subkey(key_path).is_err())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = match std::env::var("HOME") {
            Ok(val) => val,
            Err(_) => return false,
        };
        let desktop_file = PathBuf::from(home).join(".local/share/applications/dragabyte.desktop");
        desktop_file.exists()
    }
}

#[tauri::command]
fn toggle_context_menu(_enable: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let scan_keys = [
            "Software\\Classes\\Directory\\shell\\Dragabyte",
            "Software\\Classes\\Drive\\shell\\Dragabyte",
            "Software\\Classes\\directory\\Background\\shell\\Dragabyte",
        ];
        let rename_keys = [
            "Software\\Classes\\AllFileSystemObjects\\shell\\DragabyteRename",
            "Software\\Classes\\Drive\\shell\\DragabyteRename",
            "Software\\Classes\\directory\\Background\\shell\\DragabyteRename",
        ];
        let legacy_rename_keys = [
            "Software\\Classes\\Directory\\shell\\DragabyteRename",
            "Software\\Classes\\*\\shell\\DragabyteRename",
        ];

        if _enable {
            let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
            let exe_str = exe_path.to_str().ok_or("Invalid path")?;
            let scan_cmd = format!("\"{}\" \"%1.\"", exe_str);
            let rename_drive_cmd = format!("\"{}\" --rename \"%1.\"", exe_str);
            let rename_background_cmd = format!("\"{}\" --rename \"%V.\"", exe_str);
            let rename_multi_cmd = format!("\"{}\" --rename %*", exe_str);

            for key_path in legacy_rename_keys {
                let _ = hkcu.delete_subkey_all(key_path);
            }

            for key_path in scan_keys {
                let (key, _) = hkcu.create_subkey(key_path).map_err(|e| e.to_string())?;
                key.set_value("", &"Scan with Dragabyte")
                    .map_err(|e| e.to_string())?;
                key.set_value("Icon", &exe_str).map_err(|e| e.to_string())?;

                let (cmd_key, _) = key.create_subkey("command").map_err(|e| e.to_string())?;

                let cmd_val = if key_path.contains("Background") {
                    format!("\"{}\" \"%V.\"", exe_str)
                } else {
                    scan_cmd.clone()
                };

                cmd_key.set_value("", &cmd_val).map_err(|e| e.to_string())?;
            }

            for key_path in rename_keys {
                let (r_key, _) = hkcu.create_subkey(key_path).map_err(|e| e.to_string())?;
                r_key
                    .set_value("", &"Rename with Dragabyte")
                    .map_err(|e| e.to_string())?;
                r_key
                    .set_value("Icon", &exe_str)
                    .map_err(|e| e.to_string())?;
                let _ = r_key.set_value("MultiSelectModel", &"Player");

                let (r_cmd_key, _) = r_key.create_subkey("command").map_err(|e| e.to_string())?;
                let r_cmd_val = if key_path.contains("Background") {
                    rename_background_cmd.clone()
                } else if key_path.contains("AllFileSystemObjects") {
                    rename_multi_cmd.clone()
                } else {
                    rename_drive_cmd.clone()
                };
                r_cmd_key
                    .set_value("", &r_cmd_val)
                    .map_err(|e| e.to_string())?;
            }
        } else {
            for key_path in scan_keys {
                let _ = hkcu.delete_subkey_all(key_path);
            }
            for key_path in rename_keys {
                let _ = hkcu.delete_subkey_all(key_path);
            }
            for key_path in [
                "Software\\Classes\\Directory\\shell\\DragabyteRename",
                "Software\\Classes\\*\\shell\\DragabyteRename",
            ] {
                let _ = hkcu.delete_subkey_all(key_path);
            }
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").map_err(|_| "HOME not found")?;
        let apps_dir = PathBuf::from(home).join(".local/share/applications");
        if !apps_dir.exists() {
            fs::create_dir_all(&apps_dir).map_err(|e| e.to_string())?;
        }
        let desktop_file = apps_dir.join("dragabyte.desktop");

        if _enable {
            let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
            let exe_str = exe_path.to_string_lossy();
            let content = format!(
                r#"[Desktop Entry]
Type=Application
Name=Dragabyte
Comment=Disk Space Analyzer and Bulk Rename Utility
Exec="{}" %f
Icon=utilities-terminal
Terminal=false
Categories=Utility;FileTools;
Actions=Scan;Rename;

[Desktop Action Scan]
Name=Scan with Dragabyte
Exec="{}" %f

[Desktop Action Rename]
Name=Rename with Dragabyte
Exec="{}" --rename %f
"#,
                exe_str, exe_str, exe_str
            );
            fs::write(desktop_file, content).map_err(|e| e.to_string())?;
        } else {
            if desktop_file.exists() {
                fs::remove_file(desktop_file).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
}

#[tauri::command]
fn reset_context_menu() -> Result<(), String> {
    toggle_context_menu(false)?;
    toggle_context_menu(true)
}

#[tauri::command]
fn save_temp_and_open(name: String, data: String) -> Result<(), String> {
    let bytes = BASE64_STANDARD
        .decode(data)
        .map_err(|e| format!("Invalid base64 data: {e}"))?;
    let temp_dir = std::env::temp_dir();
    let safe_name = Path::new(&name).file_name().ok_or("Invalid filename")?;
    let target_path = temp_dir.join(safe_name);
    fs::write(&target_path, bytes).map_err(|e| format!("Failed to write file: {e}"))?;
    let path_str = target_path.to_string_lossy().to_string();
    open_path(path_str)
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err("Path does not exist".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let status = Command::new("cmd")
            .args(["/C", "start", "", &path])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Failed to open path".to_string());
        }
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open")
            .arg(&path)
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Failed to open path".to_string());
        }
        return Ok(());
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let status = Command::new("xdg-open")
            .arg(&path)
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Failed to open path".to_string());
        }
        return Ok(());
    }
}

#[tauri::command]
fn show_in_explorer(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err("Path does not exist".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let explorer_path = target.to_string_lossy().to_string();
        if target.is_file() {
            // Explorer can ignore a combined `/select,"path"` token when the
            // process API adds another quoting layer around it, so pass the
            // selector and the target as separate arguments instead.
            Command::new("explorer.exe")
                .args(["/select,", explorer_path.as_str()])
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            Command::new("explorer.exe")
                .arg(&explorer_path)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let status = if target.is_file() {
            Command::new("open").args(["-R", &path]).status()
        } else {
            Command::new("open").arg(&path).status()
        }
        .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Failed to show path in explorer".to_string());
        }
        return Ok(());
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let folder = if target.is_file() {
            target.parent().unwrap_or(target)
        } else {
            target
        };
        let folder_str = folder.to_string_lossy().to_string();
        let status = Command::new("xdg-open")
            .arg(folder_str)
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Failed to show path in explorer".to_string());
        }
        return Ok(());
    }
}

fn ensure_window_bounds(window: &tauri::WebviewWindow) {
    let position = match window.outer_position() {
        Ok(value) => value,
        Err(_) => return,
    };
    let size = match window.outer_size() {
        Ok(value) => value,
        Err(_) => return,
    };
    let mut monitors = match window.available_monitors() {
        Ok(list) => list,
        Err(_) => Vec::new(),
    };
    if monitors.is_empty() {
        if let Ok(Some(monitor)) = window.current_monitor() {
            monitors.push(monitor);
        } else if let Ok(Some(monitor)) = window.primary_monitor() {
            monitors.push(monitor);
        } else {
            return;
        }
    }

    let width = size.width as i32;
    let height = size.height as i32;
    let mut fits_monitor = false;
    for monitor in &monitors {
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let max_x = monitor_position.x + monitor_size.width as i32;
        let max_y = monitor_position.y + monitor_size.height as i32;
        if position.x >= monitor_position.x
            && position.y >= monitor_position.y
            && position.x + width <= max_x
            && position.y + height <= max_y
        {
            fits_monitor = true;
            break;
        }
    }

    if fits_monitor {
        return;
    }

    let monitor = match monitors.into_iter().next() {
        Some(value) => value,
        None => return,
    };
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let mut new_width = size.width;
    let mut new_height = size.height;
    if new_width > monitor_size.width {
        new_width = monitor_size.width;
    }
    if new_height > monitor_size.height {
        new_height = monitor_size.height;
    }
    let max_x = monitor_position.x + monitor_size.width as i32 - new_width as i32;
    let max_y = monitor_position.y + monitor_size.height as i32 - new_height as i32;
    let new_x = position.x.clamp(monitor_position.x, max_x);
    let new_y = position.y.clamp(monitor_position.y, max_y);

    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
        width: new_width,
        height: new_height,
    }));
    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
        x: new_x,
        y: new_y,
    }));
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let launch_context = resolve_launch_context(&args);
    #[cfg(target_os = "windows")]
    let launch_context = match coalesce_launch_context(launch_context) {
        Ok(Some(value)) => value,
        Ok(None) => return,
        Err(error) => {
            eprintln!("[launch] failed to coalesce launch context: {error}");
            resolve_launch_context(&args)
        }
    };
    let startup_path = launch_context.path.clone();
    let settings_path = resolve_settings_path(&args);
    let settings = load_settings(&settings_path);
    let runtime_options = match parse_runtime_options(&args, startup_path.clone(), &settings) {
        Ok(options) => options,
        Err(error) => {
            eprintln!("{error}");
            return;
        }
    };
    if runtime_options.headless && runtime_options.tcp.is_none() {
        eprintln!("Headless mode requires --tcp");
        return;
    }
    let tcp_server = match runtime_options.tcp.clone() {
        Some(config) => match start_remote_server(config, runtime_options.headless) {
            Ok(handle) => Some(handle),
            Err(error) => {
                eprintln!("{error}");
                None
            }
        },
        None => None,
    };
    if runtime_options.headless {
        if let Some(server) = tcp_server {
            if let Err(error) = server.wait() {
                eprintln!("{error}");
            }
        }
        return;
    }
    let tcp_running = tcp_server.is_some();
    let tcp_bind = if tcp_running {
        runtime_options
            .tcp
            .as_ref()
            .map(|value| value.bind_addr.to_string())
    } else {
        None
    };
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    let window_state_plugin = tauri_plugin_window_state::Builder::default()
        .with_state_flags(StateFlags::POSITION | StateFlags::SIZE)
        .skip_initial_state("main")
        .build();
    let builder = builder.plugin(window_state_plugin);

    let startup_path_state = runtime_options.startup_path.clone();
    let launch_context_state = launch_context.clone();

    builder
        .setup(move |app| {
            if startup_path_state.is_some() {
                #[cfg(target_os = "windows")]
                hide_console_window();
            }
            app.manage(StartupPath(Mutex::new(startup_path_state.clone())));
            app.manage(LaunchContextState(Mutex::new(launch_context_state.clone())));
            app.manage(ScanCancellation(Mutex::new(HashMap::new())));
            app.manage(SettingsState {
                path: settings_path.clone(),
                value: Mutex::new(settings.clone()),
            });
            app.manage(RuntimeState {
                tcp_enabled: tcp_running,
                tcp_bind: tcp_bind.clone(),
            });
            app.manage(RemoteClientState(Mutex::new(None)));
            #[cfg(target_os = "windows")]
            if let Err(error) = repair_context_menu_if_needed() {
                eprintln!("[shell] failed to repair context menu registration: {error}");
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.restore_state(StateFlags::POSITION | StateFlags::SIZE);
                ensure_window_bounds(&window);
                let _ = window.show();
                let _ = window.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_path,
            cancel_scan,
            get_disk_usage,
            delete_item,
            rename_item,
            create_folder,
            copy_item,
            is_context_menu_enabled,
            toggle_context_menu,
            reset_context_menu,
            get_startup_path,
            get_launch_context,
            collect_rename_items,
            open_path,
            save_temp_and_open,
            show_in_explorer,
            get_settings,
            update_settings,
            remote_connect,
            remote_disconnect,
            remote_send,
            remote_status,
            get_tcp_status,
            batch_rename
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
    if let Some(handle) = tcp_server {
        drop(handle);
    }
}
