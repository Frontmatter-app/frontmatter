use crate::export::types::{DocInfo, ExportContext, ProjectConfig};
use crate::export::utils::paths::{extract_prefix, get_folder};
use std::cmp::Ordering;
use std::path::Path;

pub mod headings;
pub mod pages;
pub mod tree;

use self::pages::build_pages;
use self::tree::build_tree;

/// True when the document's filename stem is `readme`, case-insensitively.
pub fn is_readme(file_path: &str) -> bool {
    Path::new(file_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("readme"))
        .unwrap_or(false)
}

/// Total, content-derived ordering key used whenever the user has not pinned a
/// document in `config.order`.
fn natural_key(doc: &DocInfo) -> (i32, String, String) {
    (
        extract_prefix(&doc.file_path),
        get_folder(&doc.file_path),
        doc.file_path.clone(),
    )
}

/// Resolves which document becomes the site root: an explicit `index_page`,
/// else a root-level README, else any README.
///
/// Shared with [`crate::export::site::project::find_index_page`] so the page
/// written as the index is always the page removed from the nav chain.
pub fn resolve_index_path(docs: &[&DocInfo], config: &ProjectConfig) -> Option<String> {
    if let Some(explicit) = config.index_page.as_deref() {
        if let Some(doc) = docs.iter().find(|d| d.file_path == explicit) {
            return Some(doc.file_path.clone());
        }
    }
    docs.iter()
        .find(|d| is_readme(&d.file_path) && !d.file_path.contains('/'))
        .or_else(|| docs.iter().find(|d| is_readme(&d.file_path)))
        .map(|d| d.file_path.clone())
}

/// Orders documents, then derives the full render context.
///
/// Documents listed in `config.order` come first in the order given; everything
/// else follows in `natural_key` order. Nothing is left to database row order —
/// two runs over an unchanged workspace must produce byte-identical output.
pub fn build_context(docs: &[DocInfo], config: &ProjectConfig) -> ExportContext {
    let mut sorted: Vec<&DocInfo> = docs.iter().collect();

    let order_map: std::collections::HashMap<&str, usize> = config
        .order
        .iter()
        .enumerate()
        .map(|(i, p)| (p.as_str(), i))
        .collect();

    sorted.sort_by(|a, b| {
        let ka = order_map.get(a.file_path.as_str()).copied();
        let kb = order_map.get(b.file_path.as_str()).copied();
        match (ka, kb) {
            (Some(x), Some(y)) => x.cmp(&y),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => natural_key(a).cmp(&natural_key(b)),
        }
    });

    let index_path = resolve_index_path(&sorted, config);
    let mut pages = build_pages(&sorted, index_path.as_deref());
    for p in pages.iter_mut() {
        p.depth = get_folder(&p.file_path).split('/').filter(|s| !s.is_empty()).count();
    }

    ExportContext {
        config: config.clone(),
        tree: build_tree(&sorted),
        pages,
    }
}
