use crate::export::types::{PageInfo, ProjectConfig};
use crate::export::utils::toml::escape_toml;

pub fn build_page_frontmatter(page: &PageInfo, effective_slug: &str, weight: i32) -> String {
    let mut top = format!(
        "title = \"{}\"\ntemplate = \"page.html\"\nslug = \"{}\"\nweight = {}",
        escape_toml(&page.title),
        escape_toml(effective_slug),
        weight,
    );

    if let Some(excerpt) = &page.excerpt {
        if !excerpt.is_empty() {
            top.push_str(&format!("\ndescription = \"{}\"", escape_toml(excerpt)));
        }
    }

    let mut extras: Vec<String> = vec![
        format!("word_count = {}", page.word_count),
        format!("reading_time_minutes = {}", page.reading_time_minutes),
        format!("depth = {}", page.depth),
    ];

    if !page.tags.is_empty() {
        let items: Vec<String> = page.tags.iter().map(|t| format!("\"{}\"", escape_toml(t))).collect();
        extras.push(format!("tags = [{}]", items.join(", ")));
    }
    if !page.images.is_empty() {
        let items: Vec<String> = page.images.iter().map(|i| format!("\"{}\"", escape_toml(i))).collect();
        extras.push(format!("images = [{}]", items.join(", ")));
    }
    if !page.code_languages.is_empty() {
        let items: Vec<String> = page
            .code_languages
            .iter()
            .map(|l| format!("\"{}\"", escape_toml(l)))
            .collect();
        extras.push(format!("code_languages = [{}]", items.join(", ")));
    }
    if let Some(created) = &page.created_at {
        extras.push(format!("created_at = \"{}\"", escape_toml(created)));
    }
    if let Some(updated) = &page.updated_at {
        extras.push(format!("updated_at = \"{}\"", escape_toml(updated)));
    }

    format!("+++\n{}\n\n[extra]\n{}\n+++\n{}", top, extras.join("\n"), page.content)
}

#[allow(dead_code)]
pub fn build_index_frontmatter(
    config: &ProjectConfig,
    title: &str,
    weight: i32,
) -> String {
    let mut frontmatter = format!(
        "title = \"{}\"\ntemplate = \"section.html\"\nweight = {}\n",
        escape_toml(title),
        weight,
    );

    if let Some(desc) = &config.description {
        if !desc.is_empty() {
            frontmatter.push_str(&format!("description = \"{}\"\n", escape_toml(desc)));
        }
    }

    format!("+++\n{}+++\n", frontmatter)
}