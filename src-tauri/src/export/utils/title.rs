use std::path::Path;

/// Title-cases a `-`/`_`/space separated identifier: `getting-started` ->
/// `Getting Started`. Previously duplicated three times (`humanize_group`,
/// `default_theme_name`, `workspace_title`, plus an inline copy in `config.rs`).
pub fn title_case(raw: &str) -> String {
    raw.split(['-', '_', ' '])
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Title-cases the final component of a path-like string.
pub fn humanize_group(path: &str) -> String {
    title_case(path.rsplit('/').next().unwrap_or(path))
}

/// Slugifies heading text into a URL fragment.
///
/// Runs of separators collapse to a single hyphen and leading/trailing
/// separators are trimmed, so the anchor matches what a renderer emits for the
/// same heading. Anchors are made unique per-document by
/// [`crate::export::normalize::headings::build_heading_tree`].
pub fn to_anchor(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut pending_sep = false;

    for c in text.chars() {
        if c.is_alphanumeric() || c == '_' {
            if pending_sep && !out.is_empty() {
                out.push('-');
            }
            pending_sep = false;
            out.extend(c.to_lowercase());
        } else if c == ' ' || c == '-' {
            // Defer the separator so runs collapse and trailing ones vanish.
            pending_sep = true;
        }
        // Everything else (punctuation, emoji, em dashes) is dropped.
    }

    out
}

/// Appends `-1`, `-2`, ... to `anchor` until it is unused, recording the result.
pub fn unique_anchor(anchor: &str, seen: &mut std::collections::HashSet<String>) -> String {
    let base = if anchor.is_empty() { "section" } else { anchor };
    if seen.insert(base.to_string()) {
        return base.to_string();
    }
    let mut n = 1;
    loop {
        let candidate = format!("{base}-{n}");
        if seen.insert(candidate.clone()) {
            return candidate;
        }
        n += 1;
    }
}

fn title_from_path(path: &Path, fallback: &str) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(title_case)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

pub fn default_theme_name(theme_dir: &Path) -> String {
    title_from_path(theme_dir, "Untitled")
}

pub fn workspace_title(workspace_path: &Path) -> String {
    title_from_path(workspace_path, "Untitled")
}

/// Zola treats `index.md` specially, so a user document literally named
/// `index.md` is written under a reserved-safe name instead.
pub fn safe_content_filename(stub_path: &str) -> String {
    let path = Path::new(stub_path);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or(stub_path);
    if stem.eq_ignore_ascii_case("index") {
        let parent = path.parent().and_then(|p| p.to_str()).filter(|p| !p.is_empty());
        match parent {
            Some(p) => format!("{p}/pg-index"),
            None => "pg-index".to_string(),
        }
    } else {
        stub_path.to_string()
    }
}
