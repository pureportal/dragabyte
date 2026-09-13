mod filters;
mod options;
mod progress;
mod reader;
mod types;

pub use options::{ScanFilters, ScanOptions, ScanPriorityMode, ScanThrottleLevel};
pub use types::{
    DiscoveredFile, ScanEmitter, ScanEvent, ScanFailure, ScanFile, ScanFolder, ScanState,
    ScanUpdate,
};

use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use filters::{build_filter_config, FilterConfig};
use progress::ScanProgress;
use reader::{read_directory, DirectoryJob, Entry, ReadResult};

struct ThrottleConfig {
    every_entries: u64,
    delay: Duration,
}

pub struct ScanConfig {
    filters: FilterConfig,
    emit_interval: Duration,
    throttle: Option<ThrottleConfig>,
    workers: usize,
    entry_path: Option<PathBuf>,
}

impl ScanConfig {
    pub fn for_entry(mut self, path: PathBuf) -> Self {
        self.entry_path = Some(path);
        self
    }

    pub fn with_workers(mut self, workers: usize) -> Result<Self, String> {
        if !(1..=64).contains(&workers) {
            return Err("Worker count must be between 1 and 64.".into());
        }
        self.workers = workers;
        Ok(self)
    }
}

pub fn build_scan_config(options: &ScanOptions) -> Result<ScanConfig, String> {
    let available = thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(1);
    let workers = match options.priority_mode {
        ScanPriorityMode::Performance => available.min(16),
        ScanPriorityMode::Balanced => available.div_ceil(2).min(8),
        ScanPriorityMode::Low => 1,
    };
    let emit_interval = match options.priority_mode {
        ScanPriorityMode::Low => Duration::from_millis(250),
        _ => Duration::from_millis(100),
    };
    let throttle = match options.throttle_level {
        ScanThrottleLevel::Off => None,
        ScanThrottleLevel::Low => Some((1200, 1)),
        ScanThrottleLevel::Medium => Some((600, 3)),
        ScanThrottleLevel::High => Some((250, 6)),
    }
    .map(|(every_entries, delay)| ThrottleConfig {
        every_entries,
        delay: Duration::from_millis(delay),
    });
    Ok(ScanConfig {
        filters: build_filter_config(&options.filters)?,
        emit_interval,
        throttle,
        workers,
        entry_path: None,
    })
}

pub fn run_scan(
    root: PathBuf,
    config: ScanConfig,
    cancel: Arc<AtomicBool>,
    emit: ScanEmitter,
    id: Option<String>,
) -> Result<(), String> {
    if config.entry_path.is_none() && !root.is_dir() {
        return Err("Select a folder that exists and can be read.".into());
    }
    let mut pending = VecDeque::new();
    let mut progress = if let Some(path) = &config.entry_path {
        let parent = path
            .parent()
            .ok_or("The scan entry must have a parent folder.")?;
        let mut progress = ScanProgress::new(parent, id);
        let excluded = path
            .ancestors()
            .take_while(|ancestor| *ancestor != root)
            .any(|ancestor| {
                ancestor.is_dir() && filters::should_skip_dir(&root, ancestor, &config.filters)
            });
        if !excluded {
            let entry = match reader::read_path(path, &root, &config) {
                Ok(entry) => entry,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(error) => return Err(error.to_string()),
            };
            match entry {
                Some(Entry::Folder(path)) => {
                    let id = progress.add_folder(Some(0), &path);
                    progress.add_totals(0, 0, 0, 1, 0);
                    pending.push_back(DirectoryJob { id, path });
                }
                Some(Entry::File(file)) => {
                    progress.add_totals(0, file.size_bytes, 1, 0, 0);
                    progress.add_file(0, file);
                }
                None => {}
            }
        }
        progress.finish_folder(0);
        progress
    } else {
        pending.push_back(DirectoryJob {
            id: 0,
            path: root.clone(),
        });
        ScanProgress::new(&root, id)
    };
    emit(ScanEvent::Progress(progress.take_update()));
    let (job_sender, job_receiver) = mpsc::channel::<DirectoryJob>();
    let jobs = Mutex::new(job_receiver);
    let (result_sender, result_receiver) = mpsc::sync_channel(config.workers * 2);
    thread::scope(|scope| {
        for _ in 0..config.workers {
            let jobs = &jobs;
            let sender = result_sender.clone();
            let root = &root;
            let config = &config;
            let cancel = &cancel;
            scope.spawn(move || {
                let mut processed = 0;
                loop {
                    let job = match jobs.lock().unwrap().recv() {
                        Ok(job) => job,
                        Err(_) => break,
                    };
                    if cancel.load(Ordering::Relaxed) {
                        break;
                    }
                    read_directory(job, root, config, cancel, &sender, &mut processed);
                }
            });
        }
        drop(result_sender);
        let mut active = 0;
        let mut last_emit = Instant::now();
        let mut first_entries = true;
        let result = loop {
            if cancel.load(Ordering::Relaxed) {
                progress.cancel();
                emit(ScanEvent::Cancelled(progress.take_update()));
                break Ok(());
            }
            while active < config.workers {
                let Some(job) = pending.pop_front() else {
                    break;
                };
                if job_sender.send(job).is_err() {
                    break;
                }
                active += 1;
            }
            if active == 0 && pending.is_empty() {
                emit(ScanEvent::Complete(progress.take_update()));
                break Ok(());
            }
            match result_receiver.recv_timeout(Duration::from_millis(25)) {
                Ok(ReadResult::Entries {
                    parent,
                    entries,
                    skipped,
                }) => {
                    let mut bytes = 0;
                    let mut files = 0;
                    let mut dirs = 0;
                    for entry in entries {
                        match entry {
                            Entry::Folder(path) => {
                                let id = progress.add_folder(Some(parent), &path);
                                pending.push_back(DirectoryJob { id, path });
                                dirs += 1;
                            }
                            Entry::File(file) => {
                                bytes += file.size_bytes;
                                files += 1;
                                progress.add_file(parent, file);
                            }
                        }
                    }
                    progress.add_totals(parent, bytes, files, dirs, skipped);
                }
                Ok(ReadResult::Finished(id)) => {
                    active -= 1;
                    progress.finish_folder(id);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    break Err("Scanning stopped unexpectedly. Scan the folder again.".into())
                }
            }
            if active == 0 && pending.is_empty() {
                continue;
            }
            if (first_entries && progress.pending_entries() > 0)
                || progress.pending_entries() >= 1024
                || last_emit.elapsed() >= config.emit_interval
            {
                emit(ScanEvent::Progress(progress.take_update()));
                first_entries = false;
                last_emit = Instant::now();
            }
        };
        drop(job_sender);
        drop(result_receiver);
        result
    })
}

fn get_entry_name_string(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod change_tests;
#[cfg(test)]
mod tests;
