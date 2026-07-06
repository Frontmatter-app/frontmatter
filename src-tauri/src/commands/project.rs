use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::Manager;

#[derive(Serialize, Deserialize)]
pub struct SaveAsResult {
    pub path: String,
    pub success: bool,
}

#[tauri::command]
pub async fn save_as_document(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    id: String,
) -> Result<Option<SaveAsResult>, String> {
    let label = window.label();
    let db_guard = state.dbs.lock().await;
    let ws_guard = state.window_workspaces.lock().await;
    let ws_path = ws_guard.get(label).ok_or("No workspace open")?;
    let pool = db_guard.get(ws_path).ok_or("No database pool")?;

    let row = sqlx::query("SELECT title, content, file_path FROM documents WHERE id = ?")
        .bind(&id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;

    let (title, content, _old_path) = match row {
        Some(r) => (
            r.get::<String, _>("title"),
            r.get::<String, _>("content"),
            r.get::<Option<String>, _>("file_path"),
        ),
        None => return Err("Document not found".to_string()),
    };

    let chosen = rfd::AsyncFileDialog::new()
        .set_file_name(&format!("{}.md", title))
        .add_filter("Markdown", &["md", "markdown", "txt"])
        .save_file()
        .await;

    match chosen {
        Some(file) => {
            let new_path = file.path().to_string_lossy().to_string();
            let plain_content = serde_json::from_str::<serde_json::Value>(&content)
                .ok()
                .and_then(|v| v.get("markdown").and_then(|m| m.as_str()).map(|s| s.to_string()))
                .unwrap_or_else(|| content.clone());

            std::fs::write(&new_path, &plain_content).map_err(|e| e.to_string())?;

            let _ = sqlx::query("UPDATE documents SET file_path = ? WHERE id = ?")
                .bind(&new_path)
                .bind(&id)
                .execute(pool)
                .await;

            Ok(Some(SaveAsResult { path: new_path, success: true }))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn get_auto_save(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
) -> Result<bool, String> {
    let label = window.label();
    let db_guard = state.dbs.lock().await;
    let ws_guard = state.window_workspaces.lock().await;
    let ws_path = ws_guard.get(label).ok_or("No workspace open")?;
    let pool = db_guard.get(ws_path).ok_or("No database pool")?;

    let row = sqlx::query("SELECT value FROM workspace_settings WHERE key = 'auto_save'")
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;

    match row {
        Some(r) => Ok(r.get::<String, _>("value") == "true"),
        None => Ok(false),
    }
}

#[tauri::command]
pub async fn set_auto_save(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    enabled: bool,
) -> Result<(), String> {
    let label = window.label();
    let db_guard = state.dbs.lock().await;
    let ws_guard = state.window_workspaces.lock().await;
    let ws_path = ws_guard.get(label).ok_or("No workspace open")?;
    let pool = db_guard.get(ws_path).ok_or("No database pool")?;

    sqlx::query("INSERT OR REPLACE INTO workspace_settings (key, value) VALUES ('auto_save', ?)")
        .bind(if enabled { "true" } else { "false" })
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    // Sync menu checkmark
    if let Some(item_state) = window.try_state::<crate::AutoSaveCheckItem>() {
        let guard = item_state.0.lock().await;
        let _ = guard.set_checked(enabled);
    }

    Ok(())
}

#[tauri::command]
pub fn get_recent_projects() -> Vec<String> {
    crate::menu::load_recent_projects()
}

#[tauri::command]
pub fn add_recent_project(path: String) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let config_dir = home.join("MarkType").join(".app");
    if !config_dir.exists() {
        std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    }
    let config_path = config_dir.join("recent.json");

    let mut items: Vec<String> = std::fs::read_to_string(&config_path)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default();

    items.retain(|p| p != &path);
    items.insert(0, path);
    items.truncate(10);

    std::fs::write(&config_path, serde_json::to_string_pretty(&items).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn clear_recent_projects() -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let config_path = home.join("MarkType").join(".app").join("recent.json");
    std::fs::write(&config_path, "[]").map_err(|e| e.to_string())?;
    Ok(())
}
