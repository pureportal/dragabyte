use crate::scan::{run_scan, ScanConfig, ScanEmitter, ScanEvent, ScanFailure};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread::{self, JoinHandle},
};

pub(super) struct ScanWorker {
    pub receiver: Option<mpsc::Receiver<ScanEvent>>,
    pub cancel: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

impl ScanWorker {
    pub fn start(root: PathBuf, config: ScanConfig, cancel: Arc<AtomicBool>) -> Self {
        let (sender, receiver) = mpsc::sync_channel(8);
        let scan_cancel = Arc::clone(&cancel);
        let join = thread::spawn(move || {
            let emit_cancel = Arc::clone(&scan_cancel);
            let emitter: ScanEmitter = Arc::new(move |event| {
                if sender.send(event).is_err() {
                    emit_cancel.store(true, Ordering::Relaxed);
                }
            });
            if let Err(message) = run_scan(root, config, scan_cancel, Arc::clone(&emitter), None) {
                emitter(ScanEvent::Error(ScanFailure { id: None, message }));
            }
        });
        Self {
            receiver: Some(receiver),
            cancel,
            join: Some(join),
        }
    }

    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::Relaxed);
    }
}

impl Drop for ScanWorker {
    fn drop(&mut self) {
        self.cancel();
        self.receiver.take();
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}
