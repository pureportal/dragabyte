use super::{
    find_empty_folders, remove_empty_folders, EmptyFolderOptions, EmptyFolderPreview,
    FolderProgress, RemovalResult,
};
use crate::filesystem::{emit_filesystem_change, FilesystemChange};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, State, Window};

struct Operation {
    id: String,
    cancel: Arc<AtomicBool>,
}

#[derive(Default)]
struct WindowState {
    operation: Option<Operation>,
    preview: Option<(String, EmptyFolderPreview)>,
}

#[derive(Clone, Default)]
pub struct EmptyFolderState(Arc<Mutex<HashMap<String, WindowState>>>);

impl EmptyFolderState {
    fn start(
        &self,
        owner: &str,
        id: &str,
        preview_id: Option<&str>,
    ) -> Result<(Arc<AtomicBool>, Option<EmptyFolderPreview>), String> {
        let mut windows = self
            .0
            .lock()
            .map_err(|_| "Could not lock empty folder state.")?;
        let state = windows.entry(owner.to_string()).or_default();
        if state.operation.is_some() {
            return Err("An empty folder operation is still running.".into());
        }
        let preview = if let Some(id) = preview_id {
            Some(
                state
                    .preview
                    .as_ref()
                    .filter(|(saved, _)| saved == id)
                    .ok_or("Preview expired. Find folders again.")?
                    .1
                    .clone(),
            )
        } else {
            state.preview = None;
            None
        };
        let cancel = Arc::new(AtomicBool::new(false));
        state.operation = Some(Operation {
            id: id.to_string(),
            cancel: Arc::clone(&cancel),
        });
        Ok((cancel, preview))
    }

    fn finish(
        &self,
        owner: &str,
        preview: Option<(String, EmptyFolderPreview)>,
    ) -> Result<(), String> {
        let mut windows = self
            .0
            .lock()
            .map_err(|_| "Could not lock empty folder state.")?;
        let state = windows.entry(owner.to_string()).or_default();
        state.operation = None;
        if let Some(preview) = preview {
            state.preview = Some(preview);
        }
        Ok(())
    }
}

fn progress_emitter(window: Window, id: String, removal: bool) -> impl FnMut(usize, usize, &str) {
    let mut last = Instant::now() - Duration::from_secs(1);
    move |processed, count, path| {
        if last.elapsed() < Duration::from_millis(100) && (!removal || processed < count) {
            return;
        }
        last = Instant::now();
        if let Err(error) = window.emit(
            "empty-folders-progress",
            FolderProgress {
                id: id.clone(),
                processed,
                total: removal.then_some(count),
                found: if removal { 0 } else { count },
                path: path.to_string(),
            },
        ) {
            eprintln!("Could not report empty folder progress: {error}");
        }
    }
}

#[tauri::command]
pub async fn preview_empty_folders(
    window: Window,
    state: State<'_, EmptyFolderState>,
    paths: Vec<String>,
    options: EmptyFolderOptions,
    id: String,
) -> Result<EmptyFolderPreview, String> {
    let owner = window.label().to_string();
    let (cancel, _) = state.start(&owner, &id, None)?;
    let state = state.inner().clone();
    let progress = progress_emitter(window, id.clone(), false);
    let result = tauri::async_runtime::spawn_blocking(move || {
        find_empty_folders(paths, &options, &cancel, progress)
    })
    .await;
    let result = result
        .map_err(|error| error.to_string())
        .and_then(|result| result);
    let saved = result
        .as_ref()
        .ok()
        .filter(|preview| !preview.cancelled)
        .map(|preview| (id, preview.clone()));
    state.finish(&owner, saved)?;
    result
}

#[tauri::command]
pub async fn remove_empty_folders_preview(
    window: Window,
    state: State<'_, EmptyFolderState>,
    paths: Vec<String>,
    preview_id: String,
    id: String,
) -> Result<RemovalResult, String> {
    let owner = window.label().to_string();
    let (cancel, preview) = state.start(&owner, &id, Some(&preview_id))?;
    let state = state.inner().clone();
    let preview = preview.ok_or("Preview expired. Find folders again.")?;
    let progress = progress_emitter(window.clone(), id, true);
    let event_window = window.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let result = remove_empty_folders(&preview, paths, &cancel, progress);
        if let Ok(result) = &result {
            for outcome in result
                .outcomes
                .iter()
                .filter(|outcome| outcome.error.is_none())
            {
                emit_filesystem_change(
                    &event_window,
                    FilesystemChange::Delete {
                        path: outcome.path.clone(),
                    },
                );
            }
        }
        result
    })
    .await;
    state.finish(&owner, None)?;
    result.map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn cancel_empty_folders(
    window: Window,
    state: State<'_, EmptyFolderState>,
    id: String,
) -> Result<(), String> {
    let windows = state
        .0
        .lock()
        .map_err(|_| "Could not lock empty folder state.")?;
    if let Some(operation) = windows
        .get(window.label())
        .and_then(|state| state.operation.as_ref())
        .filter(|operation| operation.id == id)
    {
        operation.cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn operations_are_exclusive_per_window_and_previews_are_scoped() {
        let state = EmptyFolderState::default();
        state.start("first", "scan", None).unwrap();
        assert!(state.start("first", "other", None).is_err());
        state.start("second", "scan", None).unwrap();
        state
            .finish(
                "first",
                Some(("preview".into(), EmptyFolderPreview::default())),
            )
            .unwrap();
        assert!(state.start("first", "remove", Some("wrong")).is_err());
        assert!(state.start("first", "remove", Some("preview")).is_ok());
        assert!(state.start("second", "remove", Some("preview")).is_err());
        state.finish("first", None).unwrap();
        state.start("first", "rescan", None).unwrap();
        state.finish("first", None).unwrap();
        assert!(state.start("first", "remove", Some("preview")).is_err());
    }
}
