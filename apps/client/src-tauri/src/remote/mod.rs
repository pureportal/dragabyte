mod operations;
mod protocol;
pub mod wire;

use std::{
    collections::HashMap,
    io::{self, BufReader, Write},
    net::{Shutdown, SocketAddr, TcpListener, TcpStream},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

use crate::scan::{build_scan_config, run_scan, ScanEmitter, ScanEvent, ScanFailure, ScanOptions};
use operations::{handle_remote_disk, handle_remote_list, handle_remote_read};
use protocol::{request_id, RemoteEnvelope, RemoteRequest};
use wire::LineReader;

const MAX_CONNECTIONS: usize = 50;
const MAX_REQUEST_BYTES: usize = 1024 * 1024;

#[derive(Clone)]
pub struct TcpConfig {
    pub bind_addr: SocketAddr,
    pub token: Option<String>,
}

pub struct RemoteServerHandle {
    pub address: SocketAddr,
    hub: Arc<RemoteHub>,
    join: Option<JoinHandle<()>>,
}

impl RemoteServerHandle {
    pub fn is_finished(&self) -> bool {
        self.join.as_ref().is_none_or(JoinHandle::is_finished)
    }

    pub fn stop(&self) {
        self.hub.stopped.store(true, Ordering::Relaxed);
    }

    pub fn wait(mut self) -> Result<(), String> {
        self.join
            .take()
            .unwrap()
            .join()
            .map_err(|_| "Management server failed".to_string())
    }
}

impl Drop for RemoteServerHandle {
    fn drop(&mut self) {
        self.stop();
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

struct Client {
    sender: mpsc::SyncSender<String>,
    socket: TcpStream,
    authenticated: AtomicBool,
}

impl Client {
    fn send(&self, message: String) {
        if self.sender.try_send(message).is_err() {
            let _ = self.socket.shutdown(Shutdown::Both);
        }
    }
}

struct ScanJob {
    cancel: Arc<AtomicBool>,
    join: JoinHandle<()>,
}

struct RemoteHub {
    clients: Mutex<HashMap<usize, Arc<Client>>>,
    scan: Mutex<Option<ScanJob>>,
    token: Option<String>,
    stopped: AtomicBool,
}

impl RemoteHub {
    fn broadcast(&self, message: String) {
        for client in self.clients.lock().unwrap().values() {
            if client.authenticated.load(Ordering::Relaxed) {
                client.send(message.clone());
            }
        }
    }

    fn cancel_scan(&self) -> bool {
        let scan = self.scan.lock().unwrap();
        if let Some(job) = scan.as_ref().filter(|job| !job.join.is_finished()) {
            job.cancel.store(true, Ordering::Relaxed);
            true
        } else {
            false
        }
    }
}

pub fn start_remote_server(
    config: TcpConfig,
    headless: bool,
) -> Result<RemoteServerHandle, String> {
    if config
        .token
        .as_ref()
        .is_some_and(|token| token.trim().is_empty())
    {
        return Err("TCP token must not be empty".into());
    }
    if !config.bind_addr.ip().is_loopback() && config.token.is_none() {
        return Err("A TCP token is required for non-loopback addresses".into());
    }
    let listener =
        TcpListener::bind(config.bind_addr).map_err(|error| format!("Failed to bind: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let address = listener.local_addr().map_err(|error| error.to_string())?;
    let hub = Arc::new(RemoteHub {
        clients: Mutex::new(HashMap::new()),
        scan: Mutex::new(None),
        token: config.token,
        stopped: AtomicBool::new(false),
    });
    let server_hub = Arc::clone(&hub);
    let join = thread::spawn(move || {
        let mut clients = Vec::<JoinHandle<()>>::new();
        let mut next_id = 0;
        while !server_hub.stopped.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => {
                    if server_hub.clients.lock().unwrap().len() >= MAX_CONNECTIONS {
                        continue;
                    }
                    let hub = Arc::clone(&server_hub);
                    let id = next_id;
                    next_id += 1;
                    let client = match configure_client(&stream) {
                        Ok(client) => client,
                        Err(error) => {
                            eprintln!("Connection failed: {error}");
                            continue;
                        }
                    };
                    server_hub
                        .clients
                        .lock()
                        .unwrap()
                        .insert(id, Arc::clone(&client.0));
                    clients.push(thread::spawn(move || {
                        handle_client(stream, hub, client, id, headless)
                    }));
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(25))
                }
                Err(error) => {
                    eprintln!("Accept failed: {error}");
                    break;
                }
            }
            let mut index = 0;
            while index < clients.len() {
                if clients[index].is_finished() {
                    let _ = clients.swap_remove(index).join();
                } else {
                    index += 1;
                }
            }
        }
        server_hub.stopped.store(true, Ordering::Relaxed);
        server_hub.cancel_scan();
        for client in server_hub.clients.lock().unwrap().values() {
            let _ = client.socket.shutdown(Shutdown::Read);
        }
        for client in clients {
            let _ = client.join();
        }
        if let Some(job) = server_hub.scan.lock().unwrap().take() {
            let _ = job.join.join();
        }
    });
    Ok(RemoteServerHandle {
        address,
        hub,
        join: Some(join),
    })
}

fn configure_client(stream: &TcpStream) -> io::Result<(Arc<Client>, mpsc::Receiver<String>)> {
    stream.set_read_timeout(Some(Duration::from_millis(200)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    stream.set_nodelay(true)?;
    let (sender, receiver) = mpsc::sync_channel(32);
    Ok((
        Arc::new(Client {
            sender,
            socket: stream.try_clone()?,
            authenticated: AtomicBool::new(false),
        }),
        receiver,
    ))
}

fn handle_client(
    stream: TcpStream,
    hub: Arc<RemoteHub>,
    (client, receiver): (Arc<Client>, mpsc::Receiver<String>),
    id: usize,
    headless: bool,
) {
    let mut writer = match stream.try_clone() {
        Ok(writer) => writer,
        Err(_) => {
            hub.clients.lock().unwrap().remove(&id);
            return;
        }
    };
    let writer_thread = thread::spawn(move || {
        for message in receiver {
            if writer.write_all(message.as_bytes()).is_err() {
                let _ = writer.shutdown(Shutdown::Both);
                break;
            }
        }
    });
    let mut reader = BufReader::new(stream);
    let mut lines = LineReader::default();
    while !hub.stopped.load(Ordering::Relaxed) {
        match lines.read(&mut reader, MAX_REQUEST_BYTES) {
            Ok(Some(line)) if !line.trim().is_empty() => {
                handle_remote_line(&line, &hub, &client, headless)
            }
            Ok(Some(_)) => {}
            Ok(None) => break,
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) => {}
            Err(_) => break,
        }
    }
    hub.clients.lock().unwrap().remove(&id);
    drop(client);
    let _ = writer_thread.join();
}

fn handle_remote_line(line: &str, hub: &Arc<RemoteHub>, client: &Client, headless: bool) {
    let envelope: RemoteEnvelope = match serde_json::from_str(line) {
        Ok(envelope) => envelope,
        Err(_) => return send_remote_error(client, None, "invalid_json"),
    };
    if hub
        .token
        .as_deref()
        .is_some_and(|expected| envelope.token.as_deref() != Some(expected))
    {
        send_remote_error(client, request_id(&envelope.request), "unauthorized");
        return;
    }
    client.authenticated.store(true, Ordering::Relaxed);
    match envelope.request {
        RemoteRequest::Ping { id } => {
            send_remote_event(client, serde_json::json!({"event": "pong", "id": id}))
        }
        RemoteRequest::List { id, path } => handle_remote_list(client, id, path),
        RemoteRequest::Disk { id, path } => handle_remote_disk(client, id, path),
        RemoteRequest::Read { id, path } => handle_remote_read(client, id, path),
        RemoteRequest::Scan { id, path, options } => {
            handle_remote_scan(hub, client, id, path, options.map(|options| *options))
        }
        RemoteRequest::Cancel { id } => {
            let event = if hub.cancel_scan() {
                "cancel-requested"
            } else {
                "no-active-scan"
            };
            send_remote_event(client, serde_json::json!({"event": event, "id": id}));
        }
        RemoteRequest::Shutdown { id } => {
            if headless {
                send_remote_event(client, serde_json::json!({"event": "shutdown", "id": id}));
                hub.stopped.store(true, Ordering::Relaxed);
            } else {
                send_remote_error(client, id.as_deref(), "shutdown-not-allowed");
            }
        }
    }
}

fn handle_remote_scan(
    hub: &Arc<RemoteHub>,
    client: &Client,
    id: Option<String>,
    path: String,
    options: Option<ScanOptions>,
) {
    let config = match build_scan_config(&options.unwrap_or_default()) {
        Ok(config) => config,
        Err(error) => return send_remote_error(client, id.as_deref(), &error),
    };
    let mut scan = hub.scan.lock().unwrap();
    if scan.as_ref().is_some_and(|job| !job.join.is_finished()) {
        return send_remote_error(client, id.as_deref(), "scan-in-progress");
    }
    if let Some(previous) = scan.take() {
        let _ = previous.join.join();
    }
    send_remote_event(
        client,
        serde_json::json!({"event": "scan-started", "id": id}),
    );
    let cancel = Arc::new(AtomicBool::new(false));
    let scan_cancel = Arc::clone(&cancel);
    let hub = Arc::clone(hub);
    let join = thread::spawn(move || {
        let emitter_hub = Arc::clone(&hub);
        let request_id = id.clone();
        let emitter: ScanEmitter = Arc::new(move |event| {
            let payload = match event {
                ScanEvent::Progress(data) => {
                    serde_json::json!({"event": "scan-progress", "id": request_id, "data": data})
                }
                ScanEvent::Complete(data) => {
                    serde_json::json!({"event": "scan-complete", "id": request_id, "data": data})
                }
                ScanEvent::Cancelled(data) => {
                    serde_json::json!({"event": "scan-cancelled", "id": request_id, "data": data})
                }
                ScanEvent::Error(failure) => {
                    serde_json::json!({"event": "scan-error", "id": request_id, "message": failure.message})
                }
            };
            emitter_hub.broadcast(format!("{payload}\n"));
        });
        if let Err(message) = run_scan(
            PathBuf::from(path),
            config,
            scan_cancel,
            Arc::clone(&emitter),
            id.clone(),
        ) {
            emitter(ScanEvent::Error(ScanFailure { id, message }));
        }
    });
    *scan = Some(ScanJob { cancel, join });
}

fn send_remote_event(client: &Client, value: serde_json::Value) {
    client.send(format!("{value}\n"));
}

fn send_remote_error(client: &Client, id: Option<&str>, message: &str) {
    send_remote_event(
        client,
        serde_json::json!({"event": "error", "id": id, "message": message}),
    );
}
