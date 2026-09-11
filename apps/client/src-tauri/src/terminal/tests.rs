use super::{
    args::{Action as Command, Cli},
    explorer::{Action, Explorer},
    format,
    index::{RowId, Sort},
    view::{self, Theme},
};
use crate::scan::{build_scan_config, run_scan, ScanFolder, ScanOptions, ScanState, ScanUpdate};
use clap::Parser;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::{backend::TestBackend, Terminal};
use std::{
    fs,
    sync::{atomic::AtomicBool, mpsc, Arc},
    time::Instant,
};

fn fixture() -> (tempfile::TempDir, Explorer) {
    let directory = tempfile::tempdir().unwrap();
    fs::create_dir(directory.path().join("large")).unwrap();
    fs::create_dir(directory.path().join("small")).unwrap();
    fs::write(directory.path().join("large/data.bin"), vec![0; 8192]).unwrap();
    fs::write(directory.path().join("small/note.txt"), vec![0; 1024]).unwrap();
    fs::write(directory.path().join("root.txt"), vec![0; 1024]).unwrap();
    let (sender, receiver) = mpsc::channel();
    run_scan(
        directory.path().to_path_buf(),
        build_scan_config(&ScanOptions::default()).unwrap(),
        Arc::new(AtomicBool::new(false)),
        Arc::new(move |event| sender.send(event).unwrap()),
        None,
    )
    .unwrap();
    let mut app = Explorer::default();
    for event in receiver {
        app.apply(event);
    }
    app.rebuild();
    (directory, app)
}

fn press(app: &mut Explorer, code: KeyCode) -> Action {
    app.key(KeyEvent::new(code, KeyModifiers::NONE), 10)
}

#[test]
fn navigation_uses_index_after_source_is_gone_and_restores_selection() {
    let (directory, mut app) = fixture();
    assert_eq!(app.index.total_bytes, 10240);
    assert_eq!(app.index.name(app.selected().unwrap()), "large");
    drop(directory);
    press(&mut app, KeyCode::Enter);
    assert_eq!(app.index.name(app.selected().unwrap()), "data.bin");
    press(&mut app, KeyCode::Backspace);
    assert_eq!(app.current, 0);
    assert_eq!(app.index.name(app.selected().unwrap()), "large");
    press(&mut app, KeyCode::Char('t'));
    assert_eq!(app.index.name(app.selected().unwrap()), "data.bin");
    press(&mut app, KeyCode::Enter);
    assert_eq!(app.index.folders[app.current].data.name, "large");
    assert_eq!(app.index.name(app.selected().unwrap()), "data.bin");
}

#[test]
fn filtering_sorting_and_empty_selection_work() {
    let (_directory, mut app) = fixture();
    press(&mut app, KeyCode::Char('n'));
    press(&mut app, KeyCode::Char('v'));
    assert_eq!(app.index.name(app.rows[0]), "small");
    press(&mut app, KeyCode::Char('/'));
    for character in "missing".chars() {
        press(&mut app, KeyCode::Char(character));
    }
    assert!(app.rows.is_empty());
    press(&mut app, KeyCode::Enter);
    press(&mut app, KeyCode::Enter);
    assert_eq!(app.current, 0);
    press(&mut app, KeyCode::Esc);
    assert_eq!(app.rows.len(), 3);
    press(&mut app, KeyCode::Char('d'));
    assert!(app.rows.iter().all(|row| matches!(row, RowId::Folder(_))));
    assert_eq!(press(&mut app, KeyCode::Char('r')), Action::Refresh);
}

#[test]
fn rendering_shows_graph_and_survives_resize() {
    let (_directory, mut app) = fixture();
    let theme = Theme {
        ascii: true,
        no_color: true,
    };
    let mut terminal = Terminal::new(TestBackend::new(100, 22)).unwrap();
    terminal
        .draw(|frame| view::draw(frame, &mut app, None, &theme))
        .unwrap();
    let text = terminal
        .backend()
        .buffer()
        .content
        .iter()
        .map(|cell| cell.symbol())
        .collect::<String>();
    assert!(text.contains("Dragabyte"));
    assert!(text.contains("80.0%"));
    assert!(text.contains("large/"));
    assert!(text.contains("##############"));
    assert!(text.is_ascii());
    for (width, height) in [(42, 10), (20, 5), (140, 30)] {
        terminal.backend_mut().resize(width, height);
        terminal.autoresize().unwrap();
        terminal
            .draw(|frame| view::draw(frame, &mut app, None, &theme))
            .unwrap();
    }
}

#[test]
fn controls_do_not_leak_and_bars_handle_zero() {
    assert_eq!(format::safe_text("a\x1b[31m\nb\u{202e}c"), "a�[31m�b�c");
    assert_eq!(format::bar(0, 0, 5, true), ".....");
    assert_eq!(format::bar(u64::MAX, 1, 5, true), "#####");
    assert_eq!(format::size(1024), "1.0 KiB");
    let path = format::fit_path("/a/very/long/folder/日本語/file", 18);
    assert!(path.ends_with("日本語/file"));
    assert!(ratatui::text::Line::raw(path).width() <= 18);
}

#[test]
fn cli_parses_paths_and_validates_options() {
    let cli = Cli::try_parse_from(["dragabyte-cli", "some folder", "--threads", "1"]).unwrap();
    assert_eq!(cli.explore.path.to_str(), Some("some folder"));
    assert!(matches!(
        Cli::try_parse_from(["dragabyte-cli", "serve", "--bind", "127.0.0.1:0"])
            .unwrap()
            .command,
        Some(Command::Serve { .. })
    ));
    assert!(matches!(
        Cli::try_parse_from(["dragabyte-cli", "scan", ".", "--json"])
            .unwrap()
            .command,
        Some(Command::Scan { json: true, .. })
    ));
    assert!(Cli::try_parse_from(["dragabyte-cli", "--threads", "0"]).is_err());
    assert!(Cli::try_parse_from(["dragabyte-cli", "--threads", "65"]).is_err());
    assert!(Cli::try_parse_from(["dragabyte-cli", "--exclude", "["])
        .unwrap()
        .explore
        .config()
        .is_err());
}

#[test]
fn cached_listing_invalidates_when_child_size_changes() {
    let (_directory, mut app) = fixture();
    let small_id = app
        .index
        .folders
        .iter()
        .position(|folder| folder.data.name == "small")
        .unwrap();
    let mut changed = app.index.folders[small_id].data.clone();
    changed.size_bytes = 99999;
    let update = ScanUpdate {
        id: None,
        sequence: 99,
        folders: vec![changed],
        files: vec![],
        total_bytes: 99999,
        file_count: 3,
        dir_count: 2,
        skipped_entries: 0,
        largest_files: vec![],
        duration_ms: 1,
    };
    app.index.apply(update);
    assert_eq!(app.index.listing(0, Sort::Size)[0], RowId::Folder(small_id));
}

#[test]
#[ignore = "manual navigation and rendering benchmark"]
fn navigation_benchmark() {
    let mut app = Explorer::default();
    let folders = (0..50_001)
        .map(|id| ScanFolder {
            id,
            parent_id: (id != 0).then_some(0),
            path: format!("/fixture/{id}"),
            name: format!("folder-{id:05}"),
            size_bytes: id as u64 * 1024,
            file_count: id as u64,
            dir_count: 0,
            state: ScanState::Complete,
        })
        .collect();
    app.index.apply(ScanUpdate {
        id: None,
        sequence: 0,
        folders,
        files: vec![],
        total_bytes: 1_280_025_600_000,
        file_count: 50_000,
        dir_count: 50_000,
        skipped_entries: 0,
        largest_files: vec![],
        duration_ms: 0,
    });
    let first = Instant::now();
    app.rebuild();
    eprintln!("50,000-entry initial listing: {:?}", first.elapsed());
    let repeated = Instant::now();
    for _ in 0..1000 {
        app.navigate(1);
        app.navigate(0);
    }
    eprintln!("1,000 round trips: {:?}", repeated.elapsed());
    let mut terminal = Terminal::new(TestBackend::new(120, 30)).unwrap();
    let theme = Theme {
        ascii: false,
        no_color: false,
    };
    let rendering = Instant::now();
    for _ in 0..1000 {
        terminal
            .draw(|frame| view::draw(frame, &mut app, None, &theme))
            .unwrap();
    }
    eprintln!("1,000 viewport renders: {:?}", rendering.elapsed());
}
