use crate::scan::{ScanFile, ScanFolder, ScanUpdate};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum RowId {
    Folder(usize),
    File(usize),
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub(super) enum Sort {
    #[default]
    Size,
    Name,
    Count,
}

impl Sort {
    pub fn label(self) -> &'static str {
        match self {
            Self::Size => "Size",
            Self::Name => "Name",
            Self::Count => "Files",
        }
    }
}

#[derive(Serialize)]
pub(super) struct Folder {
    #[serde(flatten)]
    pub data: ScanFolder,
    #[serde(skip)]
    children: Vec<RowId>,
    #[serde(skip)]
    revision: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct File {
    pub parent_id: usize,
    #[serde(flatten)]
    pub data: ScanFile,
}

struct Listing {
    revision: u64,
    sort: Sort,
    rows: Vec<RowId>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ScanIndex {
    pub folders: Vec<Folder>,
    pub files: Vec<File>,
    pub total_bytes: u64,
    pub file_count: u64,
    pub dir_count: u64,
    pub skipped_entries: u64,
    pub duration_ms: u128,
    pub complete: bool,
    #[serde(skip)]
    pub largest: Vec<RowId>,
    #[serde(skip)]
    listings: HashMap<usize, Listing>,
}

impl ScanIndex {
    pub fn apply(&mut self, update: ScanUpdate) {
        for data in update.folders {
            let id = data.id;
            if let Some(parent) = data.parent_id {
                self.folders[parent].revision += 1;
                if id == self.folders.len() {
                    self.folders[parent].children.push(RowId::Folder(id));
                }
            }
            if id == self.folders.len() {
                self.folders.push(Folder {
                    data,
                    children: Vec::new(),
                    revision: 0,
                });
            } else {
                self.folders[id].data = data;
            }
        }
        for discovered in update.files {
            let id = self.files.len();
            let folder = &mut self.folders[discovered.parent_id];
            folder.children.push(RowId::File(id));
            folder.revision += 1;
            let size = discovered.file.size_bytes;
            self.files.push(File {
                parent_id: discovered.parent_id,
                data: discovered.file,
            });
            if size > 0
                && (self.largest.len() < 100 || size > self.size(*self.largest.last().unwrap()))
            {
                let position = self.largest.partition_point(|&row| self.size(row) >= size);
                self.largest.insert(position, RowId::File(id));
                self.largest.truncate(100);
            }
        }
        self.total_bytes = update.total_bytes;
        self.file_count = update.file_count;
        self.dir_count = update.dir_count;
        self.skipped_entries = update.skipped_entries;
        self.duration_ms = update.duration_ms;
    }

    pub fn listing(&mut self, folder: usize, sort: Sort) -> Vec<RowId> {
        let data = &self.folders[folder];
        if let Some(cached) = self.listings.get(&folder) {
            if cached.revision == data.revision && cached.sort == sort {
                return cached.rows.clone();
            }
        }
        let mut rows = data.children.clone();
        rows.sort_unstable_by(|&left, &right| {
            let order = match sort {
                Sort::Size => self.size(right).cmp(&self.size(left)),
                Sort::Count => self.count(right).cmp(&self.count(left)),
                Sort::Name => self.name(left).cmp(self.name(right)),
            };
            order
                .then_with(|| self.name(left).cmp(self.name(right)))
                .then_with(|| self.path(left).cmp(self.path(right)))
        });
        self.listings.insert(
            folder,
            Listing {
                revision: self.folders[folder].revision,
                sort,
                rows: rows.clone(),
            },
        );
        rows
    }

    pub fn size(&self, row: RowId) -> u64 {
        match row {
            RowId::Folder(id) => self.folders[id].data.size_bytes,
            RowId::File(id) => self.files[id].data.size_bytes,
        }
    }

    pub fn name(&self, row: RowId) -> &str {
        match row {
            RowId::Folder(id) => &self.folders[id].data.name,
            RowId::File(id) => &self.files[id].data.name,
        }
    }

    pub fn path(&self, row: RowId) -> &str {
        match row {
            RowId::Folder(id) => &self.folders[id].data.path,
            RowId::File(id) => &self.files[id].data.path,
        }
    }

    pub fn count(&self, row: RowId) -> u64 {
        match row {
            RowId::Folder(id) => self.folders[id].data.file_count,
            RowId::File(_) => 1,
        }
    }
}
