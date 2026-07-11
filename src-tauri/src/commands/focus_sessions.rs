use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
pub struct FocusSessionMeta {
    pub id: String,
    pub document_id: String,
    pub words_written: i32,
    pub started_at: String,
    pub ended_at: Option<String>,
}

#[tauri::command]
pub async fn save_focus_session(
    window: tauri::Window,
    state: State<'_, crate::AppState>,
    document_id: String,
    words_written: i32,
    started_at: String,
) -> Result<FocusSessionMeta, String> {
    let label = window.label();
    let ws_guard = state.window_workspaces.lock().await;
    let path = ws_guard
        .get(label)
        .ok_or("No workspace open for this window")?;
    let pool = state
        .dbs
        .lock()
        .await
        .get(path)
        .cloned()
        .ok_or("No database pool for this workspace")?;
    drop(ws_guard);

    let id = uuid::Uuid::new_v4().to_string();
    let ended_at = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO focus_sessions (id, document_id, words_written, started_at, ended_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&document_id)
    .bind(words_written)
    .bind(&started_at)
    .bind(&ended_at)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(FocusSessionMeta {
        id,
        document_id,
        words_written,
        started_at,
        ended_at: Some(ended_at),
    })
}
