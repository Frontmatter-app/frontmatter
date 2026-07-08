use crate::commands::indexer::WorkspaceReference;
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectSearchResult {
    pub uuid: String,
    pub name: String,
    pub object_type: String,
    pub document_path: String,
    pub start_line: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReferenceResult {
    pub id: String,
    pub document_path: String,
    pub line: i32,
    pub col: i32,
    pub marker_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameResult {
    pub updated_count: i32,
}

#[tauri::command]
pub async fn search_objects(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    query: String,
) -> Result<Vec<ObjectSearchResult>, String> {
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

    let like = if query.is_empty() {
        "%".to_string()
    } else {
        format!("%{}%", query)
    };

    let rows = sqlx::query(
        "SELECT uuid, name, object_type, document_path, start_line FROM objects WHERE (name LIKE ? OR document_path LIKE ?) AND object_type NOT LIKE '{\"type\":\"Heading\"%' ORDER BY updated_at DESC LIMIT 50"
    )
    .bind(&like)
    .bind(&like)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        let object_type_str: String = row.get("object_type");
        let simplified = if object_type_str.starts_with("{\"type\":\"CodeBlock\"") {
            "CodeBlock".to_string()
        } else if object_type_str.starts_with("{\"type\":\"Image\"") {
            "Image".to_string()
        } else if object_type_str.starts_with("{\"type\":\"Table\"") {
            "Table".to_string()
        } else if object_type_str.starts_with("{\"type\":\"MathBlock\"") {
            "MathBlock".to_string()
        } else if object_type_str.starts_with("{\"type\":\"Diagram\"") {
            "Diagram".to_string()
        } else if object_type_str.starts_with("{\"type\":\"Output\"") {
            "Output".to_string()
        } else {
            // Skip any other unrecognised types (incl. any Heading leaking through)
            continue;
        };

        // Only include objects that have an explicit ref=
        if !object_type_str.contains("\"ref_id\":\"") {
            continue;
        }

        results.push(ObjectSearchResult {
            uuid: row.get("uuid"),
            name: row.get("name"),
            object_type: simplified,
            document_path: row.get("document_path"),
            start_line: row.get("start_line"),
        });
    }

    Ok(results)
}

#[tauri::command]
pub async fn find_references(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    object_uuid: String,
) -> Result<Vec<ReferenceResult>, String> {
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
        "SELECT id, document_path, line, col, marker_text FROM doc_references WHERE object_uuid = ? ORDER BY document_path, line, col"
    )
    .bind(&object_uuid)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        results.push(ReferenceResult {
            id: row.get("id"),
            document_path: row.get("document_path"),
            line: row.get("line"),
            col: row.get("col"),
            marker_text: row.get("marker_text"),
        });
    }

    Ok(results)
}

#[tauri::command]
pub async fn rename_object(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    object_uuid: String,
    new_name: String,
) -> Result<RenameResult, String> {
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
    let result = sqlx::query(
        "UPDATE objects SET name = ?, updated_at = ? WHERE uuid = ?"
    )
    .bind(&new_name)
    .bind(&now)
    .bind(&object_uuid)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(RenameResult {
        updated_count: result.rows_affected() as i32,
    })
}

#[tauri::command]
pub async fn get_object_by_uuid(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    object_uuid: String,
) -> Result<Option<serde_json::Value>, String> {
    let label = window.label();
    let ws_guard = state.window_workspaces.lock().await;
    let workspace_path = match ws_guard.get(label) {
        Some(p) => p,
        None => return Ok(None),
    };

    let db_guard = state.dbs.lock().await;
    let pool = match db_guard.get(workspace_path) {
        Some(p) => p,
        None => return Ok(None),
    };

    let row = sqlx::query(
        "SELECT uuid, object_type, name, document_path, start_line, end_line, start_col, end_col, content_hash, metadata, created_at, updated_at FROM objects WHERE uuid = ?"
    )
    .bind(&object_uuid)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    if let Some(row) = row {
        let object_type_str: String = row.get("object_type");
        let object_type: crate::commands::indexer::ObjectType = serde_json::from_str(&object_type_str).map_err(|e| e.to_string())?;

        let document_path: String = row.get("document_path");
        let start_line: i32 = row.get("start_line");
        let end_line: i32 = row.get("end_line");

        // Read file and extract content segment
        // First try the real filesystem (local documents)
        let abs_path = std::path::PathBuf::from(workspace_path).join(&document_path);
        let file_source = std::fs::read_to_string(&abs_path).ok();

        // Fallback: if no local file, reconstruct content from the documents SQLite row.
        // Cloud/team documents store their content as JSON {markdown: "..."} in the documents table.
        let resolved_content_str: Option<String> = if file_source.is_some() {
            file_source
        } else {
            // Look up by virtual path (__cloud__/<id>.md) — we need the document id.
            // The document_path for cloud docs is "__cloud__/<id>.md", so we strip the prefix.
            let doc_id = if document_path.starts_with("__cloud__/") && document_path.ends_with(".md") {
                Some(document_path["__cloud__/".len()..document_path.len() - 3].to_string())
            } else {
                None
            };

            if let Some(ref did) = doc_id {
                let db_row = sqlx::query("SELECT content FROM documents WHERE id = ?")
                    .bind(did)
                    .fetch_optional(pool)
                    .await
                    .ok()
                    .flatten();

                if let Some(db_row) = db_row {
                    let raw: String = db_row.get("content");
                    // Content is stored as JSON {markdown: "..."}
                    if raw.starts_with('{') {
                        serde_json::from_str::<serde_json::Value>(&raw)
                            .ok()
                            .and_then(|v| v.get("markdown").and_then(|m| m.as_str()).map(|s| s.to_string()))
                    } else {
                        Some(raw)
                    }
                } else {
                    None
                }
            } else {
                None
            }
        };

        let content = if let Some(ref file_str) = resolved_content_str {
            let lines: Vec<&str> = file_str.lines().collect();
            let start = (start_line as usize - 1).min(lines.len());
            let end = (end_line as usize).min(lines.len());
            if start < end {
                let is_code_block = match &object_type {
                    crate::commands::indexer::ObjectType::CodeBlock { .. } => true,
                    _ => false,
                };

                if is_code_block {
                    if end - start > 2 {
                        Some(lines[start + 1..end - 1].join("\n"))
                    } else {
                        Some("".to_string())
                    }
                } else {
                    Some(lines[start..end].join("\n"))
                }
            } else {
                None
            }
        } else {
            None
        };

        let mut val = serde_json::json!({
            "uuid": row.get::<String, _>("uuid"),
            "object_type": object_type,
            "name": row.get::<String, _>("name"),
            "document_path": document_path,
            "start_line": start_line,
            "end_line": end_line,
            "start_col": row.get::<i32, _>("start_col"),
            "end_col": row.get::<i32, _>("end_col"),
            "content_hash": row.get::<String, _>("content_hash"),
            "metadata": serde_json::from_str::<serde_json::Value>(&row.get::<String, _>("metadata")).map_err(|e| e.to_string())?,
            "created_at": row.get::<String, _>("created_at"),
            "updated_at": row.get::<String, _>("updated_at"),
        });

        if let Some(c) = content {
            if let Some(obj) = val.as_object_mut() {
                obj.insert("content".to_string(), serde_json::Value::String(c));
            }
        }

        Ok(Some(val))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn get_references_for_document(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    document_path: String,
) -> Result<Vec<WorkspaceReference>, String> {
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
        "SELECT id, document_path, line, col, object_uuid, output_uuid, marker_text, created_at, updated_at FROM doc_references WHERE document_path = ? ORDER BY line, col"
    )
    .bind(&document_path)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        results.push(WorkspaceReference {
            id: row.get("id"),
            document_path: row.get("document_path"),
            line: row.get("line"),
            col: row.get("col"),
            object_uuid: row.get("object_uuid"),
            output_uuid: row.get("output_uuid"),
            marker_text: row.get("marker_text"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        });
    }

    Ok(results)
}

#[tauri::command]
pub async fn set_transclusion_hash(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    object_uuid: String,
    hash: String,
) -> Result<(), String> {
    let label = window.label();
    let ws_guard = state.window_workspaces.lock().await;
    let workspace_path = ws_guard.get(label).cloned().ok_or("No workspace open")?;
    let db_guard = state.dbs.lock().await;
    let pool = db_guard.get(&workspace_path).ok_or("No database pool")?;

    sqlx::query(
        "INSERT OR REPLACE INTO transclusion_hashes (uuid, hash, updated_at) VALUES (?, ?, ?)"
    )
    .bind(&object_uuid)
    .bind(&hash)
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_transclusion_hash(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    object_uuid: String,
) -> Result<Option<String>, String> {
    let label = window.label();
    let ws_guard = state.window_workspaces.lock().await;
    let workspace_path = ws_guard.get(label).cloned().ok_or("No workspace open")?;
    let db_guard = state.dbs.lock().await;
    let pool = db_guard.get(&workspace_path).ok_or("No database pool")?;

    let row = sqlx::query(
        "SELECT hash FROM transclusion_hashes WHERE uuid = ?"
    )
    .bind(&object_uuid)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(row.map(|r| r.get("hash")))
}
