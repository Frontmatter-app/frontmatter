//! Keeps the workspace database in step with what is on disk.
//!
//! Lived under `export::discover` while only the watcher and the indexer
//! called it, which is what made it easy to run destructively from the export
//! path. Export is now strictly read-only.

use sqlx::{Row, SqlitePool};
use std::fs;
use std::path::{Path, PathBuf};
use crate::export::utils::toml::strip_frontmatter;

/// Directories that never hold workspace documents. `.app` holds the workspace
/// database itself, so walking into it would index the app's own storage.
const IGNORED_DIRS: &[&str] = &["node_modules", "target", "dist", "build"];

fn collect_markdown_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else { continue };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.starts_with('.') || IGNORED_DIRS.contains(&name) {
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

/// What a scan found.
pub struct ScanReport {
    /// Ids of documents whose backing file was not on disk during this scan.
    pub missing: Vec<String>,
    /// Files that were on disk but not yet in the database, now inserted.
    pub inserted: usize,
}

/// Reconciles disk into the database *without* deleting anything.
///
/// Deletion is left to the caller because absence is not proof of removal: an
/// atomic save unlinks the file for a moment before renaming the replacement
/// into place, and deleting on the first missed sighting destroyed the document
/// row — along with its snapshots — mid-save.
pub async fn scan_workspace(
    workspace_path: &Path,
    pool: &SqlitePool,
) -> Result<ScanReport, String> {
    let files = collect_markdown_files(workspace_path);
    let disk_abs_paths: std::collections::HashSet<String> = files
        .iter()
        .map(|file_path| file_path.to_string_lossy().to_string())
        .collect();

    let db_rows = sqlx::query(
        "SELECT id, file_path FROM documents WHERE file_path IS NOT NULL AND file_path != ''",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut missing = Vec::new();
    let mut known_paths = std::collections::HashSet::new();

    for row in &db_rows {
        let db_path: String = row.get("file_path");
        let path = Path::new(&db_path);
        let is_in_workspace = path.starts_with(workspace_path) || !path.is_absolute();

        if disk_abs_paths.contains(&db_path) {
            known_paths.insert(db_path);
        } else if is_in_workspace {
            missing.push(row.get::<String, _>("id"));
        }
    }

    let mut inserted = 0usize;
    for file_path in &files {
        let abs_path_str = file_path.to_string_lossy().to_string();
        if known_paths.contains(&abs_path_str) {
            continue;
        }

        let content_str = fs::read_to_string(file_path).unwrap_or_default();
        let clean_markdown = strip_frontmatter(&content_str).to_string();
        let doc_id = uuid::Uuid::new_v4().simple().to_string();
        let mut title = file_path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Untitled".to_string());
        if title.to_lowercase().ends_with(".md") {
            title = title[..title.len() - 3].to_string();
        }

        let content_json = serde_json::json!({
            "markdown": clean_markdown,
            "draft": ""
        })
        .to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let result = sqlx::query(
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

        if result.is_ok() {
            inserted += 1;
        }
    }

    Ok(ScanReport { missing, inserted })
}

/// Removes documents by id. Returns how many rows were actually deleted.
pub async fn delete_documents(pool: &SqlitePool, ids: &[String]) -> usize {
    let mut removed = 0usize;
    for id in ids {
        let result = sqlx::query("DELETE FROM documents WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await;
        if let Ok(result) = result {
            removed += result.rows_affected() as usize;
        }
    }
    removed
}

/// Scans and applies deletions in one pass.
///
/// Used when opening a workspace, where there is no in-flight save to race and
/// a stale row would otherwise linger until the first file change.
pub async fn reconcile_workspace(workspace_path: &Path, pool: &SqlitePool) -> Result<(), String> {
    let report = scan_workspace(workspace_path, pool).await?;
    delete_documents(pool, &report.missing).await;
    Ok(())
}
