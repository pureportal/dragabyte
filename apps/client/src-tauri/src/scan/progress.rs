use std::{collections::HashSet, path::Path, time::Instant};

use super::{get_entry_name_string, types::*};

struct FolderProgress {
    folder: ScanFolder,
    read_finished: bool,
    pending_children: usize,
    incomplete: bool,
}

pub(super) struct ScanProgress {
    folders: Vec<FolderProgress>,
    changed: HashSet<usize>,
    files: Vec<DiscoveredFile>,
    largest_files: Vec<ScanFile>,
    skipped_entries: u64,
    sequence: u64,
    start: Instant,
    id: Option<String>,
}

impl ScanProgress {
    pub(super) fn new(root: &Path, id: Option<String>) -> Self {
        let mut progress = Self {
            folders: Vec::new(),
            changed: HashSet::new(),
            files: Vec::new(),
            largest_files: Vec::new(),
            skipped_entries: 0,
            sequence: 0,
            start: Instant::now(),
            id,
        };
        progress.add_folder(None, root);
        progress
    }

    pub(super) fn add_folder(&mut self, parent_id: Option<usize>, path: &Path) -> usize {
        let id = self.folders.len();
        self.folders.push(FolderProgress {
            folder: ScanFolder {
                id,
                parent_id,
                path: path.to_string_lossy().into_owned(),
                name: get_entry_name_string(path),
                size_bytes: 0,
                file_count: 0,
                dir_count: 0,
                state: ScanState::Scanning,
                read_state: ScanState::Scanning,
                skipped_entries: 0,
            },
            read_finished: false,
            pending_children: 0,
            incomplete: false,
        });
        self.changed.insert(id);
        if let Some(parent) = parent_id {
            self.folders[parent].pending_children += 1;
        }
        id
    }

    pub(super) fn add_file(&mut self, parent_id: usize, file: ScanFile) {
        let largest = &mut self.largest_files;
        if file.size_bytes > 0
            && (largest.len() < 100 || file.size_bytes > largest.last().unwrap().size_bytes)
        {
            let index = largest.partition_point(|entry| entry.size_bytes >= file.size_bytes);
            largest.insert(index, file.clone());
            largest.truncate(100);
        }
        self.files.push(DiscoveredFile { parent_id, file });
    }

    pub(super) fn add_totals(
        &mut self,
        id: usize,
        bytes: u64,
        files: u64,
        dirs: u64,
        skipped: u64,
    ) {
        self.skipped_entries += skipped;
        self.folders[id].folder.skipped_entries += skipped;
        let mut current = Some(id);
        while let Some(index) = current {
            let progress = &mut self.folders[index];
            progress.folder.size_bytes += bytes;
            progress.folder.file_count += files;
            progress.folder.dir_count += dirs;
            progress.incomplete |= skipped > 0;
            current = progress.folder.parent_id;
            self.changed.insert(index);
        }
    }

    pub(super) fn finish_folder(&mut self, id: usize) {
        self.folders[id].read_finished = true;
        self.folders[id].folder.read_state = if self.folders[id].folder.skipped_entries > 0 {
            ScanState::Incomplete
        } else {
            ScanState::Complete
        };
        self.changed.insert(id);
        let mut current = Some(id);
        while let Some(index) = current {
            let progress = &mut self.folders[index];
            if !progress.read_finished || progress.pending_children > 0 {
                break;
            }
            progress.folder.state = if progress.incomplete {
                ScanState::Incomplete
            } else {
                ScanState::Complete
            };
            current = progress.folder.parent_id;
            self.changed.insert(index);
            if let Some(parent) = current {
                self.folders[parent].pending_children -= 1;
            }
        }
    }

    pub(super) fn cancel(&mut self) {
        for (index, progress) in self.folders.iter_mut().enumerate() {
            if progress.folder.state == ScanState::Scanning {
                progress.folder.state = ScanState::Incomplete;
                if progress.folder.read_state == ScanState::Scanning {
                    progress.folder.read_state = ScanState::Incomplete;
                }
                self.changed.insert(index);
            }
        }
    }

    pub(super) fn pending_entries(&self) -> usize {
        self.files.len() + self.changed.len()
    }

    pub(super) fn take_update(&mut self) -> ScanUpdate {
        let mut changed: Vec<_> = self.changed.drain().collect();
        changed.sort_unstable();
        let root = &self.folders[0].folder;
        let update = ScanUpdate {
            id: self.id.clone(),
            sequence: self.sequence,
            folders: changed
                .iter()
                .map(|&id| self.folders[id].folder.clone())
                .collect(),
            files: std::mem::take(&mut self.files),
            total_bytes: root.size_bytes,
            file_count: root.file_count,
            dir_count: root.dir_count,
            skipped_entries: self.skipped_entries,
            largest_files: self.largest_files.clone(),
            duration_ms: self.start.elapsed().as_millis(),
        };
        self.sequence += 1;
        update
    }
}
