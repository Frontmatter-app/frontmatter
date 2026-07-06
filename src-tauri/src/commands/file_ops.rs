use super::workspace::DocumentMeta;
use sqlx::Row;

async fn get_pool(
    window: &tauri::Window,
    state: &tauri::State<'_, crate::AppState>,
) -> Result<(sqlx::SqlitePool, String), String> {
    let label = window.label();
    let ws_guard = state.window_workspaces.lock().await;
    let ws_path = ws_guard.get(label).ok_or("No workspace open")?.clone();
    drop(ws_guard);
    let db_guard = state.dbs.lock().await;
    let pool = db_guard.get(&ws_path).cloned().ok_or("No database pool")?;
    Ok((pool, ws_path))
}

#[tauri::command]
pub async fn open_or_import_file(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    file_path: String,
) -> Result<DocumentMeta, String> {
    let (pool, _) = get_pool(&window, &state).await?;

    let row = sqlx::query("SELECT id, title, content, stage, file_path, focus_mode, created_at, updated_at FROM documents WHERE file_path = ?")
        .bind(&file_path).fetch_optional(&pool).await.map_err(|e| e.to_string())?;

    if let Some(r) = row {
        let id: String = r.get("id");
        let title: String = r.get("title");
        let db_content: String = r.get("content");
        let stage: String = r.get("stage");
        let focus_mode: i32 = r.get("focus_mode");
        let created_at: String = r.get("created_at");

        let disk_content = std::fs::read_to_string(&file_path).unwrap_or(db_content.clone());
        let updated_content = if db_content.starts_with('{') {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&db_content) {
                let mut new_val = parsed;
                new_val["markdown"] = serde_json::Value::String(disk_content);
                new_val.to_string()
            } else {
                serde_json::json!({"markdown": disk_content, "draft": ""}).to_string()
            }
        } else {
            disk_content
        };

        let now = chrono::Utc::now().to_rfc3339();
        let _ = sqlx::query("UPDATE documents SET content = ?, updated_at = ? WHERE id = ?")
            .bind(&updated_content).bind(&now).bind(&id).execute(&pool).await;

        return Ok(DocumentMeta {
            id, title, content: updated_content, stage,
            file_path: Some(file_path), focus_mode: focus_mode != 0,
            cloud_id: None, cloud_synced: false, cloud_path: None,
            offline_enabled: false, last_cloud_sync: None,
            created_at, updated_at: now,
        });
    }

    let metadata_path = std::path::Path::new(&file_path);
    let title = metadata_path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled".to_string());
    let title = if title.to_lowercase().ends_with(".md") { title[..title.len() - 3].to_string() } else { title };

    let markdown_content = std::fs::read_to_string(&file_path).map_err(|e| format!("Failed to read file: {}", e))?;
    let id = uuid::Uuid::new_v4().simple().to_string();
    let stage = "write".to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let content = serde_json::json!({"markdown": markdown_content, "draft": ""}).to_string();

    sqlx::query("INSERT INTO documents (id, title, content, stage, file_path, focus_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)")
        .bind(&id).bind(&title).bind(&content).bind(&stage).bind(Some(&file_path))
        .bind(&now).bind(&now).execute(&pool).await.map_err(|e| e.to_string())?;

    Ok(DocumentMeta {
        id, title, content, stage, file_path: Some(file_path),
        focus_mode: false, cloud_id: None, cloud_synced: false,
        cloud_path: None, offline_enabled: false, last_cloud_sync: None,
        created_at: now.clone(), updated_at: now,
    })
}

#[tauri::command]
pub async fn create_file_on_disk(parent_dir: String, name: String) -> Result<String, String> {
    let full_path = std::path::Path::new(&parent_dir).join(&name);
    if full_path.exists() { return Err("File already exists".to_string()); }
    std::fs::write(&full_path, "").map_err(|e| e.to_string())?;
    Ok(full_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn create_directory_on_disk(parent_dir: String, name: String) -> Result<String, String> {
    let full_path = std::path::Path::new(&parent_dir).join(&name);
    if full_path.exists() { return Err("Directory already exists".to_string()); }
    std::fs::create_dir_all(&full_path).map_err(|e| e.to_string())?;
    Ok(full_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn delete_file_or_dir_on_disk(path: String) -> Result<(), String> {
    let target = std::path::Path::new(&path);
    if !target.exists() { return Err("Target does not exist".to_string()); }
    if target.is_dir() {
        std::fs::remove_dir_all(target).map_err(|e| e.to_string())?;
    } else {
        std::fs::remove_file(target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn move_or_rename_on_disk(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let old = std::path::Path::new(&old_path);
    let new = std::path::Path::new(&new_path);
    if !old.exists() { return Err("Source path does not exist".to_string()); }
    if new.exists() { return Err("Destination path already exists".to_string()); }

    std::fs::rename(old, new).map_err(|e| e.to_string())?;

    let (pool, _) = if let Ok(val) = get_pool(&window, &state).await { val } else { return Ok(()) };

    if old.is_dir() {
        let prefix_old = format!("{}/", old_path);
        let prefix_new = format!("{}/", new_path);
        let rows = sqlx::query("SELECT id, file_path, title FROM documents")
            .fetch_all(&pool).await.map_err(|e| e.to_string())?;

        for row in rows {
            let id: String = row.get("id");
            if let Some(fp) = row.get::<Option<String>, _>("file_path") {
                if fp == old_path {
                    let raw_name = new.file_name()
                        .map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                    let nt = if raw_name.to_lowercase().ends_with(".md") { raw_name[..raw_name.len()-3].to_string() } else { raw_name };
                    let _ = sqlx::query("UPDATE documents SET file_path = ?, title = ? WHERE id = ?")
                        .bind(&new_path).bind(&nt).bind(&id).execute(&pool).await;
                } else if fp.starts_with(&prefix_old) {
                    let _ = sqlx::query("UPDATE documents SET file_path = ? WHERE id = ?")
                        .bind(&fp.replace(&prefix_old, &prefix_new)).bind(&id).execute(&pool).await;
                }
            }
        }
    } else {
        let raw_name = new.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let nt = if raw_name.to_lowercase().ends_with(".md") { raw_name[..raw_name.len()-3].to_string() } else { raw_name };
        let _ = sqlx::query("UPDATE documents SET file_path = ?, title = ? WHERE file_path = ?")
            .bind(&new_path).bind(&nt).bind(&old_path).execute(&pool).await;
    }

    Ok(())
}

#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() { return Err("Path does not exist".to_string()); }

    #[cfg(target_os = "windows")] { std::process::Command::new("explorer").args(&["/select,", &path]).spawn().map_err(|e| e.to_string())?; }
    #[cfg(target_os = "macos")] { std::process::Command::new("open").args(&["-R", &path]).spawn().map_err(|e| e.to_string())?; }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))] {
        let parent = p.parent().unwrap_or(p);
        std::process::Command::new("xdg-open").arg(parent.to_string_lossy().to_string()).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}
