use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeListItem {
    pub id: String,
    pub language: String,
    pub runtime_type: String,
    pub executable_path: String,
    pub managed_path: Option<String>,
    pub version: Option<String>,
    pub is_default: bool,
}

#[tauri::command]
pub async fn list_runtimes(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<RuntimeListItem>, String> {
    let label = window.label();
    let ws_guard = state.window_workspaces.lock().await;
    let workspace_path = match ws_guard.get(label) {
        Some(p) => p,
        None => return Ok(Vec::new()),
    };

    let db_guard = state.dbs.lock().await;
    let pool = match db_guard.get(workspace_path) {
        Some(p) => p,
        None => return Ok(Vec::new()),
    };

    let rows = sqlx::query(
        "SELECT id, language, runtime_type, executable_path, managed_path, version, is_default, updated_at FROM runtime_settings ORDER BY language",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        results.push(RuntimeListItem {
            id: row.get("id"),
            language: row.get("language"),
            runtime_type: row.get("runtime_type"),
            executable_path: row.get("executable_path"),
            managed_path: row.get("managed_path"),
            version: row.get("version"),
            is_default: row.get::<i32, _>("is_default") != 0,
        });
    }

    Ok(results)
}

#[tauri::command]
pub async fn add_runtime(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    language: String,
    executable_path: String,
    runtime_type: String,
) -> Result<RuntimeListItem, String> {
    let label = window.label();
    let ws_guard = state.window_workspaces.lock().await;
    let workspace_path = match ws_guard.get(label) {
        Some(p) => p,
        None => return Err("No workspace open".to_string()),
    };

    let db_guard = state.dbs.lock().await;
    let pool = match db_guard.get(workspace_path) {
        Some(p) => p,
        None => return Err("No database pool".to_string()),
    };

    let id = uuid::Uuid::new_v4().simple().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let version = detect_runtime_version(&executable_path, &language).await;

    // Check if this is the first runtime for this language, make it default
    let count_row = sqlx::query("SELECT COUNT(*) as cnt FROM runtime_settings WHERE language = ?")
        .bind(&language)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
    let is_default: i32 = count_row.get("cnt");
    let is_default = is_default == 0;

    sqlx::query(
        "INSERT INTO runtime_settings (id, language, runtime_type, executable_path, managed_path, version, is_default, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&language)
    .bind(&runtime_type)
    .bind(&executable_path)
    .bind(&version)
    .bind(if is_default { 1 } else { 0 })
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(RuntimeListItem {
        id,
        language,
        runtime_type,
        executable_path,
        managed_path: None,
        version,
        is_default,
    })
}

#[tauri::command]
pub async fn remove_runtime(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    runtime_id: String,
) -> Result<(), String> {
    let label = window.label();
    let ws_guard = state.window_workspaces.lock().await;
    let workspace_path = match ws_guard.get(label) {
        Some(p) => p,
        None => return Err("No workspace open".to_string()),
    };

    let db_guard = state.dbs.lock().await;
    let pool = match db_guard.get(workspace_path) {
        Some(p) => p,
        None => return Err("No database pool".to_string()),
    };

    sqlx::query("DELETE FROM runtime_settings WHERE id = ?")
        .bind(&runtime_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn set_default_runtime(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    language: String,
    executable_path: String,
) -> Result<(), String> {
    let label = window.label();
    let ws_guard = state.window_workspaces.lock().await;
    let workspace_path = match ws_guard.get(label) {
        Some(p) => p,
        None => return Err("No workspace open".to_string()),
    };

    let db_guard = state.dbs.lock().await;
    let pool = match db_guard.get(workspace_path) {
        Some(p) => p,
        None => return Err("No database pool".to_string()),
    };

    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query("UPDATE runtime_settings SET is_default = 0, updated_at = ? WHERE language = ?")
        .bind(&now)
        .bind(&language)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("UPDATE runtime_settings SET is_default = 1, updated_at = ? WHERE language = ? AND executable_path = ?")
        .bind(&now)
        .bind(&language)
        .bind(&executable_path)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

async fn detect_runtime_version(executable_path: &str, language: &str) -> Option<String> {
    let output = if language == "python" || language == "py" {
        tokio::process::Command::new(executable_path)
            .arg("--version")
            .output()
            .await
            .ok()
    } else if language == "javascript" || language == "js" || language == "node" {
        tokio::process::Command::new(executable_path)
            .arg("--version")
            .output()
            .await
            .ok()
    } else if language == "bash" || language == "sh" || language == "zsh" || language == "shell" {
        tokio::process::Command::new(executable_path)
            .arg("--version")
            .output()
            .await
            .ok()
    } else {
        tokio::process::Command::new(executable_path)
            .arg("--version")
            .output()
            .await
            .ok()
    };

    if let Some(output) = output {
        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !version.is_empty() {
                return Some(version);
            }
            let version = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if !version.is_empty() {
                return Some(version);
            }
        }
    }

    None
}
