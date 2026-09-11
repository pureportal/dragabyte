use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::SyncSender,
    },
    thread,
    time::{Duration, Instant, SystemTime},
};

use super::{
    filters::{should_include_file, should_skip_dir},
    get_entry_name_string,
    types::ScanFile,
    ScanConfig,
};

pub(super) struct DirectoryJob {
    pub(super) id: usize,
    pub(super) path: PathBuf,
}

pub(super) enum Entry {
    Folder(PathBuf),
    File(ScanFile),
}

pub(super) enum ReadResult {
    Entries {
        parent: usize,
        entries: Vec<Entry>,
        skipped: u64,
    },
    Finished(usize),
}

pub(super) fn read_directory(
    job: DirectoryJob,
    root: &Path,
    config: &ScanConfig,
    cancel: &AtomicBool,
    sender: &SyncSender<ReadResult>,
    processed: &mut u64,
) {
    let mut entries = Vec::with_capacity(256);
    let mut skipped = 0;
    let mut last_send = Instant::now();
    match fs::read_dir(&job.path) {
        Ok(directory) => {
            for result in directory {
                if cancel.load(Ordering::Relaxed) {
                    return;
                }
                match result.and_then(|entry| read_entry(entry, root, config)) {
                    Ok(Some(entry)) => entries.push(entry),
                    Ok(None) => {}
                    Err(_) => skipped += 1,
                }
                *processed += 1;
                if let Some(throttle) = &config.throttle {
                    if (*processed).is_multiple_of(throttle.every_entries) {
                        thread::sleep(throttle.delay * config.workers as u32);
                    }
                }
                if entries.len() >= 256 || last_send.elapsed() >= Duration::from_millis(25) {
                    if sender
                        .send(ReadResult::Entries {
                            parent: job.id,
                            entries: std::mem::take(&mut entries),
                            skipped,
                        })
                        .is_err()
                    {
                        return;
                    }
                    skipped = 0;
                    last_send = Instant::now();
                }
            }
        }
        Err(_) => skipped += 1,
    }
    if (!entries.is_empty() || skipped > 0)
        && sender
            .send(ReadResult::Entries {
                parent: job.id,
                entries,
                skipped,
            })
            .is_err()
    {
        return;
    }
    let _ = sender.send(ReadResult::Finished(job.id));
}

fn read_entry(
    entry: fs::DirEntry,
    root: &Path,
    config: &ScanConfig,
) -> std::io::Result<Option<Entry>> {
    let file_type = entry.file_type()?;
    let path = entry.path();
    if file_type.is_dir() {
        return Ok((!should_skip_dir(root, &path, &config.filters)).then_some(Entry::Folder(path)));
    }
    if !file_type.is_file() {
        return Ok(None);
    }
    let metadata = entry.metadata()?;
    let size_bytes = metadata.len();
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64);
    Ok(
        should_include_file(&path, size_bytes, modified, &config.filters).then(|| {
            Entry::File(ScanFile {
                path: path.to_string_lossy().into_owned(),
                name: get_entry_name_string(&path),
                size_bytes,
                modified,
            })
        }),
    )
}
