mod args;
mod explorer;
mod format;
mod index;
mod report;
mod view;
mod worker;

use crate::{
    disk::compute_disk_usage,
    remote::{start_remote_server, TcpConfig},
};
use args::{Action as Command, Cli, ExploreArgs};
use clap::Parser;
use crossterm::event::{self, Event, KeyEventKind};
use explorer::{Action, Explorer};
use std::{
    io::{self, IsTerminal},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
use view::Theme;
use worker::ScanWorker;

pub fn run() -> Result<u8, String> {
    let cli = Cli::parse();
    let interrupted = Arc::new(AtomicBool::new(false));
    let signal = Arc::clone(&interrupted);
    ctrlc::set_handler(move || signal.store(true, Ordering::Relaxed))
        .map_err(|error| error.to_string())?;
    match cli.command {
        Some(Command::Serve { bind, token }) => {
            let server = start_remote_server(
                TcpConfig {
                    bind_addr: bind,
                    token,
                },
                true,
            )?;
            eprintln!("Listening on {}", server.address);
            while !server.is_finished() && !interrupted.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(50));
            }
            server.stop();
            server.wait()?;
            Ok(0)
        }
        Some(Command::Scan { options, json, top }) => report::run(options, json, top, interrupted),
        None if io::stdin().is_terminal()
            && io::stdout().is_terminal()
            && std::env::var("TERM").as_deref() != Ok("dumb") =>
        {
            interactive(cli.explore, interrupted)
        }
        None => report::run(cli.explore, false, 30, interrupted),
    }
}

struct TerminalRestore;

impl Drop for TerminalRestore {
    fn drop(&mut self) {
        ratatui::restore();
    }
}

fn interactive(options: ExploreArgs, interrupted: Arc<AtomicBool>) -> Result<u8, String> {
    let root = options.root()?;
    let config = options.config()?;
    if !root.is_dir() {
        return Err("Select a folder that exists and can be read.".into());
    }
    let mut disk = compute_disk_usage(&root).ok();
    let theme = Theme {
        ascii: options.ascii,
        no_color: options.no_color
            || std::env::var_os("NO_COLOR").is_some_and(|value| !value.is_empty()),
    };
    let mut worker = ScanWorker::start(root.clone(), config, Arc::new(AtomicBool::new(false)));
    let mut terminal =
        ratatui::try_init().map_err(|error| format!("Cannot open terminal: {error}"))?;
    let restore = TerminalRestore;
    let mut app = Explorer::default();
    let mut redraw = true;
    let mut last_draw = Instant::now();
    while !interrupted.load(Ordering::Relaxed) {
        let mut changed = false;
        let received_at = Instant::now();
        while received_at.elapsed() < Duration::from_millis(10) {
            match worker.receiver.as_ref().unwrap().try_recv() {
                Ok(event) => {
                    app.apply(event);
                    changed = true;
                }
                Err(std::sync::mpsc::TryRecvError::Disconnected) if !app.finished => {
                    app.finished = true;
                    app.failure = Some("Scanning stopped unexpectedly. Press r to retry.".into());
                    changed = true;
                    break;
                }
                Err(_) => break,
            }
        }
        if changed {
            app.rebuild();
            redraw = true;
        }
        if redraw || (!app.finished && last_draw.elapsed() >= Duration::from_millis(150)) {
            terminal
                .draw(|frame| view::draw(frame, &mut app, disk.as_ref(), &theme))
                .map_err(|error| error.to_string())?;
            redraw = false;
            last_draw = Instant::now();
        }
        if event::poll(Duration::from_millis(50)).map_err(|error| error.to_string())? {
            match event::read().map_err(|error| error.to_string())? {
                Event::Key(key) if key.kind != KeyEventKind::Release => {
                    let page = terminal
                        .size()
                        .map_err(|error| error.to_string())?
                        .height
                        .saturating_sub(10)
                        .max(1) as usize;
                    match app.key(key, page) {
                        Action::Quit => break,
                        Action::Cancel => worker.cancel(),
                        Action::Refresh => {
                            drop(worker);
                            disk = compute_disk_usage(&root).ok();
                            worker = ScanWorker::start(
                                root.clone(),
                                options.config()?,
                                Arc::new(AtomicBool::new(false)),
                            );
                            app = Explorer::default();
                        }
                        Action::None => {}
                    }
                    redraw = true;
                }
                Event::Resize(_, _) => redraw = true,
                _ => {}
            }
        }
    }
    drop(restore);
    drop(worker);
    Ok(0)
}

#[cfg(test)]
mod tests;
