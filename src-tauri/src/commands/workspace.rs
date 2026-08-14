use serde::Serialize;
use sqlx::Row;
use std::str::FromStr;
use tauri::Manager;
use tauri::Emitter;

#[derive(Serialize)]
pub struct DocumentMeta {
    pub id: String,
    pub title: String,
    pub content: String,
    pub stage: String,
    pub file_path: Option<String>,
    pub focus_mode: bool,
    pub cloud_id: Option<String>,
    pub cloud_synced: bool,
    pub cloud_path: Option<String>,
    pub offline_enabled: bool,
    pub last_cloud_sync: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub word_count: i32,
    pub excerpt: Option<String>,
    pub file_created_at: Option<String>,
}

#[derive(Serialize)]
pub struct WorkspaceMeta {
    pub path: String,
    pub is_valid: bool,
}

#[derive(serde::Deserialize)]
struct WorkspaceContext {
    #[serde(rename = "type")]
    context_type: String,
    #[serde(rename = "teamId")]
    team_id: Option<String>,
}

fn safe_path_segment(value: &str) -> String {
    value.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect()
}

pub fn default_local_folder_for_context_json(
    workspace_context_json: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let root = home.join("MarkType");

    let Some(context_json) = workspace_context_json else {
        return Ok(root.join("Personal"));
    };

    let context: WorkspaceContext = serde_json::from_str(context_json)
        .map_err(|e| format!("Invalid workspace context: {e}"))?;

    if context.context_type == "team" {
        let team_id = context.team_id.as_deref()
            .filter(|id| !id.trim().is_empty())
            .ok_or("Team workspace context is missing a teamId")?;
        return Ok(root.join("Teams").join(safe_path_segment(team_id)));
    }

    Ok(root.join("Personal"))
}

#[tauri::command]
pub async fn open_workspace(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    path: Option<String>,
) -> Result<Option<WorkspaceMeta>, String> {
    let resolved_path = if let Some(p) = path {
        std::path::PathBuf::from(p)
    } else {
        let folder = rfd::AsyncFileDialog::new()
            .set_title("Open Local Folder")
            .pick_folder().await;
        match folder {
            Some(f) => f.path().to_path_buf(),
            None => return Ok(None),
        }
    };

    let app_dir = resolved_path.join(".app");
    if !app_dir.exists() { std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?; }

    let db_path = app_dir.join("project.db");
    if !db_path.exists() { std::fs::File::create(&db_path).map_err(|e| e.to_string())?; }

    let db_url = format!("sqlite:{}", db_path.to_string_lossy());
    let conn_options = sqlx::sqlite::SqliteConnectOptions::from_str(&db_url).map_err(|e| e.to_string())?;
    let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(5)
        .connect_with(conn_options).await.map_err(|e| e.to_string())?;

    crate::schema::migrate_database(&pool).await.map_err(|e| e.to_string())?;

    let label = window.label().to_string();
    let path_str = resolved_path.to_string_lossy().to_string();
    let workspace_path_clone = resolved_path.clone();

    state.dbs.lock().await.insert(path_str.clone(), pool);
    let previous = state
        .window_workspaces
        .lock()
        .await
        .insert(label.clone(), path_str.clone());

    // Switching a window to another workspace used to leave the old one's
    // watcher and pool running for the rest of the session.
    if let Some(previous) = previous {
        if previous != path_str {
            crate::window_ops::release_workspace_if_unused(&app, &previous).await;
        }
    }

    let path_str_clone = path_str.clone();
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        let state = app_handle.state::<crate::AppState>();
        let db_guard = state.dbs.lock().await;
        if let Some(pool) = db_guard.get(&path_str_clone) {
            let pool = pool.clone();
            drop(db_guard);
            let indexer = crate::commands::indexer::WorkspaceIndexer::new(pool, workspace_path_clone);
            let _ = indexer.index_workspace().await;
            // Notify the frontend that reconciliation is done so it can refresh the document list
            let _ = app_handle.emit("workspace-reconciled", ());
        }
    });

    crate::watcher::start_workspace_watcher(app.clone(), resolved_path.clone());

    Ok(Some(WorkspaceMeta { path: path_str, is_valid: true }))
}

#[tauri::command]
pub async fn get_documents(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<DocumentMeta>, String> {
    let label = window.label();
    let ws_guard = state.window_workspaces.lock().await;
    let path = match ws_guard.get(label) { Some(p) => p.clone(), None => return Ok(vec![]) };
    drop(ws_guard);
    let db_guard = state.dbs.lock().await;
    let pool = match db_guard.get(&path) { Some(p) => p, None => return Ok(vec![]) };

    let rows = sqlx::query(
        "SELECT id, title, content, stage, file_path, focus_mode, cloud_id, cloud_synced, cloud_path, offline_enabled, last_cloud_sync, created_at, updated_at, word_count, excerpt, file_created_at FROM documents ORDER BY updated_at DESC"
    ).fetch_all(pool).await.map_err(|e| e.to_string())?;

    Ok(rows.iter().map(|row| {
        DocumentMeta {
            id: row.get("id"), title: row.get("title"), content: row.get("content"),
            stage: row.get("stage"), file_path: row.get("file_path"),
            focus_mode: row.get::<i32, _>("focus_mode") != 0,
            cloud_id: row.get("cloud_id"), cloud_synced: row.get::<i32, _>("cloud_synced") != 0,
            cloud_path: row.get("cloud_path"), offline_enabled: row.get::<i32, _>("offline_enabled") != 0,
            last_cloud_sync: row.get("last_cloud_sync"),
            created_at: row.get("created_at"), updated_at: row.get("updated_at"),
            word_count: row.get::<Option<i32>, _>("word_count").unwrap_or(0),
            excerpt: row.get("excerpt"),
            file_created_at: row.get("file_created_at"),
        }
    }).collect())
}

#[tauri::command]
pub fn get_default_workspace(workspace_context_json: Option<String>) -> Result<String, String> {
    let default_path = default_local_folder_for_context_json(workspace_context_json.as_deref())?;
    Ok(default_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_last_workspace(workspace_context_json: Option<String>) -> Result<Option<String>, String> {
    let default_path = default_local_folder_for_context_json(workspace_context_json.as_deref())?;
    let app_dir = default_path.join(".app");
    if !app_dir.exists() { return Ok(None); }

    let config_path = app_dir.join("config.json");
    if !config_path.exists() { return Ok(None); }

    let content = tokio::fs::read_to_string(&config_path).await.map_err(|e| e.to_string())?;
    let config: serde_json::Value = serde_json::from_str(&content).map_err(|_| "Invalid config".to_string())?;
    let last = config.get("last_workspace").and_then(|v| v.as_str()).map(|s| s.to_string());

    if let Some(ref path) = last { if std::path::Path::new(path).exists() { return Ok(last); } }
    Ok(None)
}

#[tauri::command]
pub async fn save_last_workspace(workspace_context_json: Option<String>, path: String) -> Result<(), String> {
    let default_path = default_local_folder_for_context_json(workspace_context_json.as_deref())?;
    let app_dir = default_path.join(".app");
    if !app_dir.exists() { std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?; }

    let config_path = app_dir.join("config.json");
    let mut config: serde_json::Value = if config_path.exists() {
        let content = tokio::fs::read_to_string(&config_path).await.map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    config["last_workspace"] = serde_json::Value::String(path);
    tokio::fs::write(&config_path, serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?)
        .await.map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_window_workspace(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Option<String>, String> {
    let ws_guard = state.window_workspaces.lock().await;
    Ok(ws_guard.get(window.label()).cloned())
}

#[tauri::command]
pub async fn get_pending_import(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Option<crate::PendingImport>, String> {
    let mut imports_guard = state.pending_imports.lock().await;
    Ok(imports_guard.remove(window.label()))
}
