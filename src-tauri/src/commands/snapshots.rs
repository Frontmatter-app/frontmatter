use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;

const MAX_SNAPSHOTS: i32 = 50;

#[derive(Serialize, Deserialize, Clone)]
pub struct SnapshotMeta {
    pub id: String,
    pub document_id: String,
    pub created_at: String,
    pub label: Option<String>,
    pub word_count: Option<i32>,
    pub author: Option<String>,
}

#[tauri::command]
pub async fn save_snapshot(
    window: tauri::Window,
    state: State<'_, crate::AppState>,
    document_id: String,
    snapshot: Vec<u8>,
    label: Option<String>,
    word_count: Option<i32>,
    author: Option<String>,
) -> Result<SnapshotMeta, String> {
    let label_str = window.label();
    let db_guard = state.dbs.lock().await;
    let ws_guard = state.window_workspaces.lock().await;

    let path = ws_guard
        .get(label_str)
        .ok_or("No workspace open for this window")?;
    let pool = db_guard
        .get(path)
        .ok_or("No database pool for this workspace")?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO document_versions (id, document_id, snapshot, created_at, label, word_count, author) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&document_id)
    .bind(&snapshot)
    .bind(&now)
    .bind(&label)
    .bind(&word_count)
    .bind(&author)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    drop((db_guard, ws_guard));
    prune_old_snapshots(&window, &state, &document_id).await?;

    Ok(SnapshotMeta {
        id,
        document_id,
        created_at: now,
        label,
        word_count,
        author,
    })
}

async fn prune_old_snapshots(
    window: &tauri::Window,
    state: &State<'_, crate::AppState>,
    document_id: &str,
) -> Result<(), String> {
    let label = window.label();
    let db_guard = state.dbs.lock().await;
    let ws_guard = state.window_workspaces.lock().await;

    let path = ws_guard
        .get(label)
        .ok_or("No workspace open for this window")?;
    let pool = db_guard
        .get(path)
        .ok_or("No database pool for this workspace")?;

    let count: i32 = sqlx::query_scalar("SELECT COUNT(*) FROM document_versions WHERE document_id = ?")
        .bind(document_id)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;

    if count > MAX_SNAPSHOTS {
        let excess = (count - MAX_SNAPSHOTS) as i32;
        let rows = sqlx::query("SELECT id FROM document_versions WHERE document_id = ? ORDER BY created_at ASC LIMIT ?")
            .bind(document_id)
            .bind(excess)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

        for row in rows {
            let old_id: String = row.get("id");
            sqlx::query("DELETE FROM document_versions WHERE id = ?")
                .bind(&old_id)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn get_snapshots(
    window: tauri::Window,
    state: State<'_, crate::AppState>,
    document_id: String,
) -> Result<Vec<SnapshotMeta>, String> {
    let label = window.label();
    let db_guard = state.dbs.lock().await;
    let ws_guard = state.window_workspaces.lock().await;

    let path = ws_guard
        .get(label)
        .ok_or("No workspace open for this window")?;
    let pool = db_guard
        .get(path)
        .ok_or("No database pool for this workspace")?;

    let rows = sqlx::query("SELECT id, document_id, created_at, label, word_count, author FROM document_versions WHERE document_id = ? ORDER BY created_at DESC")
        .bind(document_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut metas = Vec::new();
    for row in rows {
        metas.push(SnapshotMeta {
            id: row.get::<Option<String>, _>("id").unwrap_or_default(),
            document_id: row
                .get::<Option<String>, _>("document_id")
                .unwrap_or_default(),
            created_at: row
                .get::<Option<String>, _>("created_at")
                .unwrap_or_default(),
            label: row.get("label"),
            word_count: row.get("word_count"),
            author: row.get("author"),
        });
    }

    Ok(metas)
}

#[tauri::command]
pub async fn get_snapshot_data(
    window: tauri::Window,
    state: State<'_, crate::AppState>,
    id: String,
) -> Result<Vec<u8>, String> {
    let label = window.label();
    let db_guard = state.dbs.lock().await;
    let ws_guard = state.window_workspaces.lock().await;

    let path = ws_guard
        .get(label)
        .ok_or("No workspace open for this window")?;
    let pool = db_guard
        .get(path)
        .ok_or("No database pool for this workspace")?;

    let row = sqlx::query("SELECT snapshot FROM document_versions WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(row.get("snapshot"))
}

#[tauri::command]
pub async fn delete_snapshot(
    window: tauri::Window,
    state: State<'_, crate::AppState>,
    id: String,
) -> Result<(), String> {
    let label = window.label();
    let db_guard = state.dbs.lock().await;
    let ws_guard = state.window_workspaces.lock().await;

    let path = ws_guard
        .get(label)
        .ok_or("No workspace open for this window")?;
    let pool = db_guard
        .get(path)
        .ok_or("No database pool for this workspace")?;

    sqlx::query("DELETE FROM document_versions WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn clear_document_history(
    window: tauri::Window,
    state: State<'_, crate::AppState>,
    document_id: String,
) -> Result<(), String> {
    let label = window.label();
    let db_guard = state.dbs.lock().await;
    let ws_guard = state.window_workspaces.lock().await;

    let path = ws_guard
        .get(label)
        .ok_or("No workspace open for this window")?;
    let pool = db_guard
        .get(path)
        .ok_or("No database pool for this workspace")?;

    sqlx::query("DELETE FROM document_versions WHERE document_id = ?")
        .bind(document_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn create_snapshot(
    window: tauri::Window,
    state: State<'_, crate::AppState>,
    document_id: String,
    snapshot: Vec<u8>,
    label: Option<String>,
    word_count: Option<i32>,
    author: Option<String>,
) -> Result<SnapshotMeta, String> {
    save_snapshot(window, state, document_id, snapshot, label, word_count, author).await
}
