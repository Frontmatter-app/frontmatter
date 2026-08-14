use notify::{Event, EventKind, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;

#[derive(Clone, serde::Serialize)]
pub struct FileChangeEvent {
    pub document_id: String,
    pub content: String,
    pub file_path: String,
}

/// How long the workspace must be quiet before a burst of filesystem events is
/// treated as finished. Editors write, rename, and touch several files in quick
/// succession; reconciling per event meant a full workspace rescan for each one.
const QUIET_PERIOD: Duration = Duration::from_millis(400);

/// Path segments whose contents are never workspace content.
///
/// `.app` matters most: the workspace's own SQLite database lives there, so
/// every document save wrote a file *inside the watched tree*, which triggered a
/// reconcile, which emitted `workspace-reconciled`, which made the frontend
/// refetch and re-walk — a feedback loop driven by ordinary typing.
const IGNORED_SEGMENTS: &[&str] = &[".app", ".git", "node_modules", "target"];

fn is_ignored(path: &Path) -> bool {
    for component in path.components() {
        let part = component.as_os_str().to_string_lossy();
        if IGNORED_SEGMENTS.contains(&part.as_ref()) {
            return true;
        }
    }

    match path.file_name().and_then(|n| n.to_str()) {
        // Atomic saves stage content in a sibling temp file before renaming it
        // into place; reacting to those is pure noise.
        Some(name) => {
            name.ends_with('~')
                || name.ends_with(".tmp")
                || name.ends_with(".swp")
                || name.starts_with(".#")
        }
        None => false,
    }
}

/// Starts watching `workspace_path`, unless it is already being watched.
///
/// Watchers used to be started on every `open_workspace` and never stopped, so
/// switching between a personal and a team workspace a few times left several
/// running at once, each reconciling its own tree.
pub fn start_workspace_watcher(app: AppHandle, workspace_path: impl AsRef<Path>) {
    let workspace_path = workspace_path.as_ref().to_path_buf();
    let workspace_path_str = workspace_path.to_string_lossy().to_string();

    tauri::async_runtime::spawn(async move {
        {
            let state = app.state::<crate::AppState>();
            let watchers = state.watchers.lock().await;
            if watchers.contains_key(&workspace_path_str) {
                return;
            }
        }

        let app_for_task = app.clone();
        let path_for_task = workspace_path.clone();
        let path_str_for_task = workspace_path_str.clone();

        let task = tauri::async_runtime::spawn(async move {
            run_watcher(app_for_task, path_for_task, path_str_for_task).await;
        });

        let state = app.state::<crate::AppState>();
        let mut watchers = state.watchers.lock().await;
        // Another call may have won the race while this task was starting.
        if let Some(existing) = watchers.insert(workspace_path_str, task) {
            existing.abort();
        }
    });
}

/// Stops watching a workspace and forgets its handle.
pub async fn stop_workspace_watcher(app: &AppHandle, workspace_path: &str) {
    let state = app.state::<crate::AppState>();
    let mut watchers = state.watchers.lock().await;
    if let Some(task) = watchers.remove(workspace_path) {
        task.abort();
    }
}

async fn run_watcher(app: AppHandle, workspace_path: PathBuf, workspace_path_str: String) {
    let (tx, mut rx) = mpsc::channel::<PathBuf>(256);

    let mut watcher = match notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            if matches!(
                event.kind,
                EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
            ) {
                for path in event.paths {
                    if !is_ignored(&path) {
                        // A full channel means a burst larger than the buffer;
                        // the coalescing pass below rescans the tree anyway, so
                        // dropping the surplus loses nothing.
                        let _ = tx.try_send(path);
                    }
                }
            }
        }
    }) {
        Ok(watcher) => watcher,
        Err(e) => {
            eprintln!("[watcher] could not create watcher: {e}");
            return;
        }
    };

    if let Err(e) = watcher.watch(&workspace_path, RecursiveMode::Recursive) {
        eprintln!("[watcher] could not watch {}: {e}", workspace_path.display());
        return;
    }

    let _watcher = watcher; // dropped, and so unregistered, when this task is aborted

    // Documents whose file was missing on the previous pass. A document is only
    // removed after being absent twice, because an atomic save briefly unlinks
    // the file and a single-pass check would delete the row mid-save.
    let mut missing_last_pass: HashSet<String> = HashSet::new();

    loop {
        let Some(first) = rx.recv().await else { break };

        let mut touched: HashSet<PathBuf> = HashSet::new();
        touched.insert(first);

        // Coalesce until the workspace goes quiet.
        loop {
            match tokio::time::timeout(QUIET_PERIOD, rx.recv()).await {
                Ok(Some(path)) => {
                    touched.insert(path);
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }

        let pool = {
            let state = app.state::<crate::AppState>();
            let dbs = state.dbs.lock().await;
            dbs.get(&workspace_path_str).cloned()
        };
        let Some(pool) = pool else { continue };

        let report = match crate::workspace_sync::scan_workspace(&workspace_path, &pool).await {
            Ok(report) => report,
            Err(e) => {
                eprintln!("[watcher] scan failed: {e}");
                continue;
            }
        };

        let confirmed: Vec<String> = report
            .missing
            .iter()
            .filter(|id| missing_last_pass.contains(*id))
            .cloned()
            .collect();
        let removed = crate::workspace_sync::delete_documents(&pool, &confirmed).await;
        missing_last_pass = report.missing.into_iter().collect();

        // Only a structural change needs the frontend to refetch. Content edits
        // arrive through `file-changed` instead.
        if report.inserted > 0 || removed > 0 {
            let _ = app.emit("workspace-reconciled", ());
        }

        for path in touched {
            if !path.is_file() {
                continue;
            }
            let Ok(content) = std::fs::read_to_string(&path) else { continue };
            let path_str = path.to_string_lossy().to_string();

            if let Ok(Some(row)) = sqlx::query("SELECT id FROM documents WHERE file_path = ?")
                .bind(&path_str)
                .fetch_optional(&pool)
                .await
            {
                use sqlx::Row;
                let document_id: String = row.get("id");
                let _ = app.emit(
                    "file-changed",
                    FileChangeEvent {
                        document_id,
                        content,
                        file_path: path_str,
                    },
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_workspace_internals() {
        assert!(is_ignored(Path::new("/w/.app/project.db")));
        assert!(is_ignored(Path::new("/w/.app/project.db-wal")));
        assert!(is_ignored(Path::new("/w/.git/index")));
        assert!(is_ignored(Path::new("/w/node_modules/pkg/readme.md")));
    }

    #[test]
    fn ignores_editor_temp_files() {
        assert!(is_ignored(Path::new("/w/chapter.md~")));
        assert!(is_ignored(Path::new("/w/chapter.md.tmp")));
        assert!(is_ignored(Path::new("/w/.#chapter.md")));
    }

    #[test]
    fn allows_ordinary_documents() {
        assert!(!is_ignored(Path::new("/w/chapter.md")));
        assert!(!is_ignored(Path::new("/w/notes/one.md")));
    }
}
