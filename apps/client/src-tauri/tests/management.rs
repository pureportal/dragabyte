use dragabyte::remote::{start_remote_server, TcpConfig};
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    net::{SocketAddr, TcpStream},
    thread,
    time::{Duration, Instant},
};

fn connect(address: SocketAddr) -> BufReader<TcpStream> {
    let stream = TcpStream::connect(address).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    BufReader::new(stream)
}

fn send(reader: &mut BufReader<TcpStream>, value: Value) {
    writeln!(reader.get_mut(), "{value}").unwrap();
}

fn receive(reader: &mut BufReader<TcpStream>) -> Value {
    let mut line = String::new();
    assert!(
        reader.read_line(&mut line).unwrap() > 0,
        "Connection closed before response"
    );
    serde_json::from_str(&line).unwrap()
}

#[test]
fn server_authenticates_streams_scans_and_shuts_down_without_desktop() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("hello.txt"), "hello").unwrap();
    let server = start_remote_server(
        TcpConfig {
            bind_addr: "127.0.0.1:0".parse().unwrap(),
            token: Some("test-secret".into()),
        },
        true,
    )
    .unwrap();
    let mut client = connect(server.address);
    let mut unauthenticated = connect(server.address);
    send(&mut client, json!({"action": "ping", "id": "denied"}));
    assert_eq!(receive(&mut client)["message"], "unauthorized");
    client
        .get_mut()
        .write_all(b"{\"action\":\"ping\",")
        .unwrap();
    thread::sleep(Duration::from_millis(350));
    client
        .get_mut()
        .write_all(b"\"id\":\"split\",\"token\":\"test-secret\"}\n")
        .unwrap();
    assert_eq!(receive(&mut client)["id"], "split");
    send(
        &mut client,
        json!({"action": "list", "path": root.path(), "token": "test-secret"}),
    );
    assert_eq!(receive(&mut client)["event"], "list-complete");
    send(
        &mut client,
        json!({"action": "disk", "path": root.path(), "token": "test-secret"}),
    );
    assert_eq!(receive(&mut client)["event"], "disk-info");
    send(
        &mut client,
        json!({"action": "read", "path": root.path().join("hello.txt"), "token": "test-secret"}),
    );
    assert_eq!(receive(&mut client)["data"]["content"], "aGVsbG8=");
    send(
        &mut client,
        json!({"action": "scan", "path": root.path(), "id": "scan-1", "options": {"filters": {}}, "token": "test-secret"}),
    );
    assert_eq!(receive(&mut client)["event"], "scan-started");
    loop {
        let update = receive(&mut client);
        assert_eq!(update["id"], "scan-1");
        if update["event"] == "scan-complete" {
            assert_eq!(update["data"]["totalBytes"], 5);
            break;
        }
    }
    unauthenticated
        .get_mut()
        .set_read_timeout(Some(Duration::from_millis(150)))
        .unwrap();
    let mut line = String::new();
    assert!(unauthenticated.read_line(&mut line).is_err());
    send(
        &mut client,
        json!({"action": "shutdown", "id": "stop", "token": "test-secret"}),
    );
    assert_eq!(receive(&mut client)["event"], "shutdown");
    let start = Instant::now();
    while !server.is_finished() && start.elapsed() < Duration::from_secs(5) {
        thread::sleep(Duration::from_millis(10));
    }
    assert!(server.is_finished());
    server.wait().unwrap();
}

#[test]
fn disconnected_clients_release_slots_and_desktop_rejects_shutdown() {
    let server = start_remote_server(
        TcpConfig {
            bind_addr: "127.0.0.1:0".parse().unwrap(),
            token: None,
        },
        false,
    )
    .unwrap();
    for _ in 0..60 {
        let mut client = connect(server.address);
        send(&mut client, json!({"action": "ping"}));
        assert_eq!(receive(&mut client)["event"], "pong");
    }
    let mut client = connect(server.address);
    send(&mut client, json!({"action": "shutdown"}));
    assert_eq!(receive(&mut client)["message"], "shutdown-not-allowed");
    server.stop();
    server.wait().unwrap();
}

#[test]
fn server_rejects_public_bind_without_nonempty_token() {
    for token in [None, Some(String::new()), Some("   ".into())] {
        assert!(start_remote_server(
            TcpConfig {
                bind_addr: "0.0.0.0:0".parse().unwrap(),
                token
            },
            true
        )
        .is_err());
    }
}

#[test]
fn cancel_stops_an_active_remote_scan_and_preserves_partial_totals() {
    let root = tempfile::tempdir().unwrap();
    for id in 0..1800 {
        std::fs::write(root.path().join(format!("file-{id}")), "x").unwrap();
    }
    let server = start_remote_server(
        TcpConfig {
            bind_addr: "127.0.0.1:0".parse().unwrap(),
            token: None,
        },
        true,
    )
    .unwrap();
    let mut client = connect(server.address);
    send(
        &mut client,
        json!({"action": "scan", "path": root.path(), "id": "cancel-scan", "options": {"priorityMode": "low", "throttleLevel": "high"}}),
    );
    assert_eq!(receive(&mut client)["event"], "scan-started");
    loop {
        let update = receive(&mut client);
        if update["event"] == "scan-progress" && update["data"]["fileCount"].as_u64().unwrap() > 0 {
            send(&mut client, json!({"action": "cancel", "id": "cancel"}));
            break;
        }
    }
    let mut acknowledged = false;
    let mut cancelled = false;
    while !acknowledged || !cancelled {
        let update = receive(&mut client);
        assert_ne!(update["event"], "scan-complete");
        if update["event"] == "cancel-requested" {
            acknowledged = true;
        }
        if update["event"] == "scan-cancelled" {
            let count = update["data"]["fileCount"].as_u64().unwrap();
            assert!(count > 0 && count < 1800);
            cancelled = true;
        }
    }
    server.stop();
    server.wait().unwrap();
}
