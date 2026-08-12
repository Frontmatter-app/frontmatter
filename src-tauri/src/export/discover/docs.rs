use crate::export::types::{DocInfo, ProjectConfig};
use crate::export::utils::markdown;
use crate::export::utils::paths::{matches_exclude, relative_path};
use crate::export::utils::toml::strip_frontmatter;
use sqlx::{Row, SqlitePool};
use std::path::Path;

/// Documents are stored either as raw Markdown or as a JSON envelope with a
/// `markdown` field; both forms may carry frontmatter.
fn extract_markdown(content: &str) -> String {
    let raw = match serde_json::from_str::<serde_json::Value>(content) {
        Ok(json) => json
            .get("markdown")
            .and_then(|v| v.as_str())
            .unwrap_or(content)
            .to_string(),
        Err(_) => content.to_string(),
    };
    strip_frontmatter(&raw).to_string()
}

/// Loads every exportable document from the workspace database.
///
/// `reconcile` is opt-in: exporting must not mutate the user's documents.
pub async fn discover_docs(
    workspace_path: &Path,
    pool: &SqlitePool,
    config: &ProjectConfig,
) -> Result<Vec<DocInfo>, String> {
    // ORDER BY makes the result set total. Without it the row order is
    // unspecified and any document not pinned in `config.order` could land in a
    // different position on every export.
    let rows = sqlx::query(
        "SELECT file_path, content, word_count, excerpt, file_created_at, updated_at, title \
         FROM documents \
         WHERE file_path IS NOT NULL AND file_path != '' \
         ORDER BY file_path ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut docs: Vec<DocInfo> = Vec::with_capacity(rows.len());

    for row in rows {
        let db_file_path: String = row.get("file_path");
        let rel_path = relative_path(Path::new(&db_file_path), workspace_path);

        if matches_exclude(&rel_path, &config.exclude) {
            continue;
        }

        let content: String = row.get("content");
        let md = extract_markdown(&content);
        let h1 = markdown::first_h1(&md).unwrap_or_else(|| row.get("title"));
        let db_excerpt: Option<String> = row.get("excerpt");

        // A blank override in config.yml means "no excerpt", not "fall back".
        let excerpt = match config.excerpt.get(&rel_path) {
            Some(s) if s.is_empty() => None,
            Some(s) => Some(s.clone()),
            None => db_excerpt,
        };

        docs.push(DocInfo {
            file_path: rel_path,
            title: h1.clone(),
            h1,
            h2s: markdown::all_h2s(&md),
            excerpt,
            word_count: row.get::<Option<i32>, _>("word_count").unwrap_or(0),
            file_created_at: row.get("file_created_at"),
            updated_at: row.get("updated_at"),
            content: md,
        });
    }

    Ok(docs)
}
