#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

use jwalk::{Parallelism, WalkDir};
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_window_state::{StateFlags, WindowExt};

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
  files: Vec<ScanFile>,
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
  let mut files_by_parent: HashMap<PathBuf, Vec<ScanFile>> = HashMap::new();
  let mut largest_files: Vec<ScanFile> = Vec::new();
  let mut last_emit = Instant::now();
  let mut processed: u64 = 0;

  let walk = WalkDir::new(&root).parallelism(config.parallelism.clone());
  for entry in walk {
    if cancel_flag.load(Ordering::Relaxed) {
      let _ = window.emit("scan-cancelled", "Scan cancelled");
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
      let size = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
      if !should_include_file(&entry_path, size, &config.filters) {
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
          });
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

    if should_emit_progress(processed, &last_emit, &config) {
      let summary =
        build_summary(&root, &children, &files_by_parent, &stats, &largest_files, start);
      let _ = window.emit("scan-progress", summary);
      last_emit = Instant::now();
    }
  }

  let summary = build_summary(&root, &children, &files_by_parent, &stats, &largest_files, start);
  let _ = window.emit("scan-complete", summary);
  Ok(())
}

fn build_scan_config(options: &ScanOptions) -> Result<ScanConfig, String> {
  let filters = build_filter_config(&options.filters)?;
  let parallelism = resolve_parallelism(&options.priority_mode);
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
    parallelism,
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
  let has_includes = has_include_extensions
    || has_include_names
    || has_include_paths
    || has_include_regex;
  let has_dir_excludes = has_exclude_paths || has_exclude_names || has_exclude_regex;
  let has_file_excludes = has_dir_excludes || has_exclude_extensions;
  let needs_path = has_exclude_paths || has_include_paths || has_include_regex || has_exclude_regex;
  let needs_name = has_exclude_names || has_include_names;
  let needs_extension = has_include_extensions || has_exclude_extensions;
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

fn get_entry_name_string(path: &Path) -> String {
  path
    .file_name()
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

fn should_include_file(path: &Path, size_bytes: u64, filters: &FilterConfig) -> bool {
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
    path
      .extension()
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
  regex.as_ref().map_or(false, |pattern| pattern.is_match(value))
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
  get_entry_name_string(path).to_lowercase()
}

fn resolve_startup_path(args: &[String]) -> Option<String> {
  let potential_path = args.get(1)?;
  if potential_path.starts_with('-') {
    return None;
  }
  let path = Path::new(potential_path);
  if path.exists() {
    return Some(potential_path.clone());
  }
  None
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
  cmd_lower.contains("%1")
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
    let keys = [
      "Software\\Classes\\Directory\\shell\\Voxara",
      "Software\\Classes\\Drive\\shell\\Voxara",
      "Software\\Classes\\directory\\Background\\shell\\Voxara",
    ];
    keys
      .iter()
      .all(|key_path| is_context_menu_key_valid(&hkcu, key_path, exe_str))
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
      let command_str = format!("\"{}\" \"%1\"", exe_str);

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
        match hkcu.delete_subkey_all(key_path) {
          Ok(_) => {}
          Err(e) => {
             if e.kind() != std::io::ErrorKind::NotFound {
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
  largest_files: &Vec<ScanFile>,
  start: Instant,
) -> ScanSummary {
  let root_node = build_node(root, children, files_by_parent, stats);
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
  let name = get_entry_name_string(path);
  if largest_files.len() < limit {
    largest_files.push(ScanFile {
      path: get_path_string(path),
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
    path: get_path_string(path),
    name,
    size_bytes,
  });
  largest_files.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
  largest_files.truncate(limit);
}

fn build_node(
  path: &Path,
  children: &HashMap<PathBuf, Vec<PathBuf>>,
  files_by_parent: &HashMap<PathBuf, Vec<ScanFile>>,
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
      let child_node = build_node(child, children, files_by_parent, stats);
      size_bytes += child_node.size_bytes;
      file_count += child_node.file_count;
      dir_count += 1 + child_node.dir_count;
      nodes.push(child_node);
    }
  }

  nodes.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
  let files = files_by_parent.get(path).cloned().unwrap_or_default();

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

fn main() {
  let args: Vec<String> = std::env::args().collect();
  let startup_path = resolve_startup_path(&args);
  let is_context_menu_launch = startup_path.is_some();
  let mut builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());

  if !is_context_menu_launch {
    let window_state_plugin = tauri_plugin_window_state::Builder::default()
      .with_state_flags(StateFlags::POSITION | StateFlags::SIZE)
      .skip_initial_state("main")
      .build();
    builder = builder.plugin(window_state_plugin);
  }

  let startup_path_state = startup_path.clone();

  builder
    .setup(move |app| {
      if startup_path_state.is_some() {
        #[cfg(target_os = "windows")]
        hide_console_window();
      }
      app.manage(StartupPath(Mutex::new(startup_path_state.clone())));
      app.manage(ScanCancellation(Mutex::new(HashMap::new())));
      if !is_context_menu_launch {
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
      is_context_menu_enabled,
      toggle_context_menu,
      get_startup_path,
      open_path,
      show_in_explorer
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
