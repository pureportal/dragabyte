use super::{
    args::ExploreArgs,
    explorer::Explorer,
    format::{bar, display_path, safe_text, size},
    index::{RowId, Sort},
    worker::ScanWorker,
};
use std::{
    io::{self, Write},
    sync::{atomic::AtomicBool, Arc},
};

pub(super) fn run(
    options: ExploreArgs,
    json: bool,
    top: usize,
    cancel: Arc<AtomicBool>,
) -> Result<u8, String> {
    let root = options.root()?;
    let config = options.config()?;
    let worker = ScanWorker::start(root, config, cancel);
    let mut app = Explorer::default();
    for event in worker.receiver.as_ref().unwrap() {
        app.apply(event);
    }
    if let Some(failure) = app.failure {
        return Err(failure);
    }
    let stdout = io::stdout();
    let mut output = stdout.lock();
    let written = if json {
        serde_json::to_writer(&mut output, &app.index)
            .map_err(|error| {
                io::Error::new(error.io_error_kind().unwrap_or(io::ErrorKind::Other), error)
            })
            .and_then(|_| writeln!(output))
    } else {
        write_text(&mut output, &mut app, top, options.ascii)
    };
    if let Err(error) = written {
        if error.kind() == io::ErrorKind::BrokenPipe {
            return Ok(0);
        }
        return Err(format!("Cannot write report: {error}"));
    }
    if app.cancelled {
        Ok(130)
    } else if !app.index.complete {
        Ok(2)
    } else {
        Ok(0)
    }
}

fn write_text(
    output: &mut impl Write,
    app: &mut Explorer,
    top: usize,
    ascii: bool,
) -> io::Result<()> {
    if app.index.folders.is_empty() {
        return Ok(());
    }
    writeln!(output, "{}", display_path(&app.index.folders[0].data.path))?;
    writeln!(
        output,
        "{:>10}  {:>6}  {:20}  Name",
        "File size", "Share", ""
    )?;
    let rows = app.index.listing(0, Sort::Size);
    for &row in rows.iter().take(top) {
        let bytes = app.index.size(row);
        let percent = if app.index.total_bytes == 0 {
            0.0
        } else {
            bytes as f64 * 100.0 / app.index.total_bytes as f64
        };
        let suffix = if matches!(row, RowId::Folder(_)) {
            "/"
        } else {
            ""
        };
        writeln!(
            output,
            "{:>10}  {percent:5.1}%  {}  {}{suffix}",
            size(bytes),
            bar(bytes, app.index.total_bytes, 20, ascii),
            safe_text(app.index.name(row))
        )?;
    }
    if rows.len() > top {
        writeln!(output, "{} more entries", rows.len() - top)?;
    }
    writeln!(
        output,
        "{}  {} files  {} folders  {:.3}s",
        size(app.index.total_bytes),
        app.index.file_count,
        app.index.dir_count,
        app.index.duration_ms as f64 / 1000.0
    )?;
    if app.cancelled {
        writeln!(output, "Scan stopped; totals are incomplete.")?;
    }
    if app.index.skipped_entries > 0 {
        writeln!(
            output,
            "{} entries could not be read; totals are incomplete.",
            app.index.skipped_entries
        )?;
    }
    Ok(())
}
