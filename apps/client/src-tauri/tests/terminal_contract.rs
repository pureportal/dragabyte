#![cfg(feature = "terminal")]

use std::{fs, process::Command};

#[test]
fn cli_reports_from_working_directory_without_display_or_tty() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("large")).unwrap();
    fs::create_dir(root.path().join("omit")).unwrap();
    fs::write(root.path().join("large/data.bin"), vec![0; 8192]).unwrap();
    fs::write(root.path().join("omit/ignored.bin"), vec![0; 4096]).unwrap();
    fs::write(root.path().join("small.txt"), vec![0; 1024]).unwrap();
    let run = |args: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_dragabyte-cli"))
            .args(args)
            .current_dir(root.path())
            .env_remove("DISPLAY")
            .env_remove("WAYLAND_DISPLAY")
            .output()
            .unwrap()
    };
    let output = run(&["scan", "--json", "--exclude", "omit", "--threads", "1"]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["totalBytes"], 9216);
    assert_eq!(report["fileCount"], 2);
    assert_eq!(report["dirCount"], 1);
    assert_eq!(report["complete"], true);
    assert_eq!(report["folders"].as_array().unwrap().len(), 2);
    let output = run(&["--ascii"]);
    assert!(output.status.success());
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("large/"));
    assert!(text.contains("File size"));
    assert!(text.contains("####"));
    assert!(!text.contains('\u{1b}'));
    let invalid = run(&["scan", "missing-folder", "--json"]);
    assert_eq!(invalid.status.code(), Some(1));
    assert!(invalid.stdout.is_empty());
    let bad_regex = run(&["scan", "--exclude", "["]);
    assert_eq!(bad_regex.status.code(), Some(1));
}
