use super::documents::SuccessResponse;

async fn get_pool(
    window: &tauri::Window,
    state: &tauri::State<'_, crate::AppState>,
) -> Result<sqlx::SqlitePool, String> {
    let label = window.label();
    let ws_guard = state.window_workspaces.lock().await;
    let ws_path = ws_guard.get(label).ok_or("No workspace open")?.clone();
    drop(ws_guard);
    let db_guard = state.dbs.lock().await;
    db_guard.get(&ws_path).cloned().ok_or("No database pool".to_string())
}

#[tauri::command]
pub async fn set_cloud_sync(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    id: String,
    cloud_id: String,
    cloud_path: Option<String>,
) -> Result<SuccessResponse, String> {
    let pool = get_pool(&window, &state).await?;
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("UPDATE documents SET cloud_id = ?, cloud_synced = 1, cloud_path = ?, last_cloud_sync = ? WHERE id = ?")
        .bind(&cloud_id).bind(&cloud_path).bind(&now).bind(&id)
        .execute(&pool).await.map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
pub async fn clear_cloud_sync(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    id: String,
) -> Result<SuccessResponse, String> {
    let pool = get_pool(&window, &state).await?;
    sqlx::query("UPDATE documents SET cloud_id = NULL, cloud_synced = 0, cloud_path = NULL, last_cloud_sync = NULL WHERE id = ?")
        .bind(&id).execute(&pool).await.map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}

#[tauri::command]
pub async fn set_offline_enabled(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    id: String,
    enabled: bool,
) -> Result<SuccessResponse, String> {
    let pool = get_pool(&window, &state).await?;
    sqlx::query("UPDATE documents SET offline_enabled = ? WHERE id = ?")
        .bind(if enabled { 1 } else { 0 }).bind(&id)
        .execute(&pool).await.map_err(|e| e.to_string())?;
    Ok(SuccessResponse { success: true })
}


