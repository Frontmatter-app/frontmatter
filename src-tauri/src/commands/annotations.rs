use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;

#[derive(Serialize, Deserialize)]
pub struct AnnotationRecord {
    pub id: String,
    pub document_id: String,
    pub start_pos: String,
    pub end_pos: String,
    pub selected_text: String,
    pub note: String,
    pub author_id: String,
    pub resolved: bool,
    pub created_at: String,
    /// A JSON array, written whole. The authoritative copy is the `Y.Array` in
    /// the document, which is what merges concurrent replies; this column only
    /// has to survive a reload, so the shape the frontend already holds is the
    /// cheapest thing to store.
    #[serde(default)]
    pub replies: Option<String>,
}

#[tauri::command]
pub async fn save_annotation(
    window: tauri::Window,
    state: State<'_, crate::AppState>,
    annotation: AnnotationRecord,
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

    sqlx::query("INSERT INTO annotations (id, document_id, start_pos, end_pos, selected_text, note, author_id, resolved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET resolved = excluded.resolved, note = excluded.note")
        .bind(&annotation.id)
        .bind(&annotation.document_id)
        .bind(&annotation.start_pos)
        .bind(&annotation.end_pos)
        .bind(&annotation.selected_text)
        .bind(&annotation.note)
        .bind(&annotation.author_id)
        .bind(if annotation.resolved { 1 } else { 0 })
        .bind(&annotation.created_at)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn resolve_annotation(
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

    sqlx::query("UPDATE annotations SET resolved = 1 WHERE id = ?")
        .bind(&id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Replaces the stored reply thread for one annotation.
///
/// Whole-thread writes are safe here precisely because they are not the merge
/// point: replies converge in the document's `Y.Array`, and this only records
/// the result so it survives a reload.
#[tauri::command]
pub async fn save_annotation_replies(
    window: tauri::Window,
    state: State<'_, crate::AppState>,
    id: String,
    replies: String,
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

    sqlx::query("UPDATE annotations SET replies = ? WHERE id = ?")
        .bind(&replies)
        .bind(&id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_annotations(
    window: tauri::Window,
    state: State<'_, crate::AppState>,
    document_id: String,
) -> Result<Vec<AnnotationRecord>, String> {
    let label = window.label();
    let db_guard = state.dbs.lock().await;
    let ws_guard = state.window_workspaces.lock().await;
    let path = ws_guard
        .get(label)
        .ok_or("No workspace open for this window")?;
    let pool = db_guard
        .get(path)
        .ok_or("No database pool for this workspace")?;

    let rows = sqlx::query("SELECT id, document_id, start_pos, end_pos, selected_text, note, author_id, resolved, created_at, replies FROM annotations WHERE document_id = ?")
        .bind(document_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut records = Vec::new();
    for row in rows {
        records.push(AnnotationRecord {
            id: row.get("id"),
            document_id: row.get("document_id"),
            start_pos: row.get("start_pos"),
            end_pos: row.get("end_pos"),
            selected_text: row.get("selected_text"),
            note: row.get("note"),
            author_id: row.get("author_id"),
            resolved: row.get::<i32, _>("resolved") != 0,
            created_at: row.get("created_at"),
            replies: row.get("replies"),
        });
    }

    Ok(records)
}
