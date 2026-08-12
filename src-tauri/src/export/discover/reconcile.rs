use sqlx::{Row, SqlitePool};
use std::fs;
use std::path::{Path, PathBuf};
use crate::export::utils::toml::strip_frontmatter;

fn collect_markdown_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.starts_with('.') || name == "node_modules" || name == "target" {
                        continue;
                    }
                }
                files.extend(collect_markdown_files(&path));
            } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                let ext_lower = ext.to_lowercase();
                if matches!(ext_lower.as_str(), "md" | "markdown" | "txt") {
                    files.push(path);
                }
            }
        }
    }
    files
}

pub async fn reconcile_workspace(workspace_path: &Path, pool: &SqlitePool) -> Result<(), String> {
    let files = collect_markdown_files(workspace_path);
    let mut disk_abs_paths = std::collections::HashSet::new();
    for file_path in &files {
        disk_abs_paths.insert(file_path.to_string_lossy().to_string());
    }

    let db_rows = sqlx::query("SELECT id, file_path FROM documents WHERE file_path IS NOT NULL AND file_path != ''")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    for row in &db_rows {
        let db_path: String = row.get("file_path");
        let is_in_workspace = Path::new(&db_path).starts_with(workspace_path) || !Path::new(&db_path).is_absolute();
        if is_in_workspace && !disk_abs_paths.contains(&db_path) {
            let doc_id: String = row.get("id");
            let _ = sqlx::query("DELETE FROM documents WHERE id = ?")
                .bind(&doc_id)
                .execute(pool)
                .await;
        }
    }

    let mut db_abs_paths = std::collections::HashSet::new();
    for row in &db_rows {
        let db_path: String = row.get("file_path");
        if disk_abs_paths.contains(&db_path) {
            db_abs_paths.insert(db_path);
        }
    }

    for file_path in &files {
        let abs_path_str = file_path.to_string_lossy().to_string();
        if !db_abs_paths.contains(&abs_path_str) {
            let content_str = fs::read_to_string(file_path).unwrap_or_default();
            let clean_markdown = strip_frontmatter(&content_str).to_string();
            let doc_id = uuid::Uuid::new_v4().simple().to_string();
            let mut title = file_path.file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "Untitled".to_string());
            if title.to_lowercase().ends_with(".md") {
                title = title[..title.len() - 3].to_string();
            }

            let content_json = serde_json::json!({
                "markdown": clean_markdown,
                "draft": ""
            }).to_string();
            let now = chrono::Utc::now().to_rfc3339();

            let _ = sqlx::query(
                "INSERT INTO documents (id, title, content, stage, file_path, focus_mode, word_count, created_at, updated_at) VALUES (?, ?, ?, 'write', ?, 0, 0, ?, ?)"
            )
            .bind(&doc_id)
            .bind(&title)
            .bind(&content_json)
            .bind(&abs_path_str)
            .bind(&now)
            .bind(&now)
            .execute(pool)
            .await;
        }
    }

    Ok(())
}