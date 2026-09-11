# Terminal verification

Verified on 11 September 2026 with Windows x86-64, Rust 1.97.1, Node 24.14.1, and the existing working tree. Pre-existing frontend and scanner changes were retained and integrated.

## Results

| Check | Result |
| --- | --- |
| Windows CLI release build | Passed; executable approximately 3.3 MB |
| Rust scanner, explorer, reporting, and management tests | 17 passed; one manual benchmark excluded from the ordinary test run |
| Manual benchmark | Passed separately in release mode |
| Clippy for core, CLI, and tests with warnings denied | Passed |
| Core build with both desktop and terminal features disabled | Passed |
| Linux GNU target check, including test code | Passed by cross-compilation on Windows |
| Linux musl release executable | Built with `rust-lld`; ELF x86-64, no interpreter segment or shared-library dependencies |
| Windows ConPTY interaction | Passed: graph, folder entry/back, filter, largest files, locate file, refresh, resize, quit, and alternate-screen restoration |
| Windows filesystem junctions | A junction to an outside folder and a junction loop were skipped; the ordinary file was counted once |
| Standalone management process | Started with DISPLAY/Wayland variables absent; dynamic port, ping, shutdown acknowledgement, and clean exit passed |
| Management integration | Authentication, prevention of unauthenticated scan broadcasts, split requests across read timeouts, list/disk/read, streamed scan totals, cancellation, connection-slot release, and desktop shutdown rejection passed |
| Desktop Rust check | Passed with only the desktop feature enabled |
| Full Windows Tauri build | `npm run tauri:build -- --no-bundle --debug` passed |
| Frontend | Typecheck, lint, production build, all seven scan tests, and version synchronization check passed |
| Formatting / whitespace | Cargo formatting and Git whitespace checks passed |

The earlier dependency mismatch was absent in this checkout: Rust Tauri 2.11.5 and npm API 2.11.1 share the required minor version, and dialog, filesystem, process, and updater plugins align. Tauri's actual build-time version check passed. Its environment report did not detect the installed Visual Studio 18 tools, but native compilation and linking succeeded.

The desktop build retained existing warnings about its large frontend bundle and the `.app` bundle-identifier suffix. Installers, signing, desktop GUI interaction, and updater installation were not exercised.

## Performance

The real scan used the workspace's `node_modules`: 16,983 files, 1,472 folders, 339,930,437 apparent bytes, and zero unreadable entries. Three runs per worker setting produced complete JSON reports of approximately 3.47 MB.

| Workers | Scanner time range | Median scanner time | Median process/report time |
| --- | --- | --- | --- |
| 1 | 587–938 ms | 842 ms | 1.234 s |
| 8 | 160–252 ms | 214 ms | 1.200 s |

These are local runs with filesystem caching and concurrent build activity. Process/report time includes startup, scanning, JSON serialization, and capturing stdout; it is not interchangeable with scanner time. No cache flushing or competing-tool benchmark was performed.

A separate in-memory benchmark used 50,000 immediate child folders and a 120×30 terminal viewport:

| Operation | Release result |
| --- | --- |
| Initial sorted listing | 2.77 ms |
| 1,000 folder-entry/back round trips | 851.6 ms total; 0.852 ms average |
| 1,000 viewport renders | 873.0 ms total; 0.873 ms average |

The benchmark also exposed unnecessary name normalization when no filter was active; removing it reduced the measured navigation cost. Cached navigation still copies row IDs, and memory remains proportional to discovered entries. These measurements do not predict cold disks, network mounts, or million-entry memory usage.

## Reproduce

```sh
cargo test --manifest-path apps/client/src-tauri/Cargo.toml --locked --lib --bin dragabyte-cli --tests
cargo clippy --manifest-path apps/client/src-tauri/Cargo.toml --locked --lib --bin dragabyte-cli --tests -- -D warnings
cargo check --manifest-path apps/client/src-tauri/Cargo.toml --locked --no-default-features --lib
cargo build --manifest-path apps/client/src-tauri/Cargo.toml --locked --release --bin dragabyte-cli
cargo test --manifest-path apps/client/src-tauri/Cargo.toml --release --lib navigation_benchmark -- --ignored --nocapture
python -m pip install pyte "pywinpty; sys_platform == 'win32'"
python scripts/verify-terminal.py apps/client/src-tauri/target/release/dragabyte-cli
```

Append `.exe` to the last path on Windows. `--artifacts PATH` saves the terminal screen and session. The Terminal workflow runs native Rust tests and the terminal exercise on Windows and Linux without installing desktop libraries.

The Linux musl build on Windows used an installed `x86_64-unknown-linux-musl` Rust target:

```sh
cargo rustc --manifest-path apps/client/src-tauri/Cargo.toml --target x86_64-unknown-linux-musl --release --bin dragabyte-cli -- -C linker=rust-lld -C linker-flavor=ld.lld
```

## Limits

**Linux execution was not tested locally.** WSL's registered Rancher Desktop distribution could not start because its virtual disk was missing; Docker's daemon was unavailable. Linux TUI interaction, signals, permissions, symlinks, and real server operation therefore remain runtime checks for the added CI workflow or a Linux machine. The workflow was added but not run remotely during this task.

Windows tests covered a disappearing directory as an unreadable entry, not a real permission-denied ACL. Network filesystems, interrupted filesystem syscalls, non-UTF-8 Linux filenames, and unusually deep platform path limits remain untested. Folder totals use apparent size and count each hard-link path; see [usage and accounting limits](terminal.md).
