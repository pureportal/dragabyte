#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

use jwalk::WalkDir;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri::Emitter;

struct StartupPath(Mutex<Option<String>>);
struct ScanCancellation(Mutex<HashMap<String, Arc<AtomicBool>>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanNode {
  path: String,
  name: String,
  size_bytes: u64,
  file_count: u64,
  dir_count: u64,
  children: Vec<ScanNode>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanFile {
  path: String,
  name: String,
  size_bytes: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanSummary {
  root: ScanNode,
  total_bytes: u64,
  file_count: u64,
  dir_count: u64,
  largest_files: Vec<ScanFile>,
  duration_ms: u128,
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

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScanFilters {
  include_extensions: Vec<String>,
  exclude_extensions: Vec<String>,
  include_names: Vec<String>,
  exclude_names: Vec<String>,
  min_size_bytes: Option<u64>,
  max_size_bytes: Option<u64>,
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

struct FilterConfig {
  include_extensions: HashSet<String>,
  exclude_extensions: HashSet<String>,
  include_names: Vec<String>,
  exclude_names: Vec<String>,
  min_size_bytes: Option<u64>,
  max_size_bytes: Option<u64>,
  include_regex: Option<Regex>,
  exclude_regex: Option<Regex>,
  include_paths: Vec<String>,
  exclude_paths: Vec<String>,
  has_includes: bool,
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
}

#[derive(Default)]
struct NodeStats {
  direct_bytes: u64,
  direct_files: u64,
  direct_dirs: u64,
}

#[tauri::command]
fn get_startup_path(state: tauri::State<StartupPath>) -> Option<String> {
  state.0.lock().unwrap().clone()
}

#[tauri::command]
fn scan_path(
  window: tauri::Window,
  path: String,
  options: ScanOptions,
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

  tauri::async_runtime::spawn(async move {
    let app_handle = window_for_task.app_handle();
    if let Err(error) = run_scan(&window_for_task, root, config, Arc::clone(&cancel_flag)) {
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
fn cancel_scan(
  window: tauri::Window,
  state: tauri::State<ScanCancellation>,
) -> Result<(), String> {
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

fn run_scan(
  window: &tauri::Window,
  root: PathBuf,
  config: ScanConfig,
  cancel_flag: Arc<AtomicBool>,
) -> Result<(), String> {
  let start = Instant::now();
  let mut stats: HashMap<PathBuf, NodeStats> = HashMap::new();
  let mut children: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();
  let mut largest_files: Vec<ScanFile> = Vec::new();
  let mut last_emit = Instant::now();
  let mut processed: u64 = 0;

  for entry in WalkDir::new(&root) {
    if cancel_flag.load(Ordering::Relaxed) {
      let _ = window.emit("scan-cancelled", "Scan cancelled");
      return Ok(());
    }
    let entry = match entry {
      Ok(item) => item,
      Err(_) => continue,
    };
    let entry_path = entry.path();
    processed += 1;

    if entry.file_type().is_dir() {
      if should_skip_dir(&root, &entry_path, &config.filters) {
        continue;
      }
      stats.entry(entry_path.to_path_buf()).or_default();
      if let Some(parent) = entry_path.parent() {
        children
          .entry(parent.to_path_buf())
          .or_default()
          .push(entry_path.to_path_buf());
        stats.entry(parent.to_path_buf()).or_default().direct_dirs += 1;
      }
    } else if entry.file_type().is_file() {
      let size = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
      if !should_include_file(&entry_path, size, &config.filters) {
        continue;
      }
      update_largest_files(&mut largest_files, &entry_path, size, 10);
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

    if should_emit_progress(processed, last_emit, &config) {
      let summary = build_summary(&root, &children, &stats, &largest_files, start);
      let _ = window.emit("scan-progress", summary);
      last_emit = Instant::now();
    }
  }

  let summary = build_summary(&root, &children, &stats, &largest_files, start);
  let _ = window.emit("scan-complete", summary);
  Ok(())
}

fn build_scan_config(options: &ScanOptions) -> Result<ScanConfig, String> {
  let filters = build_filter_config(&options.filters)?;
  let (emit_every, emit_interval) = match options.priority_mode {
    ScanPriorityMode::Performance => (1200, Duration::from_millis(160)),
    ScanPriorityMode::Balanced => (2000, Duration::from_millis(250)),
    ScanPriorityMode::Low => (3200, Duration::from_millis(360)),
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
  })
}

fn build_filter_config(filters: &ScanFilters) -> Result<FilterConfig, String> {
  if let (Some(min), Some(max)) = (filters.min_size_bytes, filters.max_size_bytes) {
    if min > max {
      return Err("Min size cannot exceed max size".to_string());
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
  let include_names = normalize_terms(&filters.include_names);
  let exclude_names = normalize_terms(&filters.exclude_names);
  let include_paths = normalize_paths(&filters.include_paths);
  let exclude_paths = normalize_paths(&filters.exclude_paths);
  let has_includes = !include_extensions.is_empty()
    || include_regex.is_some()
    || !include_paths.is_empty()
    || !include_names.is_empty();
  Ok(FilterConfig {
    include_extensions,
    exclude_extensions,
    include_names,
    exclude_names,
    min_size_bytes: filters.min_size_bytes,
    max_size_bytes: filters.max_size_bytes,
    include_regex,
    exclude_regex,
    include_paths,
    exclude_paths,
    has_includes,
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

fn normalize_paths(values: &[String]) -> Vec<String> {
  let mut list = Vec::new();
  for value in values {
    let cleaned = value.trim().to_lowercase();
    if !cleaned.is_empty() {
      list.push(cleaned);
    }
  }
  list
}

fn normalize_terms(values: &[String]) -> Vec<String> {
  let mut list = Vec::new();
  for value in values {
    let cleaned = value.trim().to_lowercase();
    if !cleaned.is_empty() {
      list.push(cleaned);
    }
  }
  list
}

fn should_emit_progress(processed: u64, last_emit: Instant, config: &ScanConfig) -> bool {
  if processed % config.emit_every == 0 {
    return true;
  }
  last_emit.elapsed() >= config.emit_interval
}

fn should_skip_dir(root: &Path, path: &Path, filters: &FilterConfig) -> bool {
  if path == root {
    return false;
  }
  let path_str = path.to_string_lossy().to_lowercase();
  let name_str = get_entry_name_lower(path);
  if matches_regex(&path_str, &filters.exclude_regex) {
    return true;
  }
  if path_contains_any(&name_str, &filters.exclude_names) {
    return true;
  }
  path_contains_any(&path_str, &filters.exclude_paths)
}

fn should_include_file(path: &Path, size_bytes: u64, filters: &FilterConfig) -> bool {
  let path_str = path.to_string_lossy().to_lowercase();
  let name_str = get_entry_name_lower(path);
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
  if matches_regex(&path_str, &filters.exclude_regex) {
    return false;
  }
  if path_contains_any(&path_str, &filters.exclude_paths) {
    return false;
  }
  if path_contains_any(&name_str, &filters.exclude_names) {
    return false;
  }
  if let Some(ext) = path.extension().and_then(|value| value.to_str()) {
    if filters.exclude_extensions.contains(&ext.to_lowercase()) {
      return false;
    }
  }

  if !filters.has_includes {
    return true;
  }

  if matches_regex(&path_str, &filters.include_regex) {
    return true;
  }
  if path_contains_any(&path_str, &filters.include_paths) {
    return true;
  }
  if path_contains_any(&name_str, &filters.include_names) {
    return true;
  }
  if let Some(ext) = path.extension().and_then(|value| value.to_str()) {
    return filters.include_extensions.contains(&ext.to_lowercase());
  }

  false
}

fn matches_regex(value: &str, regex: &Option<Regex>) -> bool {
  match regex {
    Some(pattern) => pattern.is_match(value),
    None => false,
  }
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

fn get_entry_name_lower(path: &Path) -> String {
  path
    .file_name()
    .map(|value| value.to_string_lossy().to_string().to_lowercase())
    .unwrap_or_else(|| path.to_string_lossy().to_string().to_lowercase())
}

#[tauri::command]
fn is_context_menu_enabled() -> bool {
  #[cfg(target_os = "windows")]
  {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    // Checking Directory key as primary
    let path = "Software\\Classes\\Directory\\shell\\Voxara";
    hkcu.open_subkey(path).is_ok()
  }
  #[cfg(not(target_os = "windows"))]
  false
}

#[tauri::command]
fn toggle_context_menu(enable: bool) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let keys = [
      "Software\\Classes\\Directory\\shell\\Voxara",
      "Software\\Classes\\Drive\\shell\\Voxara",
      "Software\\Classes\\directory\\Background\\shell\\Voxara",
    ];

    if enable {
      let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
      let exe_str = exe_path.to_str().ok_or("Invalid path")?;
      // For directories/drives, %1 is the path.
      // For background, %V is normally working directory or we use "open directory" logic.
      // Usually %1 works fine for Drive/Directory.
      // Need to be careful about quoting.
      let command_str = format!("\"{}\" \"%1\"", exe_str);
      // For background, passing %V or "." usually implies current directory content.
      // Let's use %V for background just in case, or stick to %1 if simple.
      // Actually common practice for background is %V.

      for key_path in keys {
        let (key, _) = hkcu.create_subkey(key_path).map_err(|e| e.to_string())?;
        key
          .set_value("", &"Scan with Voxara")
          .map_err(|e| e.to_string())?;
        key
          .set_value("Icon", &exe_str)
          .map_err(|e| e.to_string())?;

        let (cmd_key, _) = key.create_subkey("command").map_err(|e| e.to_string())?;

        let cmd_val = if key_path.contains("Background") {
             format!("\"{}\" \"%V\"", exe_str)
        } else {
             command_str.clone()
        };

        cmd_key
          .set_value("", &cmd_val)
          .map_err(|e| e.to_string())?;
      }
    } else {
      for key_path in keys {
        // Best effort deletion
        match hkcu.delete_subkey_all(key_path) {
          Ok(_) => {}
          Err(e) => {
             // Ignore not found
             if e.kind() != std::io::ErrorKind::NotFound {
               // Log but don't fail immediately, try others?
               // For now, simplify to just try next
             }
          }
        }
      }
    }
    Ok(())
  }
  #[cfg(not(target_os = "windows"))]
  Ok(())
}

fn build_summary(
  root: &Path,
  children: &HashMap<PathBuf, Vec<PathBuf>>,
  stats: &HashMap<PathBuf, NodeStats>,
  largest_files: &Vec<ScanFile>,
  start: Instant,
) -> ScanSummary {
  let root_node = build_node(root, children, stats);
  ScanSummary {
    total_bytes: root_node.size_bytes,
    file_count: root_node.file_count,
    dir_count: root_node.dir_count,
    root: root_node,
    largest_files: largest_files.clone(),
    duration_ms: start.elapsed().as_millis(),
  }
}

fn update_largest_files(
  largest_files: &mut Vec<ScanFile>,
  path: &Path,
  size_bytes: u64,
  limit: usize,
) {
  if size_bytes == 0 {
    return;
  }
  let name = path
    .file_name()
    .map(|value| value.to_string_lossy().to_string())
    .unwrap_or_else(|| path.to_string_lossy().to_string());
  if largest_files.len() < limit {
    largest_files.push(ScanFile {
      path: path.to_string_lossy().to_string(),
      name,
      size_bytes,
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
    path: path.to_string_lossy().to_string(),
    name,
    size_bytes,
  });
  largest_files.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
  largest_files.truncate(limit);
}

fn build_node(
  path: &Path,
  children: &HashMap<PathBuf, Vec<PathBuf>>,
  stats: &HashMap<PathBuf, NodeStats>,
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
      let child_node = build_node(child, children, stats);
      size_bytes += child_node.size_bytes;
      file_count += child_node.file_count;
      dir_count += 1 + child_node.dir_count;
      nodes.push(child_node);
    }
  }

  nodes.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));

  ScanNode {
    path: path.to_string_lossy().to_string(),
    name: path
      .file_name()
      .map(|value| value.to_string_lossy().to_string())
      .unwrap_or_else(|| path.to_string_lossy().to_string()),
    size_bytes,
    file_count,
    dir_count,
    children: nodes,
  }
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      let mut startup_path = None;
      let args: Vec<String> = std::env::args().collect();
      // args[0] is executable. If index 1 exists and is not a flag, treat as path.
      if args.len() > 1 {
         let potential_path = &args[1];
         // Simple check: ignore if starts with '-' or '--' (flags)
         if !potential_path.starts_with("-") {
           // Verify it exists?
           let p = std::path::Path::new(potential_path);
           if p.exists() {
             startup_path = Some(potential_path.clone());
           }
         }
      }
      app.manage(StartupPath(Mutex::new(startup_path)));
      app.manage(ScanCancellation(Mutex::new(HashMap::new())));
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      scan_path,
      cancel_scan,
      is_context_menu_enabled,
      toggle_context_menu,
      get_startup_path
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
