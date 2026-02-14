#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

const MAX_CONNECTIONS: usize = 50;
const MAX_LINE_LENGTH: u64 = 10 * 1024 * 1024; // 10MB

#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

use base64::prelude::*;
use jwalk::{Parallelism, WalkDir};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;
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

struct RuntimeState {
    tcp_bind: Option<String>,
    tcp_enabled: bool,
}

#[derive(Clone)]
enum ScanEvent {
    Progress(ScanSummary),
    Complete(ScanSummary),
    Error(String),
    Cancelled(String),
}

type ScanEmitter = Arc<dyn Fn(ScanEvent) + Send + Sync>;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanNode {
    path: String,
    name: String,
    size_bytes: u64,
    file_count: u64,
    dir_count: u64,
    files: Vec<ScanFile>,
    children: Vec<ScanNode>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanFile {
    path: String,
    name: String,
    size_bytes: u64,
    modified: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    root: ScanNode,
    total_bytes: u64,
    file_count: u64,
    dir_count: u64,
    largest_files: Vec<ScanFile>,
    duration_ms: u128,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiskUsageSnapshot {
    path: String,
    total_bytes: u64,
    free_bytes: u64,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
enum ScanPriorityMode {
    Performance,
    Balanced,
    Low,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
enum ScanThrottleLevel {
    Off,
    Low,
    Medium,
    High,
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
enum RemoteRequest {
    Ping {
        id: Option<String>,
    },
    List {
        id: Option<String>,
        path: Option<String>,
    },
    Disk {
        id: Option<String>,
        path: String,
    },
    Read {
        id: Option<String>,
        path: String,
    },
    Scan {
        id: Option<String>,
        path: String,
        options: Option<ScanOptions>,
    },
    Cancel {
        id: Option<String>,
    },
    Shutdown {
        id: Option<String>,
    },
}

#[derive(Deserialize)]
struct RemoteEnvelope {
    token: Option<String>,
    #[serde(flatten)]
    request: RemoteRequest,
}

#[derive(Clone)]
struct TcpConfig {
    bind_addr: SocketAddr,
    token: Option<String>,
}

struct RuntimeOptions {
    headless: bool,
    tcp: Option<TcpConfig>,
    startup_path: Option<String>,
    updater_enabled: bool,
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

struct RemoteHub {
    clients: Mutex<Vec<mpsc::Sender<String>>>,
    scan_cancel: Mutex<Option<Arc<AtomicBool>>>,
    scan_active: AtomicBool,
    token: Option<String>,
    shutdown: Option<mpsc::Sender<()>>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScanFilters {
    include_extensions: Vec<String>,
    exclude_extensions: Vec<String>,
    include_names: Vec<String>,
    exclude_names: Vec<String>,
    min_size_bytes: Option<u64>,
    max_size_bytes: Option<u64>,
    min_modified_timestamp: Option<u64>,
    max_modified_timestamp: Option<u64>,
    include_regex: Option<String>,
    exclude_regex: Option<String>,
    include_paths: Vec<String>,
    exclude_paths: Vec<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScanOptions {
    priority_mode: ScanPriorityMode,
    throttle_level: ScanThrottleLevel,
    filters: ScanFilters,
}

impl Default for ScanPriorityMode {
    fn default() -> Self {
        ScanPriorityMode::Balanced
    }
}

impl Default for ScanThrottleLevel {
    fn default() -> Self {
        ScanThrottleLevel::Off
    }
}

impl Default for ScanFilters {
    fn default() -> Self {
        Self {
            include_extensions: Vec::new(),
            exclude_extensions: Vec::new(),
            include_names: Vec::new(),
            exclude_names: Vec::new(),
            min_size_bytes: None,
            max_size_bytes: None,
            min_modified_timestamp: None,
            max_modified_timestamp: None,
            include_regex: None,
            exclude_regex: None,
            include_paths: Vec::new(),
            exclude_paths: Vec::new(),
        }
    }
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            priority_mode: ScanPriorityMode::default(),
            throttle_level: ScanThrottleLevel::default(),
            filters: ScanFilters::default(),
        }
    }
}

struct FilterConfig {
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

struct ThrottleConfig {
    every_entries: u64,
    sleep_ms: u64,
}

struct ScanConfig {
    filters: FilterConfig,
    emit_every: u64,
    emit_interval: Duration,
    throttle: Option<ThrottleConfig>,
    parallelism: Parallelism,
}

#[derive(Default)]
struct NodeStats {
    direct_bytes: u64,
    direct_files: u64,
    direct_dirs: u64,
}

impl RemoteHub {
    fn new(token: Option<String>, shutdown: Option<mpsc::Sender<()>>) -> Self {
        Self {
            clients: Mutex::new(Vec::new()),
            scan_cancel: Mutex::new(None),
            scan_active: AtomicBool::new(false),
            token,
            shutdown,
        }
    }

    fn register_client(&self, sender: mpsc::Sender<String>) {
        if let Ok(mut clients) = self.clients.lock() {
            clients.push(sender);
        }
    }

    fn broadcast(&self, message: String) {
        if let Ok(mut clients) = self.clients.lock() {
            clients.retain(|sender| sender.send(message.clone()).is_ok());
        }
    }

    fn start_scan(&self, cancel_flag: Arc<AtomicBool>) -> bool {
        if self.scan_active.swap(true, Ordering::SeqCst) {
            return false;
        }
        if let Ok(mut cancel) = self.scan_cancel.lock() {
            *cancel = Some(cancel_flag);
        }
        true
    }

    fn cancel_scan(&self) -> bool {
        if let Ok(cancel) = self.scan_cancel.lock() {
            if let Some(flag) = cancel.as_ref() {
                flag.store(true, Ordering::SeqCst);
                return true;
            }
        }
        false
    }

    fn finish_scan(&self) {
        self.scan_active.store(false, Ordering::SeqCst);
        if let Ok(mut cancel) = self.scan_cancel.lock() {
            *cancel = None;
        }
    }

    fn validate_token(&self, token: Option<&str>) -> bool {
        match self.token.as_deref() {
            None => true,
            Some(expected) => token == Some(expected),
        }
    }

    fn request_shutdown(&self) -> bool {
        match &self.shutdown {
            Some(sender) => sender.send(()).is_ok(),
            None => false,
        }
    }
}

fn emit_to_window(window: &tauri::Window, event: ScanEvent) {
    match event {
        ScanEvent::Progress(summary) => {
            let _ = window.emit("scan-progress", summary);
        }
        ScanEvent::Complete(summary) => {
            let _ = window.emit("scan-complete", summary);
        }
        ScanEvent::Error(message) => {
            let _ = window.emit("scan-error", message);
        }
        ScanEvent::Cancelled(message) => {
            let _ = window.emit("scan-cancelled", message);
        }
    }
}

fn emit_to_remote(hub: &RemoteHub, event: ScanEvent, request_id: Option<&str>) {
    let payload = match event {
        ScanEvent::Progress(summary) => serde_json::json!({
          "event": "scan-progress",
          "id": request_id,
          "data": summary
        }),
        ScanEvent::Complete(summary) => serde_json::json!({
          "event": "scan-complete",
          "id": request_id,
          "data": summary
        }),
        ScanEvent::Error(message) => serde_json::json!({
          "event": "scan-error",
          "id": request_id,
          "message": message
        }),
        ScanEvent::Cancelled(message) => serde_json::json!({
          "event": "scan-cancelled",
          "id": request_id,
          "message": message
        }),
    };
    let line = format!("{}\n", payload);
    hub.broadcast(line);
}

#[derive(Deserialize)]
struct BatchRenameItem {
    path: String,
    new_path: String,
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
fn scan_path(
    window: tauri::Window,
    path: String,
    options: ScanOptions,
    id: Option<String>,
    state: tauri::State<ScanCancellation>,
) -> Result<(), String> {
    let root = PathBuf::from(&path);
    if !root.exists() {
        return Err("Path does not exist".to_string());
    }

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

    tauri::async_runtime::spawn(async move {
        let app_handle = window_for_task.app_handle();
        let emitter_window = window_for_task.clone();
        let emitter: ScanEmitter = Arc::new(move |event| emit_to_window(&emitter_window, event));
        if let Err(error) = run_scan(root, config, Arc::clone(&cancel_flag), emitter, task_id) {
            let _ = window_for_task.emit("scan-error", error);
        }
        let cancellations = app_handle.state::<ScanCancellation>();
        if let Ok(mut map) = cancellations.0.lock() {
            map.remove(&label_for_task);
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

fn get_time_millis(time: std::io::Result<SystemTime>) -> Option<u64> {
    time.ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
}

fn run_scan(
    root: PathBuf,
    config: ScanConfig,
    cancel_flag: Arc<AtomicBool>,
    emit: ScanEmitter,
    scan_id: Option<String>,
) -> Result<(), String> {
    let start = Instant::now();
    let mut stats: HashMap<PathBuf, NodeStats> = HashMap::new();
    let mut children: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();
    let mut files_by_parent: HashMap<PathBuf, Vec<ScanFile>> = HashMap::new();
    let mut largest_files: Vec<ScanFile> = Vec::new();
    let mut last_emit = Instant::now();
    let mut last_emitted_bytes: u64 = 0;
    let mut processed: u64 = 0;

    let walk = WalkDir::new(&root).parallelism(config.parallelism.clone());
    for entry in walk {
        if cancel_flag.load(Ordering::Relaxed) {
            emit(ScanEvent::Cancelled("Scan cancelled".to_string()));
            return Ok(());
        }
        let entry = match entry {
            Ok(item) => item,
            Err(_) => continue,
        };
        let entry_path = entry.path();
        let entry_type = entry.file_type();
        processed += 1;

        if entry_type.is_dir() {
            if should_skip_dir(&root, &entry_path, &config.filters) {
                continue;
            }
            stats.entry(entry_path.to_path_buf()).or_default();
            if let Some(parent) = entry_path.parent() {
                let parent_buf = parent.to_path_buf();
                children
                    .entry(parent_buf.clone())
                    .or_default()
                    .push(entry_path.to_path_buf());
                stats.entry(parent_buf).or_default().direct_dirs += 1;
            }
        } else if entry_type.is_file() {
            let metadata = entry.metadata();
            let size = metadata.as_ref().map(|meta| meta.len()).unwrap_or(0);
            let modified = metadata
                .as_ref()
                .ok()
                .and_then(|m| get_time_millis(m.modified()));

            if !should_include_file(&entry_path, size, modified, &config.filters) {
                continue;
            }
            let name = get_entry_name_string(&entry_path);
            if let Some(parent) = entry_path.parent() {
                let parent_buf = parent.to_path_buf();
                files_by_parent
                    .entry(parent_buf)
                    .or_default()
                    .push(ScanFile {
                        path: get_path_string(&entry_path),
                        name,
                        size_bytes: size,
                        modified,
                    });
            }
            update_largest_files(&mut largest_files, &entry_path, size, modified, 100);
            if let Some(parent) = entry_path.parent() {
                let parent_stats = stats.entry(parent.to_path_buf()).or_default();
                parent_stats.direct_bytes += size;
                parent_stats.direct_files += 1;
            }
        }

        if let Some(throttle) = &config.throttle {
            if throttle.sleep_ms > 0 && processed % throttle.every_entries == 0 {
                thread::sleep(Duration::from_millis(throttle.sleep_ms));
            }
        }

        if should_emit_progress(processed, &last_emit, &config) {
            let summary = build_summary(
                &root,
                &children,
                &files_by_parent,
                &stats,
                &largest_files,
                start,
                scan_id.clone(),
                true,      // compact mode
                false,     // sort by name for stability
                Some(400), // cap children to avoid UI overload
            );

            // Ensure we don't emit a summary that shows "less" size than before
            if summary.total_bytes >= last_emitted_bytes {
                last_emitted_bytes = summary.total_bytes;
                emit(ScanEvent::Progress(summary));
                last_emit = Instant::now();
            }
        }
    }

    let summary = build_summary(
        &root,
        &children,
        &files_by_parent,
        &stats,
        &largest_files,
        start,
        scan_id,
        false, // full mode
        true,  // sort by size for final view
        None,
    );
    emit(ScanEvent::Complete(summary));
    Ok(())
}

fn build_scan_config(options: &ScanOptions) -> Result<ScanConfig, String> {
    let filters = build_filter_config(&options.filters)?;
    let parallelism = resolve_parallelism(&options.priority_mode);
    let (emit_every, emit_interval) = match options.priority_mode {
        ScanPriorityMode::Performance => (5000, Duration::from_millis(500)),
        ScanPriorityMode::Balanced => (10000, Duration::from_millis(1000)),
        ScanPriorityMode::Low => (20000, Duration::from_millis(2000)),
    };
    let throttle = match options.throttle_level {
        ScanThrottleLevel::Off => None,
        ScanThrottleLevel::Low => Some(ThrottleConfig {
            every_entries: 1200,
            sleep_ms: 1,
        }),
        ScanThrottleLevel::Medium => Some(ThrottleConfig {
            every_entries: 600,
            sleep_ms: 3,
        }),
        ScanThrottleLevel::High => Some(ThrottleConfig {
            every_entries: 250,
            sleep_ms: 6,
        }),
    };
    Ok(ScanConfig {
        filters,
        emit_every,
        emit_interval,
        throttle,
        parallelism,
    })
}

fn build_filter_config(filters: &ScanFilters) -> Result<FilterConfig, String> {
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

fn should_emit_progress(processed: u64, last_emit: &Instant, config: &ScanConfig) -> bool {
    if processed % config.emit_every == 0 {
        return true;
    }
    last_emit.elapsed() >= config.emit_interval
}

fn get_path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn compute_disk_usage(path: &Path) -> Result<DiskUsageSnapshot, String> {
    if !path.exists() {
        return Err("path-not-found".to_string());
    }
    let total_bytes =
        fs2::total_space(path).map_err(|error| format!("disk-usage-failed: {error}"))?;
    let free_bytes =
        fs2::available_space(path).map_err(|error| format!("disk-usage-failed: {error}"))?;
    Ok(DiskUsageSnapshot {
        path: get_path_string(path),
        total_bytes,
        free_bytes,
    })
}

fn get_entry_name_string(path: &Path) -> String {
    path.file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| get_path_string(path))
}

fn should_skip_dir(root: &Path, path: &Path, filters: &FilterConfig) -> bool {
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
        Some(get_entry_name_lower(path))
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

fn should_include_file(
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
        if modified.map_or(false, |ts| ts < min_ts) {
            return false;
        }
    }
    if let Some(max_ts) = filters.max_modified_timestamp {
        if modified.map_or(false, |ts| ts > max_ts) {
            return false;
        }
    }
    let path_str = if filters.flags.needs_path {
        Some(path.to_string_lossy().to_lowercase())
    } else {
        None
    };
    let name_str = if filters.flags.needs_name {
        Some(get_entry_name_lower(path))
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

fn resolve_parallelism(priority_mode: &ScanPriorityMode) -> Parallelism {
    let available = thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(1);
    let threads = match priority_mode {
        ScanPriorityMode::Performance => available,
        ScanPriorityMode::Balanced => (available + 1) / 2,
        ScanPriorityMode::Low => 1,
    };
    if threads <= 1 {
        return Parallelism::Serial;
    }
    Parallelism::RayonNewPool(threads)
}

fn matches_regex(value: &str, regex: &Option<Regex>) -> bool {
    regex
        .as_ref()
        .map_or(false, |pattern| pattern.is_match(value))
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

fn parse_runtime_options(
    args: &[String],
    startup_path: Option<String>,
    settings: &AppSettings,
) -> Result<RuntimeOptions, String> {
    let headless = has_flag(args, "--headless")
        || env_flag("DRAGABYTE_HEADLESS")
        || settings.headless.unwrap_or(false);
    let tcp = parse_tcp_config(args, settings)?;
    let updater_enabled = resolve_updater_enabled(args, settings);
    Ok(RuntimeOptions {
        headless,
        tcp,
        startup_path,
        updater_enabled,
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

fn resolve_updater_enabled(args: &[String], settings: &AppSettings) -> bool {
    if has_flag(args, "--disable-updater") || env_flag("DRAGABYTE_DISABLE_UPDATER") {
        return false;
    }
    settings.auto_update.unwrap_or(true)
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

struct RemoteServerHandle {
    shutdown: mpsc::Sender<()>,
    join: thread::JoinHandle<()>,
}

struct RemoteClientHandle {
    sender: mpsc::Sender<String>,
    shutdown: mpsc::Sender<()>,
    join: thread::JoinHandle<()>,
    token: Option<String>,
    address: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteListEntry {
    name: String,
    path: String,
    is_dir: bool,
}

fn start_remote_server(config: TcpConfig, headless: bool) -> Result<RemoteServerHandle, String> {
    eprintln!("[remote] starting tcp server on {}", config.bind_addr);
    let listener = TcpListener::bind(config.bind_addr)
        .map_err(|error| format!("Failed to bind TCP server: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("Failed to configure TCP listener: {error}"))?;
    let (shutdown_tx, shutdown_rx) = mpsc::channel();
    let hub = Arc::new(RemoteHub::new(
        config.token.clone(),
        Some(shutdown_tx.clone()),
    ));
    let join = thread::spawn(move || loop {
        if shutdown_rx.try_recv().is_ok() {
            break;
        }
        match listener.accept() {
            Ok((stream, _)) => {
                if let Ok(clients) = hub.clients.lock() {
                    if clients.len() >= MAX_CONNECTIONS {
                        eprintln!("[remote] connection limit reached, rejecting");
                        continue;
                    }
                }
                eprintln!("[remote] tcp client accepted");
                let hub_clone = Arc::clone(&hub);
                thread::spawn(move || handle_client(stream, hub_clone, headless));
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(50));
            }
            Err(_) => break,
        }
    });
    Ok(RemoteServerHandle {
        shutdown: shutdown_tx,
        join,
    })
}

fn handle_client(stream: TcpStream, hub: Arc<RemoteHub>, headless: bool) {
    eprintln!("[remote] tcp client connected");
    if let Err(error) = stream.set_read_timeout(Some(Duration::from_millis(200))) {
        eprintln!("[remote] set read timeout failed: {error}");
    }
    let (sender, receiver) = mpsc::channel::<String>();
    hub.register_client(sender.clone());
    let writer_stream = match stream.try_clone() {
        Ok(clone) => clone,
        Err(_) => return,
    };
    thread::spawn(move || write_remote_lines(writer_stream, receiver));
    let mut reader = BufReader::new(stream);
    loop {
        let line = match read_secure_line(&mut reader, MAX_LINE_LENGTH) {
            Ok(Some(value)) => {
                eprintln!("[remote] read line bytes={}", value.len());
                value
            }
            Ok(None) => break,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => continue,
            Err(error) if error.kind() == std::io::ErrorKind::TimedOut => continue,
            Err(error) => {
                eprintln!("[remote] read line error: {error}");
                break;
            }
        };
        if line.trim().is_empty() {
            eprintln!("[remote] read empty line");
            continue;
        }
        handle_remote_line(&line, Arc::clone(&hub), &sender, headless);
    }
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

fn handle_remote_line(
    line: &str,
    hub: Arc<RemoteHub>,
    sender: &mpsc::Sender<String>,
    headless: bool,
) {
    // Security: Do not log incoming lines as they may contain auth tokens
    let envelope: RemoteEnvelope = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(_) => {
            eprintln!("[remote] invalid json");
            send_remote_error(sender, None, "invalid_json");
            return;
        }
    };
    if !hub.validate_token(envelope.token.as_deref()) {
        eprintln!("[remote] unauthorized token");
        // Security: Artificial delay to impede brute-force attacks
        thread::sleep(Duration::from_secs(2));
        send_remote_error(sender, request_id(&envelope.request), "unauthorized");
        return;
    }
    match envelope.request {
        RemoteRequest::Ping { id } => {
            eprintln!("[remote] ping {:?}", id);
            send_remote_event(sender, serde_json::json!({ "event": "pong", "id": id }));
        }
        RemoteRequest::List { id, path } => {
            eprintln!("[remote] list {:?} {:?}", id, path);
            handle_remote_list(sender, id, path);
        }
        RemoteRequest::Disk { id, path } => {
            eprintln!("[remote] disk {:?} {}", id, path);
            handle_remote_disk(sender, id, path);
        }
        RemoteRequest::Read { id, path } => {
            eprintln!("[remote] read {:?} {}", id, path);
            handle_remote_read(sender, id, path);
        }
        RemoteRequest::Scan { id, path, options } => {
            eprintln!("[remote] scan {:?} {}", id, path);
            handle_remote_scan(hub, sender, id, path, options);
        }
        RemoteRequest::Cancel { id } => {
            eprintln!("[remote] cancel {:?}", id);
            let cancelled = hub.cancel_scan();
            let message = if cancelled {
                "cancel-requested"
            } else {
                "no-active-scan"
            };
            send_remote_event(sender, serde_json::json!({ "event": message, "id": id }));
        }
        RemoteRequest::Shutdown { id } => {
            eprintln!("[remote] shutdown {:?}", id);
            if !headless {
                send_remote_error(sender, id.as_deref(), "shutdown-not-allowed");
                return;
            }
            if hub.request_shutdown() {
                send_remote_event(sender, serde_json::json!({ "event": "shutdown", "id": id }));
            } else {
                send_remote_error(sender, id.as_deref(), "shutdown-failed");
            }
        }
    }
}

fn handle_remote_scan(
    hub: Arc<RemoteHub>,
    sender: &mpsc::Sender<String>,
    id: Option<String>,
    path: String,
    options: Option<ScanOptions>,
) {
    let root = PathBuf::from(&path);
    if !root.exists() {
        send_remote_error(sender, id.as_deref(), "path-not-found");
        return;
    }
    let config = match build_scan_config(&options.unwrap_or_default()) {
        Ok(value) => value,
        Err(error) => {
            send_remote_error(sender, id.as_deref(), &error);
            return;
        }
    };
    let cancel_flag = Arc::new(AtomicBool::new(false));
    if !hub.start_scan(Arc::clone(&cancel_flag)) {
        send_remote_error(sender, id.as_deref(), "scan-in-progress");
        return;
    }
    send_remote_event(
        sender,
        serde_json::json!({ "event": "scan-started", "id": id }),
    );
    let hub_for_scan = Arc::clone(&hub);
    let request_id = id.clone();
    thread::spawn(move || {
        let hub_ref = Arc::clone(&hub_for_scan);
        let request_id_for_emit = request_id.clone();
        let emitter_hub = Arc::clone(&hub_ref);
        let emitter: ScanEmitter = Arc::new(move |event| {
            emit_to_remote(&emitter_hub, event, request_id_for_emit.as_deref());
        });
        if let Err(error) = run_scan(root, config, Arc::clone(&cancel_flag), emitter, id.clone()) {
            emit_to_remote(&hub_ref, ScanEvent::Error(error), request_id.as_deref());
        }
        hub_ref.finish_scan();
    });
}

fn handle_remote_disk(sender: &mpsc::Sender<String>, id: Option<String>, path: String) {
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

fn handle_remote_read(sender: &mpsc::Sender<String>, id: Option<String>, path: String) {
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
    match fs::read(&target) {
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

fn handle_remote_list(sender: &mpsc::Sender<String>, id: Option<String>, path: Option<String>) {
    eprintln!("[remote] handle list {:?} {:?}", id, path);
    let target = resolve_list_target(path.as_deref());
    let (entries, list_path) = match target {
        Ok(value) => value,
        Err(message) => {
            eprintln!("[remote] list error {:?}", message);
            send_remote_event(
                sender,
                serde_json::json!({ "event": "list-error", "id": id, "message": message }),
            );
            return;
        }
    };
    eprintln!("[remote] list ok {:?} entries={}", list_path, entries.len());
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
        let entry = match entry {
            Ok(value) => value,
            Err(error) => {
                eprintln!("[remote] list entry error: {error}");
                continue;
            }
        };
        let entry_path = entry.path();
        let is_dir = entry
            .file_type()
            .map(|value| value.is_dir())
            .unwrap_or(false);
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

fn send_remote_event(sender: &mpsc::Sender<String>, value: serde_json::Value) {
    let _ = sender.send(format!("{}\n", value));
}

fn send_remote_error(sender: &mpsc::Sender<String>, id: Option<&str>, message: &str) {
    send_remote_event(
        sender,
        serde_json::json!({ "event": "error", "id": id, "message": message }),
    );
}

fn request_id(request: &RemoteRequest) -> Option<&str> {
    match request {
        RemoteRequest::Ping { id }
        | RemoteRequest::List { id, .. }
        | RemoteRequest::Disk { id, .. }
        | RemoteRequest::Read { id, .. }
        | RemoteRequest::Scan { id, .. }
        | RemoteRequest::Cancel { id }
        | RemoteRequest::Shutdown { id } => id.as_deref(),
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

fn stop_remote_server(handle: RemoteServerHandle) {
    let _ = handle.shutdown.send(());
    let _ = handle.join.join();
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
        loop {
            if shutdown_rx.try_recv().is_ok() {
                break;
            }
            match read_secure_line(&mut reader, MAX_LINE_LENGTH) {
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

fn get_entry_name_lower(path: &Path) -> String {
    get_entry_name_string(path).to_lowercase()
}

fn resolve_launch_context(args: &[String]) -> LaunchContext {
    let mut path = None;
    let mut paths = Vec::new();
    let mut mode = "scan".to_string();

    for arg in args.iter().skip(1) {
        if arg == "--rename" {
            mode = "rename".to_string();
        } else if !arg.starts_with('-') && path.is_none() {
            if Path::new(arg).exists() {
                path = Some(arg.clone());
            }
        } else if !arg.starts_with('-') {
            if Path::new(arg).exists() {
                paths.push(arg.clone());
            }
        }
    }

    if path.is_none() && !paths.is_empty() {
        path = Some(paths[0].clone());
    } else if let Some(value) = path.clone() {
        if !paths.contains(&value) {
            paths.insert(0, value.clone());
        }
    }

    LaunchContext { path, paths, mode }
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
    if key_path.contains("Background") {
        return cmd_lower.contains("%v") || cmd_lower.contains("%1");
    }
    cmd_lower.contains("%1") || cmd_lower.contains("%*")
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
            "Software\\Classes\\Directory\\shell\\DragabyteRename",
            "Software\\Classes\\Drive\\shell\\DragabyteRename",
            "Software\\Classes\\directory\\Background\\shell\\DragabyteRename",
            "Software\\Classes\\*\\shell\\DragabyteRename",
        ];
        scan_keys
            .iter()
            .all(|key_path| is_context_menu_key_valid(&hkcu, key_path, exe_str))
            && rename_keys
                .iter()
                .all(|key_path| is_context_menu_key_valid(&hkcu, key_path, exe_str))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = match std::env::var("HOME") {
            Ok(val) => val,
            Err(_) => return false,
        };
        let desktop_file = PathBuf::from(home)
            .join(".local/share/applications/dragabyte.desktop");
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
            "Software\\Classes\\Directory\\shell\\DragabyteRename",
            "Software\\Classes\\Drive\\shell\\DragabyteRename",
            "Software\\Classes\\directory\\Background\\shell\\DragabyteRename",
            "Software\\Classes\\*\\shell\\DragabyteRename",
        ];

        if _enable {
            let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
            let exe_str = exe_path.to_str().ok_or("Invalid path")?;
            let scan_cmd = format!("\"{}\" \"%1\"", exe_str);
            let rename_cmd = format!("\"{}\" --rename %*", exe_str);

            for key_path in scan_keys {
                let (key, _) = hkcu.create_subkey(key_path).map_err(|e| e.to_string())?;
                key.set_value("", &"Scan with Dragabyte")
                    .map_err(|e| e.to_string())?;
                key.set_value("Icon", &exe_str).map_err(|e| e.to_string())?;

                let (cmd_key, _) = key.create_subkey("command").map_err(|e| e.to_string())?;

                let cmd_val = if key_path.contains("Background") {
                    format!("\"{}\" \"%V\"", exe_str)
                } else {
                    scan_cmd.clone()
                };

                cmd_key.set_value("", &cmd_val).map_err(|e| e.to_string())?;

            }

            for key_path in rename_keys {
                let (r_key, _) = hkcu
                    .create_subkey(key_path)
                    .map_err(|e| e.to_string())?;
                r_key
                    .set_value("", &"Rename with Dragabyte")
                    .map_err(|e| e.to_string())?;
                r_key.set_value("Icon", &exe_str).map_err(|e| e.to_string())?;
                let _ = r_key.set_value("MultiSelectModel", &"Player");

                let (r_cmd_key, _) = r_key
                    .create_subkey("command")
                    .map_err(|e| e.to_string())?;
                let r_cmd_val = if key_path.contains("Background") {
                    format!("\"{}\" --rename \"%V\"", exe_str)
                } else {
                    rename_cmd.clone()
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
        if target.is_file() {
            let select_arg = format!("/select,\"{}\"", path);
            Command::new("explorer")
                .arg(select_arg)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            Command::new("explorer")
                .arg(&path)
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

fn build_summary(
    root: &Path,
    children: &HashMap<PathBuf, Vec<PathBuf>>,
    files_by_parent: &HashMap<PathBuf, Vec<ScanFile>>,
    stats: &HashMap<PathBuf, NodeStats>,
    largest_files: &[ScanFile],
    start: Instant,
    scan_id: Option<String>,
    compact: bool,
    sort_by_size: bool,
    max_children: Option<usize>,
) -> ScanSummary {
    let (max_depth, max_files) = if compact {
        (Some(1), Some(0))
    } else {
        (None, None)
    };
    let root_node = build_node(
        root,
        children,
        files_by_parent,
        stats,
        0,
        max_depth,
        max_files,
        sort_by_size,
        max_children,
    );
    ScanSummary {
        id: scan_id,
        total_bytes: root_node.size_bytes,
        file_count: root_node.file_count,
        dir_count: root_node.dir_count,
        root: root_node,
        largest_files: largest_files.to_vec(),
        duration_ms: start.elapsed().as_millis(),
    }
}

fn update_largest_files(
    largest_files: &mut Vec<ScanFile>,
    path: &Path,
    size_bytes: u64,
    modified: Option<u64>,
    limit: usize,
) {
    if size_bytes == 0 {
        return;
    }
    let name = get_entry_name_string(path);
    if largest_files.len() < limit {
        largest_files.push(ScanFile {
            path: get_path_string(path),
            name,
            size_bytes,
            modified,
        });
        largest_files.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
        return;
    }
    let smallest = largest_files
        .last()
        .map(|file| file.size_bytes)
        .unwrap_or(0);
    if size_bytes <= smallest {
        return;
    }
    largest_files.push(ScanFile {
        path: get_path_string(path),
        name,
        size_bytes,
        modified,
    });
    largest_files.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    largest_files.truncate(limit);
}

fn build_node(
    path: &Path,
    children: &HashMap<PathBuf, Vec<PathBuf>>,
    files_by_parent: &HashMap<PathBuf, Vec<ScanFile>>,
    stats: &HashMap<PathBuf, NodeStats>,
    depth: usize,
    max_depth: Option<usize>,
    max_files: Option<usize>,
    sort_by_size: bool,
    max_children: Option<usize>,
) -> ScanNode {
    let mut size_bytes = 0;
    let mut file_count = 0;
    let mut dir_count = 0;
    let mut nodes: Vec<ScanNode> = Vec::new();

    if let Some(stats) = stats.get(path) {
        size_bytes += stats.direct_bytes;
        file_count += stats.direct_files;
    }

    if let Some(children_paths) = children.get(path) {
        for child in children_paths {
            let child_node = build_node(
                child,
                children,
                files_by_parent,
                stats,
                depth + 1,
                max_depth,
                max_files,
                sort_by_size,
                max_children,
            );
            size_bytes += child_node.size_bytes;
            file_count += child_node.file_count;
            dir_count += 1 + child_node.dir_count;

            if max_depth.map_or(true, |max| depth < max) {
                nodes.push(child_node);
            }
        }
    }

    if sort_by_size {
        nodes.sort_by(|a, b| {
            b.size_bytes
                .cmp(&a.size_bytes)
                .then_with(|| a.name.cmp(&b.name))
        });
    } else {
        nodes.sort_by(|a, b| a.name.cmp(&b.name));
    }
    if let Some(limit) = max_children {
        if nodes.len() > limit {
            nodes.truncate(limit);
        }
    }

    let mut files = files_by_parent.get(path).cloned().unwrap_or_default();
    if let Some(limit) = max_files {
        if files.len() > limit {
            files.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
            files.truncate(limit);
        }
    }

    ScanNode {
        path: get_path_string(path),
        name: get_entry_name_string(path),
        size_bytes,
        file_count,
        dir_count,
        files,
        children: nodes,
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

fn spawn_headless_updater(app: tauri::AppHandle, enabled: bool) {
    if !enabled {
        eprintln!("[updater] headless updates disabled");
        return;
    }
    tauri::async_runtime::spawn(async move {
        let updater = match app.updater() {
            Ok(value) => value,
            Err(error) => {
                eprintln!("[updater] init failed: {error}");
                return;
            }
        };
        match updater.check().await {
            Ok(Some(update)) => {
                eprintln!(
                    "[updater] update {} -> {}",
                    update.current_version, update.version
                );
                if let Err(error) = update.download_and_install(|_, _| {}, || {}).await {
                    eprintln!("[updater] install failed: {error}");
                } else {
                    eprintln!("[updater] update installed");
                }
            }
            Ok(None) => {
                eprintln!("[updater] no updates available");
            }
            Err(error) => {
                eprintln!("[updater] check failed: {error}");
            }
        }
    });
}

fn read_secure_line<R: BufRead>(reader: &mut R, max_len: u64) -> std::io::Result<Option<String>> {
    let mut line = Vec::new();
    let mut total_read = 0;
    loop {
        let available = reader.fill_buf()?;
        let length = available.len();
        if length == 0 {
            if line.is_empty() {
                return Ok(None);
            }
            break;
        }
        let newline_pos = available.iter().position(|&b| b == b'\n');

        let bytes_to_take = if let Some(pos) = newline_pos {
            pos + 1
        } else {
            length
        };

        if total_read + bytes_to_take as u64 > max_len {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Line too long",
            ));
        }

        line.extend_from_slice(&available[..bytes_to_take]);
        reader.consume(bytes_to_take);
        total_read += bytes_to_take as u64;

        if newline_pos.is_some() {
            break;
        }
    }
    String::from_utf8(line)
        .map(Some)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let launch_context = resolve_launch_context(&args);
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
    let tcp_running = tcp_server.is_some();
    let tcp_bind = if tcp_running {
        runtime_options
            .tcp
            .as_ref()
            .map(|value| value.bind_addr.to_string())
    } else {
        None
    };
    let headless_mode = runtime_options.headless;
    let updater_enabled = runtime_options.updater_enabled;
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    if !headless_mode {
        let window_state_plugin = tauri_plugin_window_state::Builder::default()
            .with_state_flags(StateFlags::POSITION | StateFlags::SIZE)
            .skip_initial_state("main")
            .build();
        builder = builder.plugin(window_state_plugin);
    }

    let startup_path_state = runtime_options.startup_path.clone();
    let launch_context_state = launch_context.clone();

    builder
        .setup(move |app| {
            if headless_mode {
                spawn_headless_updater(app.handle().clone(), updater_enabled);
            }
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
            if !headless_mode {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.restore_state(StateFlags::POSITION | StateFlags::SIZE);
                    ensure_window_bounds(&window);
                    let _ = window.show();
                    let _ = window.set_focus();
                }
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
        stop_remote_server(handle);
    }
}
