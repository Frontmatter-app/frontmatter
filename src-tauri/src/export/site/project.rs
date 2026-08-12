use crate::export::normalize::is_readme;
use crate::export::site::content;
use crate::export::site::theme::ThemeRoots;
use crate::export::types::{ExportContext, ExportTarget, PageInfo};
use crate::export::utils::title::{title_case, workspace_title};
use crate::export::utils::toml::escape_toml;
use std::fs;
use std::path::Path;

/// Which page becomes the site root.
///
/// Mirrors [`crate::export::normalize::resolve_index_path`] so the page written
/// as the index is exactly the page dropped from the prev/next chain.
pub fn find_index_page<'a>(
    pages: &'a [PageInfo],
    index_page: Option<&'a str>,
) -> Option<&'a PageInfo> {
    if let Some(explicit) = index_page {
        if let Some(page) = pages.iter().find(|p| p.file_path == explicit) {
            return Some(page);
        }
    }
    pages
        .iter()
        .find(|p| is_readme(&p.file_path) && !p.file_path.contains('/'))
        .or_else(|| pages.iter().find(|p| is_readme(&p.file_path)))
}

/// Zola requires an `_index.md` in every content directory. Any directory
/// created for a nested page but not claimed by a section document gets a
/// generated one.
fn ensure_subsections(content_dir: &Path, sort_by: &str) {
    let Ok(entries) = fs::read_dir(content_dir) else { return };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let index = path.join("_index.md");
        if !index.exists() {
            let title = path
                .file_name()
                .and_then(|n| n.to_str())
                .map(title_case)
                .unwrap_or_else(|| "Section".to_string());
            let _ = fs::write(
                &index,
                format!(
                    "+++\ntitle = \"{}\"\nsort_by = \"{}\"\nrender = true\n+++\n",
                    escape_toml(&title),
                    sort_by,
                ),
            );
        }
        ensure_subsections(&path, sort_by);
    }
}

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            copy_dir_all(&entry.path(), &dst.join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), dst.join(entry.file_name()))?;
        }
    }
    Ok(())
}

/// Materialises a complete Zola project for `ctx` under `output_dir`.
///
/// Returns an error when the requested theme cannot be resolved, rather than
/// building a site with no templates and reporting success.
pub fn ensure_zola_project(
    output_dir: &Path,
    ctx: &ExportContext,
    target: &ExportTarget,
    workspace_path: &Path,
    bundled_themes: Option<&Path>,
) -> Result<(), String> {
    let roots = ThemeRoots::new(workspace_path, bundled_themes, target.project_type);
    let theme_dir = roots.resolve(&target.theme).ok_or_else(|| {
        format!(
            "Theme '{}' was not found for {} exports. Looked under {}/themes/{}/.",
            target.theme,
            target.project_type.slug(),
            workspace_path.display(),
            target.project_type.slug(),
        )
    })?;

    let content_dir = output_dir.join("content");
    fs::create_dir_all(&content_dir)
        .map_err(|e| format!("Failed to create {}: {e}", content_dir.display()))?;

    let index_page = find_index_page(&ctx.pages, ctx.config.index_page.as_deref());
    let index_path = index_page.map(|p| p.file_path.as_str());
    let index_body = index_page.map(|p| p.content.as_str()).unwrap_or("");

    let title = ctx
        .config
        .title
        .clone()
        .or_else(|| index_page.map(|p| p.title.clone()))
        .unwrap_or_else(|| workspace_title(workspace_path));

    content::write_root_index(&content_dir, &title, index_body);
    content::write_pages(&content_dir, &ctx.pages, index_path);
    ensure_subsections(&content_dir, target.project_type.sort_by());
    content::write_config_toml(output_dir, &ctx.config, &title);

    // The theme is copied before static assets so a workspace `images/` folder
    // always wins over a theme placeholder of the same name.
    copy_dir_all(&theme_dir, output_dir)
        .map_err(|e| format!("Failed to copy theme from {}: {e}", theme_dir.display()))?;

    let images_src = workspace_path.join("images");
    if images_src.is_dir() {
        copy_dir_all(&images_src, &output_dir.join("static").join("images"))
            .map_err(|e| format!("Failed to copy images: {e}"))?;
    }

    Ok(())
}
