use super::workspace::DocumentMeta;
use serde::Serialize;
use sqlx::Row;

#[derive(Serialize)]
pub struct SuccessResponse {
    pub success: bool,
}

async fn get_pool(
    window: &tauri::Window,
    state: &tauri::State<'_, crate::AppState>,
) -> Result<(sqlx::SqlitePool, String), String> {
    let label = window.label();
    let ws_guard = state.window_workspaces.lock().await;
    let ws_path = ws_guard.get(label).ok_or("No workspace open")?.clone();
    drop(ws_guard);
    let db_guard = state.dbs.lock().await;
    let pool = db_guard.get(&ws_path).cloned().ok_or("No database pool for this workspace")?;
    Ok((pool, ws_path))
}

#[tauri::command]
pub async fn create_document(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    id: String,
    title: String,
    content: String,
    file_path: Option<String>,
) -> Result<DocumentMeta, String> {
    let (pool, _) = get_pool(&window, &state).await?;
    let stage = "write".to_string();
    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query("INSERT INTO documents (id, title, content, stage, file_path, focus_mode, word_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)")
        .bind(&id).bind(&title).bind(&content).bind(&stage).bind(&file_path)
        .bind(&now).bind(&now)
        .execute(&pool).await.map_err(|e| e.to_string())?;

    Ok(DocumentMeta {
        id, title, content, stage, file_path,
        focus_mode: false, cloud_id: None, cloud_synced: false,
        cloud_path: None, offline_enabled: false, last_cloud_sync: None,
        created_at: now.clone(), updated_at: now,
        word_count: 0, excerpt: None, file_created_at: None,
    })
}

#[tauri::command]
pub async fn update_document(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    id: String,
    title: String,
    content: String,
    stage: String,
    focus_mode: bool,
) -> Result<SuccessResponse, String> {
    let (pool, ws_path) = get_pool(&window, &state).await?;
    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query("UPDATE documents SET title = ?, content = ?, stage = ?, focus_mode = ?, updated_at = ? WHERE id = ?")
        .bind(&title).bind(&content).bind(&stage)
        .bind(if focus_mode { 1 } else { 0 }).bind(&now).bind(&id)
        .execute(&pool).await.map_err(|e| e.to_string())?;

    let row = sqlx::query("SELECT file_path FROM documents WHERE id = ?")
        .bind(&id).fetch_optional(&pool).await.map_err(|e| e.to_string())?;

    if let Some(r) = row {
        // Extract the markdown portion for indexing
        let mut mkd_content = content.clone();
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(mkd) = json.get("markdown").and_then(|v| v.as_str()) {
                mkd_content = mkd.to_string();
            }
        }

        let file_path_opt: Option<String> = r.get("file_path");
        if let Some(ref path) = file_path_opt {
            if !path.is_empty() {
                // Write to disk and index from file (local documents)
                let _ = std::fs::write(path, &mkd_content);
                let indexer = crate::commands::indexer::WorkspaceIndexer::new(
                    pool.clone(), std::path::PathBuf::from(&ws_path),
                );
                let _ = indexer.index_file(std::path::Path::new(path)).await;
            } else {
                // No disk file — index from content string (cloud-only docs)
                let indexer = crate::commands::indexer::WorkspaceIndexer::new(
                    pool.clone(), std::path::PathBuf::from(&ws_path),
                );
                let virtual_path = format!("__cloud__/{}.md", id);
                let _ = indexer.index_content_string(&mkd_content, &virtual_path).await;
            }
        } else {
            // file_path is NULL — index from content string (team/cloud docs)
            let indexer = crate::commands::indexer::WorkspaceIndexer::new(
                pool.clone(), std::path::PathBuf::from(&ws_path),
            );
            let virtual_path = format!("__cloud__/{}.md", id);
            let _ = indexer.index_content_string(&mkd_content, &virtual_path).await;
        }
    }

    Ok(SuccessResponse { success: true })
}

#[tauri::command]
pub async fn update_document_path(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    id: String,
    file_path: String,
) -> Result<SuccessResponse, String> {
    let (pool, _) = get_pool(&window, &state).await?;
    sqlx::query("UPDATE documents SET file_path = ? WHERE id = ?")
        .bind(&file_path).bind(&id)
        .execute(&pool).await.map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
pub async fn get_document(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    id: String,
) -> Result<DocumentMeta, String> {
    let (pool, _) = get_pool(&window, &state).await?;
    let row = sqlx::query(
        "SELECT id, title, content, stage, file_path, focus_mode, cloud_id, cloud_synced, cloud_path, offline_enabled, last_cloud_sync, created_at, updated_at, word_count, excerpt, file_created_at FROM documents WHERE id = ?"
    ).bind(&id).fetch_optional(&pool).await.map_err(|e| e.to_string())?;

    match row {
        Some(r) => Ok(DocumentMeta {
            id: r.get("id"), title: r.get("title"), content: r.get("content"),
            stage: r.get("stage"), file_path: r.get("file_path"),
            focus_mode: r.get::<i32, _>("focus_mode") != 0,
            cloud_id: r.get("cloud_id"), cloud_synced: r.get::<i32, _>("cloud_synced") != 0,
            cloud_path: r.get("cloud_path"), offline_enabled: r.get::<i32, _>("offline_enabled") != 0,
            last_cloud_sync: r.get("last_cloud_sync"),
            created_at: r.get("created_at"), updated_at: r.get("updated_at"),
            word_count: r.get::<Option<i32>, _>("word_count").unwrap_or(0),
            excerpt: r.get("excerpt"),
            file_created_at: r.get("file_created_at"),
        }),
        None => Err("Document not found".to_string()),
    }
}

#[tauri::command]
pub async fn delete_document(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    id: String,
) -> Result<SuccessResponse, String> {
    let (pool, _) = get_pool(&window, &state).await?;
    sqlx::query("DELETE FROM documents WHERE id = ?")
        .bind(&id).execute(&pool).await.map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}
