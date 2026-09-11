use std::{
    collections::{HashMap, HashSet},
    fs,
    sync::atomic::AtomicUsize,
};

use super::*;

static NEXT_FIXTURE: AtomicUsize = AtomicUsize::new(0);

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "dragabyte-scan-test-{}-{}",
            std::process::id(),
            NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }

    fn file(&self, relative: &str, size: u64) {
        let path = self.0.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::File::create(path).unwrap().set_len(size).unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        assert_eq!(self.0.parent(), Some(std::env::temp_dir().as_path()));
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn collect(fixture: &Fixture, options: ScanOptions) -> Vec<ScanEvent> {
    let events = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&events);
    run_scan(
        fixture.0.clone(),
        build_scan_config(&options).unwrap(),
        Arc::new(AtomicBool::new(false)),
        Arc::new(move |event| captured.lock().unwrap().push(event)),
        Some("test".into()),
    )
    .unwrap();
    Arc::try_unwrap(events).ok().unwrap().into_inner().unwrap()
}

#[test]
fn discovers_nested_folders_and_files_before_completion_with_accurate_totals() {
    let fixture = Fixture::new();
    for index in 0..2300 {
        fixture.file(&format!("large/nested/file-{index}"), index + 1);
    }
    fixture.file("sibling/data", 8192);
    fixture.file(".hidden/data", 7);
    let events = collect(&fixture, ScanOptions::default());
    let mut folders = HashMap::new();
    let mut file_paths = HashSet::new();
    let mut direct = HashMap::<usize, u64>::new();
    let mut previous_bytes = 0;
    let mut saw_growing_folder = false;
    let mut saw_nested_early = false;
    for (sequence, event) in events.iter().enumerate() {
        let (update, complete) = match event {
            ScanEvent::Progress(update) => (update, false),
            ScanEvent::Complete(update) => (update, true),
            _ => panic!("Unexpected terminal event"),
        };
        assert_eq!(update.sequence, sequence as u64);
        assert!(update.total_bytes >= previous_bytes);
        previous_bytes = update.total_bytes;
        for folder in &update.folders {
            if let Some(parent) = folder.parent_id {
                assert!(folders.contains_key(&parent));
            }
            if let Some(previous) = folders.insert(folder.id, folder.clone()) {
                assert!(folder.size_bytes >= previous.size_bytes);
            }
            saw_growing_folder |= !complete
                && folder.name == "large"
                && folder.size_bytes > 0
                && folder.state == ScanState::Scanning;
            saw_nested_early |=
                !complete && folder.name == "nested" && folder.state == ScanState::Scanning;
        }
        for entry in &update.files {
            assert!(folders.contains_key(&entry.parent_id));
            assert!(file_paths.insert(entry.file.path.clone()));
            *direct.entry(entry.parent_id).or_default() += entry.file.size_bytes;
        }
    }
    assert!(saw_growing_folder && saw_nested_early);
    assert_eq!(file_paths.len(), 2302);
    let final_update = match events.last().unwrap() {
        ScanEvent::Complete(update) => update,
        _ => panic!(),
    };
    assert_eq!(final_update.total_bytes, 2300 * 2301 / 2 + 8192 + 7);
    assert_eq!(final_update.file_count, 2302);
    assert_eq!(final_update.dir_count, 4);
    assert_eq!(final_update.skipped_entries, 0);
    let mut totals = direct;
    for id in (0..folders.len()).rev() {
        let folder = &folders[&id];
        assert_eq!(folder.state, ScanState::Complete);
        let size = totals.get(&id).copied().unwrap_or(0);
        assert_eq!(folder.size_bytes, size);
        if let Some(parent) = folder.parent_id {
            *totals.entry(parent).or_default() += size;
        }
    }
}

#[test]
fn includes_wide_empty_and_deep_folders_without_truncating_results() {
    let fixture = Fixture::new();
    for index in 0..450 {
        fs::create_dir(fixture.0.join(format!("empty-{index}"))).unwrap();
    }
    let deep = (0..128).map(|_| "d").collect::<Vec<_>>().join("/");
    fixture.file(&format!("{deep}/data"), 42);
    let events = collect(&fixture, ScanOptions::default());
    let mut folders = HashMap::new();
    for event in events {
        let update = match event {
            ScanEvent::Progress(update) | ScanEvent::Complete(update) => update,
            _ => panic!(),
        };
        serde_json::to_string(&update).unwrap();
        for folder in update.folders {
            folders.insert(folder.id, folder);
        }
    }
    assert_eq!(folders.len(), 579);
    assert_eq!(folders[&0].size_bytes, 42);
    assert_eq!(folders[&0].dir_count, 578);
    assert!(folders
        .values()
        .all(|folder| folder.state == ScanState::Complete));
}

#[test]
fn prunes_excluded_subtrees_and_applies_file_filters() {
    let fixture = Fixture::new();
    fixture.file("excluded/nested/large.bin", 9000);
    fixture.file("included/keep.txt", 10);
    fixture.file("included/drop.bin", 20);
    fixture.file("included/small.txt", 1);
    let mut options = ScanOptions::default();
    options.filters.exclude_names = vec!["excluded".into()];
    options.filters.include_extensions = vec!["txt".into()];
    options.filters.min_size_bytes = Some(5);
    let events = collect(&fixture, options);
    let last = match events.last().unwrap() {
        ScanEvent::Complete(update) => update,
        _ => panic!(),
    };
    assert_eq!(
        (last.total_bytes, last.file_count, last.dir_count),
        (10, 1, 1)
    );
}

#[test]
fn cancellation_retains_partial_results_without_reporting_completion() {
    let fixture = Fixture::new();
    for index in 0..1500 {
        fixture.file(&format!("file-{index}"), 1);
    }
    let flag = Arc::new(AtomicBool::new(false));
    let cancel = Arc::clone(&flag);
    let events = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&events);
    run_scan(
        fixture.0.clone(),
        build_scan_config(&ScanOptions::default()).unwrap(),
        flag,
        Arc::new(move |event| {
            if let ScanEvent::Progress(update) = &event {
                if update.file_count > 0 {
                    cancel.store(true, Ordering::Relaxed);
                }
            }
            captured.lock().unwrap().push(event);
        }),
        Some("cancel".into()),
    )
    .unwrap();
    let events = events.lock().unwrap();
    assert!(!events
        .iter()
        .any(|event| matches!(event, ScanEvent::Complete(_))));
    let last = match events.last().unwrap() {
        ScanEvent::Cancelled(update) => update,
        _ => panic!(),
    };
    assert!(last.file_count > 0 && last.file_count < 1500);
    assert_eq!(
        last.folders
            .iter()
            .find(|folder| folder.id == 0)
            .unwrap()
            .state,
        ScanState::Incomplete
    );
}

#[test]
fn unreadable_folder_is_reported_as_incomplete() {
    let fixture = Fixture::new();
    let missing = fixture.0.join("vanishing");
    fs::create_dir(&missing).unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&events);
    let options = ScanOptions {
        priority_mode: ScanPriorityMode::Low,
        ..ScanOptions::default()
    };
    run_scan(
        fixture.0.clone(),
        build_scan_config(&options).unwrap(),
        Arc::new(AtomicBool::new(false)),
        Arc::new(move |event| {
            if let ScanEvent::Progress(update) = &event {
                if update
                    .folders
                    .iter()
                    .any(|folder| folder.name == "vanishing")
                {
                    fs::remove_dir(&missing).unwrap();
                }
            }
            captured.lock().unwrap().push(event);
        }),
        Some("error".into()),
    )
    .unwrap();
    let events = events.lock().unwrap();
    let last = match events.last().unwrap() {
        ScanEvent::Complete(update) => update,
        _ => panic!(),
    };
    assert_eq!(last.skipped_entries, 1);
    assert!(last
        .folders
        .iter()
        .all(|folder| folder.state == ScanState::Incomplete));
}

#[test]
fn empty_root_completes_and_non_directory_input_fails() {
    let fixture = Fixture::new();
    let events = collect(&fixture, ScanOptions::default());
    let last = match events.last().unwrap() {
        ScanEvent::Complete(update) => update,
        _ => panic!(),
    };
    assert_eq!(last.folders[0].state, ScanState::Complete);
    fixture.file("file", 0);
    assert!(run_scan(
        fixture.0.join("file"),
        build_scan_config(&ScanOptions::default()).unwrap(),
        Arc::new(AtomicBool::new(false)),
        Arc::new(|_| {}),
        None
    )
    .is_err());
}
