# Scan verification

Verified on Windows on September 11, 2026.

The scanner now reads directories with a bounded worker pool, publishes discoveries before descending through entire subtrees, and updates ancestor totals incrementally. Progress contains ordered batches of new files and changed folders. Completion sends the remaining changes without rebuilding and transferring a complete nested tree.

The interface merges batches without discarding earlier files, coalesces rendering to roughly ten updates per second, and renders only the visible tree and subfolder table rows. Files are merged into size order incrementally. Folder state distinguishes unfinished results from confirmed empty folders; unfinished sizes display `≥`. Read failures and cancelled scans retain partial results.

## Native comparison

The fixture contains 32 groups of eight folders, each with 128 files, a 96-level branch, and 450 empty sibling folders. Its final result is **537,248,768 bytes, 32,864 files, and 835 folders**. Folder counts exclude the root.

The original scanner was captured before editing. Both implementations were run as release binaries against the same fixture with balanced priority, no throttling, and no filters. The callback serialized each event to JSON. These measurements exclude Tauri delivery, network transfer, and browser rendering.

| Measurement | Before, median of 3 | After, median of 3 |
| --- | ---: | ---: |
| Scan and event serialization | 1,490 ms | 84 ms |
| First immediate child folders | 719 ms | 1 ms |
| First folders below immediate children | 1,490 ms | 21 ms |

Final paired run durations were 1,533 / 1,490 / 1,452 ms before and 90 / 84 / 77 ms after. An earlier comparison measured medians of 1,015 ms and 95 ms. Every run matched the fixture's expected bytes and counts. This is a local cached filesystem comparison, not a cross-platform performance guarantee.

The new stream sent about 6.76 MB over 35 events, compared with 5.59 MB over four events before. The extra data makes every discovered file and folder available progressively; the old progress payload omitted deeper folders, capped sibling folders at 400, and capped files at 32 per displayed folder. The new stream avoids a large final snapshot but does not reduce total wire bytes on this short fixture.

## Checks

- Six Rust scanner tests cover partial size growth, discovery before completion, final totals for each ancestor, hidden entries, wide and empty folders, 128-level nesting, filters and excluded subtrees, cancellation, read failures, and invalid input.
- Seven TypeScript tests cover immutable incremental results, retained files, size ordering, ancestor state updates, pending folder visibility, 5,000-level tree traversal, event ordering, yielding and coalescing, completion, and disposal during restart.
- Browser checks used the production build in headless Edge with mocked Tauri calls. They replayed real native scan events and checked discovery, navigation during scanning, live updates in the details dialog, final counts, cancellation, stale errors, failed starts, and listener cleanup.
- A browser stress stream with 100,000 files and 5,000 folders rendered at most 22 tree rows and 17 subfolder table rows. Expansion, selection, and scrolling to the last rows worked. The final measured run recorded no JavaScript long tasks over 50 ms, a maximum frame gap of 44 ms, and a 191 ms automated collapse interaction. Earlier runs under different machine load recorded occasional longer tasks.
- TypeScript checks, lint with zero warnings, the production build, and the Rust desktop compilation check passed. The existing JavaScript bundle-size warning remains.

Reproduce the fixture in a new directory:

```powershell
node scripts/create-scan-fixture.mjs "$env:TEMP/dragabyte-scan-fixture"
```

Run the regression checks:

```powershell
npm run test:scan
npm run typecheck
npm run lint
npm run build
cargo test --locked --manifest-path apps/client/src-tauri/Cargo.toml --no-default-features --lib scan::tests
cargo check --locked --manifest-path apps/client/src-tauri/Cargo.toml --no-default-features --features desktop --bin dragabyte
```

## Limits

The packaged desktop WebView, macOS/Linux filesystems, and network-share throughput were not tested. Tests used stable fixtures and logical file lengths, not allocated disk space. Hidden entries are included; symbolic links are not followed. Read failures are reported rather than counted as zero-byte successes.

Local and remote consumers must use the updated scan event contract: apply every batch in sequence, including the final completion or cancellation batch. A completion event alone is no longer a complete tree. Remote peers using the previous event format need to be updated together.
