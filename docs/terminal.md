# Terminal

Build with Rust 1.88 or newer:

```sh
cargo build --manifest-path apps/client/src-tauri/Cargo.toml --release --bin dragabyte-cli
```

The executable is `apps/client/src-tauri/target/release/dragabyte-cli` (`.exe` on Windows). It needs no Node, Tauri, GTK, WebKit, X11, or Wayland session. Run it in a terminal, including over SSH:

```sh
dragabyte-cli
dragabyte-cli /data
dragabyte-cli "C:\Users\me\Downloads"
dragabyte-cli /data --exclude 'node_modules|\.git' --threads 1
```

Without a path, the scan starts in the process's working directory. Exclusion regexes are case-insensitive, and excluded folders are pruned before traversal. Use `--threads 1` for a rotating disk; automatic parallelism is bounded for SSDs and servers. Symbolic links and Windows junctions are not traversed. An explicitly selected root is resolved before scanning.

The explorer displays discovered folders while scanning continues. Folder navigation, filtering, and sorting operate on the scan in memory. `~` marks a folder still scanning; `!` marks incomplete results. Unreadable entries leave partial totals and a visible error count. Refresh rescans the original root.

| Key | Action |
| --- | --- |
| Arrows or j/k | Select an entry |
| Enter or l | Open a folder; locate a file from Largest files |
| Backspace, left, or h | Parent folder |
| g | Scan root |
| / | Filter names in this folder |
| s / n / c | Sort by size / name / file count |
| v | Reverse order |
| d | Folders only |
| t | Largest 100 nonempty files across the scan |
| r | Rescan root |
| Esc | Clear filter, close Largest files, or stop scanning |
| q or Ctrl+C | Quit |
| ? | Keys |

Use `--no-color` or `NO_COLOR` to disable colors and `--ascii` for ASCII graphs and borders. Terminal control characters in filenames are replaced on display. Normal Unicode names are retained. The explorer does not modify scanned files.

## Reports

```sh
dragabyte-cli scan /data --top 20
dragabyte-cli scan /data --json > usage.json
dragabyte-cli scan /data --ascii > usage.txt
```

Non-terminal output automatically uses a text report. JSON contains the full folder index and file list, with folder IDs, parent IDs, byte totals, counts, elapsed time, and completion status. It can be processed without parsing terminal formatting. Redirect reports outside the scanned tree to avoid including the report itself.

Exit codes: `0` success, `1` failure, `2` incomplete results or invalid command arguments, `130` cancelled report. A stopped scan retains collected data. Filesystem operations already in progress may delay cancellation, particularly on network mounts.

Folder totals measure **apparent file size**, matching desktop scan totals. The disk meter measures volume capacity and available space. Sparse/compressed files, hard links counted at each path, filesystem metadata, and inaccessible files can make these numbers differ. Allocated-block accounting, hard-link deduplication, mount-boundary controls, snapshot import, and deletion are outside this terminal implementation. Memory grows with discovered entries. Non-UTF-8 names are displayed and exported with replacement characters; navigation uses numeric IDs.

## Management server

```sh
dragabyte-cli serve --bind 127.0.0.1:4799
```

`DRAGABYTE_TCP_BIND` and `DRAGABYTE_TCP_TOKEN` supply defaults for `--bind` and `--token`. A nonempty token is required for non-loopback binding. The protocol is unencrypted; use loopback with an SSH tunnel for remote access. The token grants access to scanning, directory listing, file previews, disk information, cancellation, and shutdown. There is no filesystem sandbox.

Connect from the desktop Remote Dashboard or send newline-delimited JSON:

```json
{"action":"ping","id":"1"}
{"action":"scan","id":"scan-1","path":"/data"}
{"action":"cancel","id":"2"}
{"action":"shutdown","id":"3"}
```

When a token is configured, include `"token":"…"` in every request. Scan events use the same indexed update protocol as the desktop. Connected clients receive scan events after their first authenticated request. Scan cancellation is server-wide. Shutdown stops the standalone server; a desktop-hosted server rejects shutdown. Slow clients are disconnected when their bounded output queue fills; reconnect and start a new scan.

The desktop executable still accepts its headless flags and now enters the shared server before initializing Tauri. Its build includes desktop libraries, so use `dragabyte-cli serve` on machines without those libraries. Desktop updating remains in the desktop application; deploy standalone CLI updates through your normal package or service workflow.

## Design and research

The implementation reuses the indexed scanner already being developed in the working tree. The core library owns scanning, disk queries, protocol handling, and the management server. Cargo's default `terminal` feature builds the terminal executable. The `desktop` feature enables Tauri and its build dependencies; Tauri's configuration selects it for desktop commands. `--no-default-features --lib` checks the core alone.

| Source | Decision informed |
| --- | --- |
| [ncdu manual](https://dev.yorhel.nl/ncdu/man) | Keyboard drill-down, size/share graphs, cancellation, and distinguishing apparent size from disk allocation |
| [gdu](https://github.com/dundee/gdu) | Live scanning, largest files, filtering, reports, ASCII/color controls, and explicit worker tuning for rotating disks |
| [dua-cli](https://github.com/Byron/dua-cli) | Parallel scanning paired with interactive exploration |
| [Ratatui](https://docs.rs/ratatui/latest/ratatui/) and [Crossterm](https://docs.rs/crossterm/latest/crossterm/) | Cross-platform terminal rendering, resize handling, key events, terminal restoration, and deterministic rendering tests |
| [Ratatui error handling](https://ratatui.rs/tutorials/counter-app/error-handling/) | Restore the terminal on both errors and panics |
| [jwalk](https://docs.rs/jwalk/latest/jwalk/) | Reassess traversal and parallelism; retain the shared bounded scanner rather than add a second filesystem walker |
| [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux) | Keep desktop runtime dependencies out of the CLI build graph |

Directory listings cache their sort order until relevant updates arrive. The terminal renders only visible rows, independent of folder width. Scanner-to-terminal delivery is bounded, and only changed scan data crosses the channel. See [verification](terminal-verification.md) for measured results and platform limits.
