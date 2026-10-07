use super::*;

fn options() -> EmptyFolderOptions {
    EmptyFolderOptions {
        min_depth: 1,
        max_depth: None,
        include_hidden: false,
        empty_after_removal: true,
        include_names: vec![],
        exclude_names: vec![],
        include_paths: vec![],
        exclude_paths: vec![],
        include_regex: String::new(),
        exclude_regex: String::new(),
        regex_match_path: false,
        match_case: false,
        min_age_days: None,
        max_age_days: None,
    }
}

fn preview(root: &Path, options: &EmptyFolderOptions) -> EmptyFolderPreview {
    find_empty_folders(
        vec![path_string(root)],
        options,
        &AtomicBool::new(false),
        |_, _, _| {},
    )
    .unwrap()
}

fn relative_paths(preview: &EmptyFolderPreview) -> Vec<&str> {
    preview
        .folders
        .iter()
        .map(|folder| folder.relative_path.as_str())
        .collect()
}

#[test]
fn removes_empty_chains_bottom_up_and_preserves_sources_and_files() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir_all(root.path().join("chain/child/leaf")).unwrap();
    fs::create_dir_all(root.path().join("occupied/empty")).unwrap();
    fs::write(root.path().join("occupied/zero-byte.txt"), "").unwrap();
    let found = preview(root.path(), &options());
    assert_eq!(
        relative_paths(&found),
        ["chain", "chain/child", "chain/child/leaf", "occupied/empty"]
    );
    assert_eq!(
        found.folders[0].children,
        [path_string(
            &fs::canonicalize(root.path().join("chain/child")).unwrap()
        )]
    );
    let result = remove_empty_folders(
        &found,
        found
            .folders
            .iter()
            .map(|folder| folder.path.clone())
            .collect(),
        &AtomicBool::new(false),
        |_, _, _| {},
    )
    .unwrap();
    assert!(result
        .outcomes
        .iter()
        .all(|outcome| outcome.error.is_none()));
    assert!(root.path().exists());
    assert!(!root.path().join("chain").exists());
    assert!(root.path().join("occupied/zero-byte.txt").exists());
}

#[test]
fn files_hidden_entries_and_excluded_subtrees_prevent_parent_removal() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir_all(root.path().join("parent/keep/empty")).unwrap();
    fs::create_dir_all(root.path().join("hidden/.cache")).unwrap();
    fs::create_dir_all(root.path().join("file-only")).unwrap();
    fs::write(root.path().join("file-only/.hidden"), "").unwrap();
    let configured = EmptyFolderOptions {
        exclude_names: vec!["keep".into()],
        ..options()
    };
    assert!(preview(root.path(), &configured).folders.is_empty());
    let configured = EmptyFolderOptions {
        include_hidden: true,
        ..configured
    };
    assert_eq!(
        relative_paths(&preview(root.path(), &configured)),
        ["hidden", "hidden/.cache"]
    );
}

#[test]
fn filters_find_descendants_without_pruning_nonmatching_parents() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir_all(root.path().join("parent/Album/deeper")).unwrap();
    fs::create_dir_all(root.path().join("other/Album")).unwrap();
    let configured = EmptyFolderOptions {
        include_names: vec![" album ".into()],
        include_paths: vec!["parent/".into()],
        min_depth: 2,
        max_depth: Some(2),
        ..options()
    };
    assert!(preview(root.path(), &configured).folders.is_empty());
    fs::remove_dir(root.path().join("parent/Album/deeper")).unwrap();
    assert_eq!(
        relative_paths(&preview(root.path(), &configured)),
        ["parent/Album"]
    );
    let configured = EmptyFolderOptions {
        match_case: true,
        ..configured
    };
    assert!(preview(root.path(), &configured).folders.is_empty());
}

#[test]
fn regex_filters_support_names_paths_case_and_exclusions() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir_all(root.path().join("group/Album01")).unwrap();
    fs::create_dir_all(root.path().join("group/Album02")).unwrap();
    let configured = EmptyFolderOptions {
        include_regex: "^album[0-9]+$".into(),
        exclude_regex: "02$".into(),
        ..options()
    };
    assert_eq!(
        relative_paths(&preview(root.path(), &configured)),
        ["group/Album01"]
    );
    let configured = EmptyFolderOptions {
        include_regex: "^group/Album".into(),
        regex_match_path: true,
        ..configured
    };
    assert_eq!(
        relative_paths(&preview(root.path(), &configured)),
        ["group/Album01"]
    );
}

#[test]
fn depth_and_currently_empty_mode_leave_unselected_children_intact() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir_all(root.path().join("chain/child")).unwrap();
    fs::create_dir_all(root.path().join("leaf")).unwrap();
    assert_eq!(
        relative_paths(&preview(
            root.path(),
            &EmptyFolderOptions {
                max_depth: Some(1),
                ..options()
            }
        )),
        ["leaf"]
    );
    assert_eq!(
        relative_paths(&preview(
            root.path(),
            &EmptyFolderOptions {
                empty_after_removal: false,
                ..options()
            }
        )),
        ["chain/child", "leaf"]
    );
    assert_eq!(
        relative_paths(&preview(
            root.path(),
            &EmptyFolderOptions {
                min_depth: 2,
                ..options()
            }
        )),
        ["chain/child"]
    );
}

#[test]
fn new_contents_and_deselected_children_block_deletion() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir_all(root.path().join("chain/child")).unwrap();
    fs::create_dir_all(root.path().join("leaf")).unwrap();
    let found = preview(root.path(), &options());
    fs::write(root.path().join("leaf/new.txt"), "keep").unwrap();
    let result = remove_empty_folders(
        &found,
        vec![
            path_string(&root.path().join("chain")),
            path_string(&root.path().join("leaf")),
        ],
        &AtomicBool::new(false),
        |_, _, _| {},
    )
    .unwrap();
    assert_eq!(result.outcomes.len(), 2);
    assert!(result
        .outcomes
        .iter()
        .all(|outcome| outcome.error.is_some()));
    assert_eq!(
        fs::read_to_string(root.path().join("leaf/new.txt")).unwrap(),
        "keep"
    );
    assert!(root.path().join("chain/child").exists());
}

#[test]
fn validates_all_selections_before_removing_anything() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("leaf")).unwrap();
    let found = preview(root.path(), &options());
    for invalid in [
        path_string(root.path()),
        path_string(&root.path().join("unknown")),
    ] {
        assert!(remove_empty_folders(
            &found,
            vec![found.folders[0].path.clone(), invalid],
            &AtomicBool::new(false),
            |_, _, _| {}
        )
        .is_err());
        assert!(root.path().join("leaf").exists());
    }
}

#[test]
fn overlapping_sources_are_deduplicated_and_all_source_folders_are_protected() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir_all(root.path().join("chain/child/leaf")).unwrap();
    let found = find_empty_folders(
        vec![
            path_string(root.path()),
            path_string(&root.path().join("chain/child")),
            path_string(root.path()),
        ],
        &options(),
        &AtomicBool::new(false),
        |_, _, _| {},
    )
    .unwrap();
    assert_eq!(found.folders.len(), 1);
    assert_eq!(
        found.folders[0].path,
        path_string(&fs::canonicalize(root.path().join("chain/child/leaf")).unwrap())
    );
    let scoped = find_empty_folders(
        vec![
            path_string(root.path()),
            path_string(&root.path().join("chain/child")),
        ],
        &EmptyFolderOptions {
            max_depth: Some(1),
            ..options()
        },
        &AtomicBool::new(false),
        |_, _, _| {},
    )
    .unwrap();
    assert_eq!(relative_paths(&scoped), ["leaf"]);
    assert_eq!(scoped.folders[0].depth, 1);
}

#[test]
fn reports_unreadable_sources_and_still_previews_other_sources() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("leaf")).unwrap();
    let found = find_empty_folders(
        vec![
            path_string(root.path()),
            path_string(&root.path().join("missing")),
        ],
        &options(),
        &AtomicBool::new(false),
        |_, _, _| {},
    )
    .unwrap();
    assert_eq!(relative_paths(&found), ["leaf"]);
    assert_eq!(found.errors.len(), 1);
}

#[test]
fn rejects_invalid_filters_and_checks_modified_age() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("leaf")).unwrap();
    for configured in [
        EmptyFolderOptions {
            min_depth: 0,
            ..options()
        },
        EmptyFolderOptions {
            min_depth: 2,
            max_depth: Some(1),
            ..options()
        },
        EmptyFolderOptions {
            include_regex: "[".into(),
            ..options()
        },
        EmptyFolderOptions {
            exclude_regex: "[".into(),
            ..options()
        },
        EmptyFolderOptions {
            min_age_days: Some(-1.0),
            ..options()
        },
        EmptyFolderOptions {
            min_age_days: Some(2.0),
            max_age_days: Some(1.0),
            ..options()
        },
    ] {
        assert!(find_empty_folders(
            vec![path_string(root.path())],
            &configured,
            &AtomicBool::new(false),
            |_, _, _| {}
        )
        .is_err());
    }
    assert!(preview(
        root.path(),
        &EmptyFolderOptions {
            min_age_days: Some(1.0),
            ..options()
        }
    )
    .folders
    .is_empty());
    assert_eq!(
        relative_paths(&preview(
            root.path(),
            &EmptyFolderOptions {
                max_age_days: Some(1.0),
                ..options()
            }
        )),
        ["leaf"]
    );
}

#[test]
fn cancelled_previews_cannot_be_applied_and_removal_can_stop_mid_batch() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("a")).unwrap();
    fs::create_dir(root.path().join("b")).unwrap();
    let cancel = AtomicBool::new(true);
    let found = find_empty_folders(
        vec![path_string(root.path())],
        &options(),
        &cancel,
        |_, _, _| {},
    )
    .unwrap();
    assert!(found.cancelled);
    assert!(remove_empty_folders(&found, vec![], &AtomicBool::new(false), |_, _, _| {}).is_err());
    let found = preview(root.path(), &options());
    cancel.store(false, Ordering::Relaxed);
    let result = remove_empty_folders(
        &found,
        found
            .folders
            .iter()
            .map(|folder| folder.path.clone())
            .collect(),
        &cancel,
        |_, _, _| cancel.store(true, Ordering::Relaxed),
    )
    .unwrap();
    assert!(result.cancelled);
    assert_eq!(result.outcomes.len(), 1);
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
}

#[cfg(unix)]
#[test]
fn links_block_parents_and_replaced_ancestors_cannot_redirect_removal() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::create_dir_all(root.path().join("parent/leaf")).unwrap();
    fs::create_dir(outside.path().join("leaf")).unwrap();
    let found = preview(root.path(), &options());
    fs::rename(root.path().join("parent"), root.path().join("moved")).unwrap();
    symlink(outside.path(), root.path().join("parent")).unwrap();
    let result = remove_empty_folders(
        &found,
        found
            .folders
            .iter()
            .map(|folder| folder.path.clone())
            .collect(),
        &AtomicBool::new(false),
        |_, _, _| {},
    )
    .unwrap();
    assert!(result
        .outcomes
        .iter()
        .all(|outcome| outcome.error.is_some()));
    assert!(outside.path().join("leaf").exists());
    assert_eq!(
        relative_paths(&preview(root.path(), &options())),
        ["moved", "moved/leaf"]
    );
}

#[cfg(windows)]
#[test]
fn junctions_block_parents_and_replaced_ancestors_cannot_redirect_removal() {
    use std::process::Command;
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::create_dir_all(root.path().join("parent/leaf")).unwrap();
    fs::create_dir(outside.path().join("leaf")).unwrap();
    let found = preview(root.path(), &options());
    fs::rename(root.path().join("parent"), root.path().join("moved")).unwrap();
    let link = root.path().join("parent");
    let created = Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&link)
        .arg(outside.path())
        .output()
        .unwrap();
    assert!(
        created.status.success(),
        "{}",
        String::from_utf8_lossy(&created.stderr)
    );
    let result = remove_empty_folders(
        &found,
        found
            .folders
            .iter()
            .map(|folder| folder.path.clone())
            .collect(),
        &AtomicBool::new(false),
        |_, _, _| {},
    )
    .unwrap();
    assert!(result
        .outcomes
        .iter()
        .all(|outcome| outcome.error.is_some()));
    assert!(outside.path().join("leaf").exists());
    assert_eq!(
        relative_paths(&preview(root.path(), &options())),
        ["moved", "moved/leaf"]
    );
    fs::remove_dir(link).unwrap();
}
