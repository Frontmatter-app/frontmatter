use super::types::{ExportContext, Manifest, PageIndexEntry, PageInfo};
use std::path::Path;

fn json_path(html_path: &str) -> String {
    Path::new(html_path).with_extension("json").to_string_lossy().to_string()
}

fn to_page_index(page: &PageInfo) -> PageIndexEntry {
    PageIndexEntry {
        file_path: page.file_path.clone(),
        html_path: page.html_path.clone(),
        json_path: format!("data/pages/{}", json_path(&page.html_path)),
        slug: page.slug.clone(),
        title: page.title.clone(),
        h1: page.h1.clone(),
        excerpt: page.excerpt.clone(),
        word_count: page.word_count,
        reading_time_minutes: page.reading_time_minutes,
        depth: page.depth,
        prev: page.prev.clone(),
        next: page.next.clone(),
        breadcrumbs: page.breadcrumbs.clone(),
        tags: page.tags.clone(),
        code_languages: page.code_languages.clone(),
        created_at: page.created_at.clone(),
        updated_at: page.updated_at.clone(),
    }
}

pub async fn write_export_data(ctx: &ExportContext, output_dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(output_dir).map_err(|e| e.to_string())?;

    let manifest = Manifest {
        config: ctx.config.clone(),
        tree: ctx.tree.clone(),
        pages: ctx.pages.iter().map(to_page_index).collect(),
    };
    let json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    std::fs::write(output_dir.join("data").join("manifest.json"), &json)
        .map_err(|e| format!("Failed to write manifest: {}", e))?;

    let pages_dir = output_dir.join("data").join("pages");
    for page in &ctx.pages {
        let rel = json_path(&page.html_path);
        let out_path = pages_dir.join(&rel);
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(page).map_err(|e| e.to_string())?;
        std::fs::write(&out_path, &json).map_err(|e| format!("Failed to write page {}: {}", rel, e))?;
    }

    Ok(())
}


