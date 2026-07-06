use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize, Deserialize)]
pub struct DraftNodeRecord {
    pub id: String,
    pub document_id: String,
    pub level: i32,
    pub title: String,
    pub notes: String,
}

#[tauri::command]
pub async fn sync_draft_nodes(
    window: tauri::Window,
    state: State<'_, crate::AppState>,
    document_id: String,
    nodes: Vec<DraftNodeRecord>,
) -> Result<(), String> {
    let label = window.label();
    let db_guard = state.dbs.lock().await;
    let ws_guard = state.window_workspaces.lock().await;
    let path = match ws_guard.get(label) {
        Some(p) => p,
        None => return Ok(()), // silently ignore if no workspace open
    };
    let pool = match db_guard.get(path) {
        Some(p) => p,
        None => return Ok(()),
    };

    let now = chrono::Utc::now().to_rfc3339();

    // Start transaction to clear and recreate
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    sqlx::query("DELETE FROM draft_nodes WHERE document_id = ?")
        .bind(&document_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    for node in nodes {
        sqlx::query("INSERT OR REPLACE INTO draft_nodes (id, document_id, level, title, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(&node.id)
            .bind(&document_id)
            .bind(&node.level)
            .bind(&node.title)
            .bind(&node.notes)
            .bind(&now)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(())
}
