use std::path::Path;

/// Longest run of digits still treated as an ordering prefix (`01-`, `002_`).
/// Four or more digits is a year or an identifier and belongs in the slug.
const MAX_ORDERING_PREFIX_DIGITS: usize = 3;

pub fn get_folder(path: &str) -> String {
    Path::new(path)
        .parent()
        .and_then(|p| p.to_str())
        .filter(|p| !p.is_empty())
        .map(|p| p.to_string())
        .unwrap_or_default()
}

pub fn to_html_path(path: &str) -> String {
    Path::new(path).with_extension("html").to_string_lossy().to_string()
}

/// Strips a short leading digit run used purely for ordering, e.g.
/// `01-intro` -> `intro`. Leaves `2024-report` intact.
fn strip_ordering_prefix(stem: &str) -> &str {
    let digits = stem.chars().take_while(|c| c.is_ascii_digit()).count();
    if digits == 0 || digits > MAX_ORDERING_PREFIX_DIGITS {
        return stem;
    }
    let rest = &stem[digits..];
    match rest.chars().next() {
        Some('-' | '_' | ' ') => {
            let stripped = rest.trim_start_matches(['-', '_', ' ']);
            // Never let the prefix consume the whole name.
            if stripped.is_empty() { stem } else { stripped }
        }
        _ => stem,
    }
}

/// URL slug for a document. Never empty — an empty slug makes Zola emit the
/// page at its parent's URL, silently shadowing the section index.
pub fn compute_slug(path: &str) -> String {
    let stem = Path::new(path).file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let slug = strip_ordering_prefix(stem).to_lowercase();
    if slug.is_empty() {
        stem.to_lowercase()
    } else {
        slug
    }
}

pub fn extract_prefix(path: &str) -> i32 {
    let stem = Path::new(path).file_stem().and_then(|s| s.to_str()).unwrap_or("");
    stem.chars()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse::<i32>()
        .unwrap_or(i32::MAX)
}

pub fn extract_tags(path: &str) -> Vec<String> {
    let folder = get_folder(path);
    if folder.is_empty() {
        vec![]
    } else {
        vec![crate::export::utils::title::humanize_group(&folder)]
    }
}

/// True when `needle` appears as a contiguous run of whole path *directory*
/// segments in `rel_path`.
fn has_directory_segments(rel_path: &str, needle: &str) -> bool {
    let segs: Vec<&str> = rel_path.split('/').filter(|s| !s.is_empty()).collect();
    if segs.len() < 2 {
        return false;
    }
    // The final segment is the filename, never a directory.
    let dirs = &segs[..segs.len() - 1];
    let needle_segs: Vec<&str> = needle.split('/').filter(|s| !s.is_empty()).collect();
    if needle_segs.is_empty() || needle_segs.len() > dirs.len() {
        return false;
    }
    dirs.windows(needle_segs.len()).any(|w| w == needle_segs.as_slice())
}

fn is_glob(pattern: &str) -> bool {
    pattern.contains('*') || pattern.contains('?') || pattern.contains('[')
}

/// Matches a workspace-relative path against the `exclude` patterns from
/// `config.yml`.
///
/// Three pattern forms are supported:
/// - `drafts/` — any document under a directory segment named `drafts`
/// - `*.tmp.md`, `**/deep.md` — glob, matched against the full path and the
///   bare filename
/// - `private.md` — exact path, or that exact filename in any folder
pub fn matches_exclude(rel_path: &str, patterns: &[String]) -> bool {
    let basename = rel_path.rsplit('/').next().unwrap_or(rel_path);

    patterns.iter().any(|raw| {
        let pattern = raw.trim();
        if pattern.is_empty() {
            return false;
        }

        if let Some(dir) = pattern.strip_suffix('/') {
            return has_directory_segments(rel_path, dir);
        }

        if is_glob(pattern) {
            return match glob::Pattern::new(pattern) {
                Ok(p) => p.matches(rel_path) || p.matches(basename),
                Err(_) => false,
            };
        }

        rel_path == pattern || basename == pattern
    })
}

pub fn relative_path(file_path: &Path, workspace_path: &Path) -> String {
    file_path
        .strip_prefix(workspace_path)
        .unwrap_or(file_path)
        .to_string_lossy()
        .to_string()
}
