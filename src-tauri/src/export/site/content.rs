use crate::export::types::{PageInfo, ProjectConfig};
use crate::export::utils::frontmatter::build_page_frontmatter;
use crate::export::utils::title::safe_content_filename;
use crate::export::utils::toml::escape_toml;
use std::collections::HashSet;
use std::fs;
use std::path::Path;

/// Stub path (no `.html`) of every page, used to decide which documents are
/// section indexes.
fn stub_of(page: &PageInfo) -> &str {
    page.html_path.strip_suffix(".html").unwrap_or(&page.html_path)
}

/// Directories that contain at least one page.
///
/// A document is a *section* when its own stub names one of these directories —
/// that is, when other documents live beneath it (`guide.md` alongside
/// `guide/intro.md`). Testing the document's *parent* instead, as this used to,
/// makes every document in any subfolder a section and silently strips its page
/// metadata.
fn section_dirs(pages: &[PageInfo]) -> HashSet<String> {
    pages
        .iter()
        .filter_map(|page| {
            Path::new(stub_of(page))
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .filter(|p| !p.is_empty())
        })
        .collect()
}

fn write_section_index(content_dir: &Path, stub_path: &str, page: &PageInfo) {
    let section_dir = content_dir.join(stub_path);
    if fs::create_dir_all(&section_dir).is_err() {
        return;
    }
    let mut meta = format!(
        "title = \"{}\"\nsort_by = \"weight\"\nrender = true",
        escape_toml(&page.title)
    );
    if let Some(excerpt) = page.excerpt.as_deref().filter(|e| !e.is_empty()) {
        meta.push_str(&format!("\ndescription = \"{}\"", escape_toml(excerpt)));
    }
    let _ = fs::write(
        section_dir.join("_index.md"),
        format!("+++\n{}\n+++\n{}", meta, page.content),
    );
}

pub fn write_pages(content_dir: &Path, pages: &[PageInfo], index_path: Option<&str>) {
    let sections = section_dirs(pages);
    let mut written: HashSet<String> = HashSet::new();

    for (i, page) in pages.iter().enumerate() {
        // The index page is rendered as the site root by `write_root_index`.
        if index_path.is_some_and(|ip| page.file_path.eq_ignore_ascii_case(ip)) {
            continue;
        }

        let stub_path = stub_of(page);

        if sections.contains(stub_path) {
            write_section_index(content_dir, stub_path, page);
            continue;
        }

        let base = safe_content_filename(stub_path);
        let mut safe_path = base.clone();
        let mut suffix = 1;
        while written.contains(&safe_path) {
            suffix += 1;
            safe_path = format!("{base}-{suffix}");
        }
        written.insert(safe_path.clone());

        let mut slug = if safe_path != stub_path {
            safe_path.rsplit('/').next().unwrap_or(&safe_path).to_string()
        } else {
            page.slug.clone()
        };
        if suffix > 1 {
            slug = format!("{slug}-{suffix}");
        }

        let file = content_dir.join(format!("{safe_path}.md"));
        if let Some(parent) = file.parent() {
            if fs::create_dir_all(parent).is_err() {
                continue;
            }
        }
        let _ = fs::write(&file, build_page_frontmatter(page, &slug, (i + 1) as i32));
    }
}

/// Writes the site's root section.
///
/// `sort_by` comes from the project type: the root used to be hardcoded to
/// `weight`, so a blog's landing page listed posts in input order no matter
/// what the type asked for.
pub fn write_root_index(content_dir: &Path, title: &str, body: &str, sort_by: &str) {
    let _ = fs::create_dir_all(content_dir);
    let _ = fs::write(
        content_dir.join("_index.md"),
        format!(
            "+++\ntitle = \"{}\"\nsort_by = \"{}\"\nrender = true\ntemplate = \"index.html\"\n+++\n{}",
            escape_toml(title),
            sort_by,
            body,
        ),
    );
}

/// Renders a JSON value from `config.custom` as a TOML value.
fn json_to_toml(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(s) => format!("\"{}\"", escape_toml(s)),
        serde_json::Value::Array(items) => {
            let rendered: Vec<String> = items.iter().map(json_to_toml).collect();
            format!("[{}]", rendered.join(", "))
        }
        serde_json::Value::Null => "\"\"".to_string(),
        other => other.to_string(),
    }
}

pub fn write_config_toml(output_dir: &Path, config: &ProjectConfig, title: &str) {
    let extra_block = match &config.custom {
        Some(serde_json::Value::Object(map)) => map
            .iter()
            .map(|(k, v)| format!("{} = {}", k, json_to_toml(v)))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    };

    // Every interpolated value is escaped. An unescaped quote in the project
    // description used to produce an invalid config.toml and fail the build.
    let config_toml = format!(
        r#"base_url = "{base_url}"
title = "{title}"
description = "{description}"
author = "{author}"
build_search_index = true
# Themes keep their styles in `sass/`, which Zola ignores unless this is on.
compile_sass = true
default_language = "en"

[link_checker]
internal_level = "warn"

[extra]
{extra_block}
"#,
        base_url = escape_toml(
            config
                .base_url
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("/"),
        ),
        title = escape_toml(title),
        description = escape_toml(config.description.as_deref().unwrap_or("")),
        author = escape_toml(config.author.as_deref().unwrap_or("")),
    );

    let _ = fs::create_dir_all(output_dir);
    let _ = fs::write(output_dir.join("config.toml"), config_toml);
}
