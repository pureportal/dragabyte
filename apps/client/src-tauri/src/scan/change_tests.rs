use std::{collections::HashMap, fs, sync::atomic::AtomicBool};

use super::*;

fn collect_scope(root: &Path, path: &Path, options: &ScanOptions) -> Vec<ScanUpdate> {
    let captured = Arc::new(Mutex::new(Vec::new()));
    let events = Arc::clone(&captured);
    run_scan(
        root.to_path_buf(),
        build_scan_config(options)
            .unwrap()
            .for_entry(path.to_path_buf()),
        Arc::new(AtomicBool::new(false)),
        Arc::new(move |event| match event {
            ScanEvent::Progress(update) | ScanEvent::Complete(update) => {
                events.lock().unwrap().push(update)
            }
            _ => panic!("Unexpected scan event"),
        }),
        Some("scope".into()),
    )
    .unwrap();
    Arc::try_unwrap(captured)
        .ok()
        .unwrap()
        .into_inner()
        .unwrap()
}

fn write_file(root: &Path, path: &str, size: u64) {
    let path = root.join(path);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::File::create(path).unwrap().set_len(size).unwrap();
}

#[test]
fn scoped_scans_read_only_the_requested_folder_or_file() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    write_file(root, "affected/nested/data", 42);
    write_file(root, "unrelated/large", 9000);
    write_file(root, "affected/sibling", 10);
    for (path, bytes, count) in [
        ("affected/nested", 42, 1),
        ("affected/sibling", 10, 1),
        ("absent", 0, 0),
    ] {
        let target = root.join(path);
        let updates = collect_scope(root, &target, &ScanOptions::default());
        let final_update = updates.last().unwrap();
        assert_eq!(final_update.total_bytes, bytes);
        assert_eq!(final_update.file_count, count);
        for update in updates {
            for file in update.files {
                assert!(Path::new(&file.file.path).starts_with(&target));
            }
            for folder in update.folders.into_iter().filter(|folder| folder.id != 0) {
                assert!(Path::new(&folder.path).starts_with(&target));
            }
        }
    }
}

#[test]
fn scoped_scans_apply_filters_to_the_entry_and_its_ancestors() {
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    write_file(root, "excluded/nested/data.txt", 100);
    write_file(root, "included/data.txt", 10);
    let mut options = ScanOptions::default();
    options.filters.exclude_names = vec!["excluded".into()];
    options.filters.include_extensions = vec!["txt".into()];
    for path in ["excluded", "excluded/nested", "excluded/nested/data.txt"] {
        let updates = collect_scope(root, &root.join(path), &options);
        assert_eq!(updates.last().unwrap().file_count, 0);
        assert_eq!(updates.last().unwrap().dir_count, 0);
    }
    fs::rename(
        root.join("included/data.txt"),
        root.join("included/data.bin"),
    )
    .unwrap();
    let updates = collect_scope(root, &root.join("included/data.bin"), &options);
    assert_eq!(updates.last().unwrap().file_count, 0);
    fs::rename(root.join("excluded"), root.join("visible")).unwrap();
    let updates = collect_scope(root, &root.join("visible"), &options);
    assert_eq!(updates.last().unwrap().total_bytes, 100);
}

#[test]
fn deleting_renaming_and_moving_during_discovery_preserve_the_original_scan() {
    for action in ["delete", "rename", "move"] {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path().to_path_buf();
        write_file(&root, "source/affected/nested/data", 42);
        write_file(&root, "destination/existing", 10);
        for index in 0..64 {
            write_file(&root, &format!("unrelated/file-{index}"), 100);
        }
        let source = root.join("source/affected");
        let destination = root.join(if action == "move" {
            "destination/affected"
        } else {
            "source/renamed"
        });
        let performed = Arc::new(AtomicBool::new(false));
        let changed = Arc::clone(&performed);
        let captured = Arc::new(Mutex::new(Vec::new()));
        let events = Arc::clone(&captured);
        let scoped = Arc::new(Mutex::new(Vec::new()));
        let scoped_events = Arc::clone(&scoped);
        let event_root = root.clone();
        let event_source = source.clone();
        let event_destination = destination.clone();
        let mut config = build_scan_config(&ScanOptions::default())
            .unwrap()
            .with_workers(1)
            .unwrap();
        config.emit_interval = Duration::ZERO;
        run_scan(
            root.clone(),
            config,
            Arc::new(AtomicBool::new(false)),
            Arc::new(move |event| {
                if let ScanEvent::Progress(update) = &event {
                    if update
                        .folders
                        .iter()
                        .any(|folder| Path::new(&folder.path) == event_source)
                        && !changed.swap(true, Ordering::Relaxed)
                    {
                        assert!(event_source.starts_with(&event_root));
                        if action == "delete" {
                            fs::remove_dir_all(&event_source).unwrap();
                        } else {
                            fs::rename(&event_source, &event_destination).unwrap();
                            *scoped_events.lock().unwrap() = collect_scope(
                                &event_root,
                                &event_destination,
                                &ScanOptions::default(),
                            );
                        }
                    }
                }
                events.lock().unwrap().push(event);
            }),
            Some("original".into()),
        )
        .unwrap();
        assert!(performed.load(Ordering::Relaxed));
        let events = captured.lock().unwrap();
        assert!(matches!(events.last(), Some(ScanEvent::Complete(_))));
        let mut files = HashMap::new();
        for (sequence, event) in events.iter().enumerate() {
            let update = match event {
                ScanEvent::Progress(update) | ScanEvent::Complete(update) => update,
                _ => panic!("The original scan was interrupted"),
            };
            assert_eq!(update.id.as_deref(), Some("original"));
            assert_eq!(update.sequence, sequence as u64);
            for entry in &update.files {
                let path = PathBuf::from(&entry.file.path);
                if !path.starts_with(&source) && !path.starts_with(&destination) {
                    files.insert(path, entry.file.size_bytes);
                }
            }
        }
        for update in scoped.lock().unwrap().iter() {
            for entry in &update.files {
                let path = PathBuf::from(&entry.file.path);
                assert!(path.starts_with(&destination));
                assert!(files.insert(path, entry.file.size_bytes).is_none());
            }
        }
        assert_eq!(files.len(), if action == "delete" { 65 } else { 66 });
        assert_eq!(
            files.values().sum::<u64>(),
            6410 + if action == "delete" { 0 } else { 42 }
        );
        assert_eq!(
            files
                .keys()
                .filter(|path| path.starts_with(root.join("unrelated")))
                .count(),
            64
        );
    }
}
