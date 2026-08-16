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

    // `date` has to be top-level for Zola to sort on it. It used to exist only
    // under `[extra]` as `created_at`, where the sort cannot see it — so a blog
    // set to `sort_by = "date"` silently fell back to input order.
    if let Some(date) = page_date(page) {
        top.push_str(&format!("\ndate = {date}"));
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
    if !page.backlinks.is_empty() {
        let items: Vec<String> = page
            .backlinks
            .iter()
            .map(|(path, title)| {
                format!(
                    "{{ path = \"{}\", title = \"{}\" }}",
                    escape_toml(path),
                    escape_toml(title),
                )
            })
            .collect();
        extras.push(format!("backlinks = [{}]", items.join(", ")));
    }

    format!("+++\n{}\n\n[extra]\n{}\n+++\n{}", top, extras.join("\n"), page.content)
}

/// The page's date as a bare TOML date, or `None` when it has neither
/// timestamp.
///
/// Zola wants `date = 2024-05-01`, unquoted. The stored timestamps are ISO 8601
/// with a time part, which Zola also accepts, so only the trailing `Z` and any
/// fractional seconds need trimming.
fn page_date(page: &PageInfo) -> Option<String> {
    let raw = page
        .created_at
        .as_deref()
        .or(page.updated_at.as_deref())?
        .trim();

    let date = raw.split(['T', ' ']).next().unwrap_or(raw);
    // Anything that is not `YYYY-MM-DD` would fail the Zola build outright.
    let valid = date.len() == 10
        && date.as_bytes()[4] == b'-'
        && date.as_bytes()[7] == b'-'
        && date.bytes().enumerate().all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit());

    valid.then(|| date.to_string())
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