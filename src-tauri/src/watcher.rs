use notify::{Event, EventKind, RecursiveMode, Watcher};
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

pub fn start_workspace_watcher(app: AppHandle, workspace_path: impl AsRef<Path>) {
    let (tx, mut rx) = mpsc::channel::<PathBuf>(100);
    let workspace_path_str = workspace_path.as_ref().to_string_lossy().to_string();

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            if let EventKind::Modify(_) = event.kind {
                for path in event.paths {
                    let _ = tx.blocking_send(path);
                }
            }
        }
    })
    .expect("Failed to create watcher");

    watcher
        .watch(workspace_path.as_ref(), RecursiveMode::Recursive)
        .expect("Failed to watch directory");

    // We must keep the watcher alive, so we can spawn a task that holds it
    tokio::spawn(async move {
        let _watcher = watcher; // Keep alive

        let mut debounce_map = std::collections::HashMap::<PathBuf, tokio::time::Instant>::new();

        loop {
            // Read all events in the channel
            while let Some(path) = rx.recv().await {
                let now = tokio::time::Instant::now();
                if let Some(last_time) = debounce_map.get(&path) {
                    if now.duration_since(*last_time) < Duration::from_millis(500) {
                        continue;
                    }
                }
                debounce_map.insert(path.clone(), now);

                // Wait a bit to ensure file is completely written by external editor
                tokio::time::sleep(Duration::from_millis(100)).await;

                if let Ok(content) = std::fs::read_to_string(&path) {
                    let path_str = path.to_string_lossy().to_string();

                    // Lookup document_id from the correct workspace db pool
                    let state = app.state::<crate::AppState>();
                    let db_guard = state.dbs.lock().await;
                    if let Some(pool) = db_guard.get(&workspace_path_str) {
                        if let Ok(Some(row)) =
                            sqlx::query("SELECT id FROM documents WHERE file_path = ?")
                                .bind(&path_str)
                                .fetch_optional(pool)
                                .await
                        {
                            use sqlx::Row;
                            let doc_id: String = row.get("id");

                            let event = FileChangeEvent {
                                document_id: doc_id,
                                content,
                                file_path: path_str,
                            };

                            let _ = app.emit("file-changed", event);
                        }
                    }
                }
            }
        }
    });
}
