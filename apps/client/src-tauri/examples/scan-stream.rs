use dragabyte::scan::{build_scan_config, run_scan, ScanEvent, ScanOptions, ScanUpdate};
use serde::Serialize;
use std::{
    io::{self, Write},
    path::PathBuf,
    sync::{atomic::AtomicBool, Arc, Mutex},
};

#[derive(Serialize)]
struct Event<'a> {
    kind: &'static str,
    update: &'a ScanUpdate,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("Provide a scan folder path.")?;
    let root = std::path::absolute(root)?;
    let output = Arc::new(Mutex::new(io::BufWriter::new(io::stdout())));
    run_scan(
        root,
        build_scan_config(&ScanOptions::default())?,
        Arc::new(AtomicBool::new(false)),
        Arc::new(move |event| {
            let (kind, update) = match event {
                ScanEvent::Progress(update) => ("progress", update),
                ScanEvent::Complete(update) => ("complete", update),
                ScanEvent::Cancelled(update) => ("cancelled", update),
                ScanEvent::Error(failure) => panic!("{}", failure.message),
            };
            let mut writer = output.lock().unwrap();
            serde_json::to_writer(
                &mut *writer,
                &Event {
                    kind,
                    update: &update,
                },
            )
            .unwrap();
            writeln!(writer).unwrap();
        }),
        Some("verification".into()),
    )?;
    Ok(())
}
