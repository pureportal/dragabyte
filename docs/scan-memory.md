# Scan memory verification

Verified on Windows with Node 24.14.1 and headless Edge on October 7, 2026. The baseline is commit `f7bfe825672d014d1b641657aafc1acd7b572c01`. Individual measurements are recorded in [scan-memory-results.json](scan-memory-results.json).

Scan results now share one directory prefix per folder and generate full file paths when needed. Relocated folders retain that shared storage. Expanded file rows reference their files without copying paths and metadata. File merges allocate their final array size directly, and completion, cancellation, and disposal clear the result index while preserving published snapshots.

## Measurements

Each run used a fresh Node process. The fixture sends JSON-serialized batches of 1,024 files through the actual `ScanResults`, `ScanChanges`, and tree-building modules. It uses an approximately 90-character Windows folder prefix. Every run checks file counts, folder counts, byte totals, and the expanded row count.

The 250,000-file measurements are medians of three paired runs. The million-file measurements are one paired run. Values are MiB.

| Fixture | Measurement | Before | After | Reduction |
| --- | --- | ---: | ---: | ---: |
| 250,000 files, 5,000 folders | Retained heap | 68.64 | 37.21 | 46% |
| | Fully expanded heap | 91.67 | 54.53 | 41% |
| | Sampled peak heap | 142.59 | 102.60 | 28% |
| 250,000 files, one folder | Retained heap | 57.44 | 26.92 | 53% |
| | Fully expanded heap | 80.41 | 44.16 | 45% |
| | Sampled peak heap | 264.39 | 175.77 | 34% |
| 1,000,000 files, one folder | Retained heap | 227.07 | 102.90 | 55% |
| | Fully expanded heap | 320.95 | 173.90 | 46% |
| | Sampled peak heap | 917.73 | 481.87 | 47% |
| | Process peak resident memory | 1,077.21 | 629.00 | 42% |

Retained heap is measured after explicit garbage collection; expanded heap additionally retains all flattened file rows and the folder lookup map. Peak heap is sampled after each batch and after expansion, so allocations inside a batch can exceed it. Resident memory includes the Node runtime and allocator. These measurements exclude Tauri, its WebView, event delivery, and exports. Timings in the raw results were collected under varying machine load and are not a throughput claim. Shorter paths yield smaller savings. All discovered files remain accessible, so retained memory still grows with the result count.

## Regression checks

- All 39 frontend tests passed, covering incremental snapshots, ordering, cancellation, restart, deletion, rename, move, scoped refresh, Windows/POSIX/UNC paths, Unicode, metadata, and serialized file paths.
- All 37 native tests passed; the existing manual terminal benchmark remains ignored.
- Type checking, client lint, the production client build, and Rust formatting passed. The existing JavaScript bundle-size warning remains.
- All 26 browser tests passed against the production client build.
- The production build in headless Edge completed a 250,000-file scan and restart, displayed fewer than 30 file rows at once, scrolled to the final file, and passed the complete file path to the open command.
- A real filesystem fixture produced **537,248,768 bytes, 32,864 files, 835 folders, and zero skipped entries**. Its recorded native events were replayed through the production interface to verify counts and file paths.

The browser tests mock Tauri delivery and the open command. They verify the path passed to native code; they do not launch an external file handler. Packaged desktop memory and macOS/Linux were not measured.

## Further reduction: expanded file rows

The next pass replaces the expanded row array with an index of folders and contiguous file ranges. File rows are created only for the visible window or a keyboard navigation target. Folder/file ordering, equal-size ties, depth, empty-folder visibility, percentage bars, and file actions retain their existing behavior. The index grows with expanded folders rather than expanded files; every scanned file and its metadata remain stored.

This comparison uses the preceding memory optimization as its baseline, captured from the working tree before this pass. Both variants use the same updated measurement script, which verifies file counts and byte totals directly from the scan tree and requests only a visible row slice. The preceding table used an additional temporary row-filter array, so peak measurements from the two passes are not directly comparable.

Each Node fixture is measured in three alternating pairs of fresh processes. Browser measurements use three fresh headless Edge sessions per variant, the production client build, mocked scan events, and CDP garbage collection before reading the JavaScript heap. Raw measurements are in the `followUp` section of [scan-memory-results.json](scan-memory-results.json).

| Fixture | Expanded heap before (MiB) | Expanded heap after (MiB) | Further reduction |
| --- | ---: | ---: | ---: |
| Node: 250,000 files, 5,000 folders | 54.13 | 37.58 | 31% |
| Node: 250,000 files, one folder | 44.11 | 26.89 | 39% |
| Node: 1,000,000 files, one folder | 173.85 | 102.85 | 41% |
| Production build in Edge: 250,000 files, one folder | 44.30 | 35.69 | 19% |

Scanning storage and the event merge are unchanged. This pass targets the extra RAM used when file rows are expanded; it does not establish a reduction in scan-time peak heap or total packaged desktop RAM.

All 42 frontend tests passed, including new checks for indexed lookup, cross-folder ranges, stable ties, collapse, file visibility, percentage scales, and snapshots. The complete browser suite passed 25 tests; the native-event replay was skipped because no recording was supplied. The large-scan browser test passed three times per variant and continued to verify fewer than 30 rendered rows, the first and last file, the original open path, and scan restart. Client type checking, lint, the production build, and Git whitespace checks passed. Native code was unchanged.

## Reproduction

Measure the current implementation from the repository root:

```powershell
node --expose-gc --experimental-transform-types scripts/measure-scan-memory.mjs apps/client/src/features/scan 250000 nested
node --expose-gc --experimental-transform-types scripts/measure-scan-memory.mjs apps/client/src/features/scan 250000 wide
node --expose-gc --experimental-transform-types scripts/measure-scan-memory.mjs apps/client/src/features/scan 1000000 wide
```

To compare the baseline, copy `scanResults.ts`, `scanChanges.ts`, `scanPaths.ts`, `treeData.ts`, and `types.ts` from the baseline commit into a separate directory, then pass that directory as the first argument. Alternate baseline and current runs in separate processes.

Record native events using a new fixture directory:

```powershell
node scripts/create-scan-fixture.mjs "$env:TEMP/dragabyte-memory-fixture"
cargo run --locked --release --manifest-path apps/client/src-tauri/Cargo.toml --no-default-features --example scan-stream -- "$env:TEMP/dragabyte-memory-fixture" | Set-Content -Encoding utf8 "$env:TEMP/dragabyte-scan-events.jsonl"
npm run test:scan
npm run build:app
$env:DRAGABYTE_SCAN_EVENTS = "$env:TEMP/dragabyte-scan-events.jsonl"
$env:PLAYWRIGHT_CHANNEL = "msedge"
Push-Location apps/client
npx playwright test e2e/scan-memory.test.mjs
Pop-Location
```

The native replay test runs when `DRAGABYTE_SCAN_EVENTS` is set. The generated 250,000-file browser test always runs.

To record browser heap measurements after building the client:

```powershell
$env:DRAGABYTE_BROWSER_MEMORY_RESULTS = "$env:TEMP/dragabyte-browser-memory.jsonl"
$env:PLAYWRIGHT_CHANNEL = "msedge"
Push-Location apps/client
npx playwright test e2e/scan-memory.test.mjs --grep "large scan" --repeat-each 3
Pop-Location
```

The test appends one JSON record per run. Use separate output files and builds for each variant. The browser readings include the application's other JavaScript allocations and exclude native/WebView process memory.
