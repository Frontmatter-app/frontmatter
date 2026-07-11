use super::types::{DocInfo, ProjectConfig};
use sqlx::{Row, SqlitePool};

fn matches_exclude(rel_path: &str, patterns: &[String]) -> bool {
    patterns.iter().any(|p| {
        if p.ends_with('/') {
            rel_path.starts_with(p) || rel_path.contains(&format!("/{}", p.trim_end_matches('/')))
        } else {
            rel_path == p || rel_path.ends_with(&format!("/{}", p))
        }
    })
}

fn humanize_filename(path: &str) -> String {
    let stem = std::path::Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(path);
    let cleaned = stem.trim_start_matches(|c: char| c.is_ascii_digit() || c == '-' || c == '_' || c == ' ');
    if cleaned.is_empty() { stem.to_string() } else { cleaned.to_string() }
}

fn extract_h1(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("# ") {
            return Some(trimmed[2..].trim().to_string());
        }
    }
    None
}

fn extract_h2s(content: &str) -> Vec<String> {
    content.lines()
        .filter_map(|l| {
            let t = l.trim();
            if t.starts_with("## ") { Some(t[3..].trim().to_string()) } else { None }
        })
        .collect()
}

fn extract_markdown(content: &str) -> String {
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(content) {
        json.get("markdown").and_then(|v| v.as_str()).unwrap_or(content).to_string()
    } else {
        content.to_string()
    }
}

pub async fn discover_docs(pool: &SqlitePool, config: &ProjectConfig) -> Result<Vec<DocInfo>, String> {
    let rows = sqlx::query(
        "SELECT file_path, content, word_count, excerpt, file_created_at FROM documents WHERE file_path IS NOT NULL AND file_path != ''"
    ).fetch_all(pool).await.map_err(|e| e.to_string())?;

    let mut docs: Vec<DocInfo> = Vec::new();
    for row in rows {
        let file_path: String = row.get("file_path");
        if matches_exclude(&file_path, &config.exclude) { continue; }

        let content: String = row.get("content");
        let md = extract_markdown(&content);
        let h1 = extract_h1(&md).unwrap_or_else(|| humanize_filename(&file_path));
        let h2s = extract_h2s(&md);
        let word_count: i32 = row.get::<Option<i32>, _>("word_count").unwrap_or(0);
        let file_created_at: Option<String> = row.get("file_created_at");
        let db_excerpt: Option<String> = row.get("excerpt");

        let excerpt = config.excerpt.get(&file_path)
            .map(|s| {
                if s.is_empty() { None } else { Some(s.clone()) }
            })
            .unwrap_or(db_excerpt);

        docs.push(DocInfo {
            file_path,
            title: h1.clone(),
            h1,
            h2s,
            excerpt,
            word_count,
            file_created_at,
            content: md,
        });
    }

    Ok(docs)
}
