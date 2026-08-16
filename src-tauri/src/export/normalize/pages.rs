use crate::export::normalize::headings::build_heading_tree;
use crate::export::types::{DocInfo, PageInfo};
use crate::export::utils::{markdown, paths, title};
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashSet;

/// Compiled once rather than per page — `build_pages` runs this over every
/// document in the workspace.
static IMAGE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"!\[[^\]]*\]\(([^)\s]+)").expect("valid image regex"));

/// Inline links, excluding images — the leading `!` is what separates them.
static LINK_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?:^|[^!])\[[^\]]*\]\(([^)\s]+)").expect("valid link regex"));

const WORDS_PER_MINUTE: i32 = 200;

/// Repoints document-relative image references at the exported site root.
///
/// In the workspace an image is `./.assets/imgs/x.webp`, relative to the file
/// that uses it. A page's URL in the built site bears no relation to its path on
/// disk, so that reference resolves to nothing once exported. The export copies
/// every document's assets into `static/.assets/imgs`, and this points the
/// references there.
fn rewrite_asset_paths(md: &str) -> String {
    md.replace("](./.assets/imgs/", "](/.assets/imgs/")
        .replace("](.assets/imgs/", "](/.assets/imgs/")
        .replace("](../.assets/imgs/", "](/.assets/imgs/")
}

fn extract_images(md: &str) -> Vec<String> {
    let prose = markdown::prose_lines(md).join("\n");
    let mut urls: Vec<String> = IMAGE_RE
        .captures_iter(&prose)
        .filter_map(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .collect();
    urls.sort();
    urls.dedup();
    urls
}

/// Assigns each page a slug unique across the whole site.
///
/// Two documents named `intro.md` in different folders would otherwise collide
/// at the same URL. The first keeps the bare slug; later ones are qualified by
/// their folder, then by a numeric suffix.
fn deduplicate_slugs(pages: &mut [PageInfo]) {
    let mut taken: HashSet<String> = HashSet::new();

    for page in pages.iter_mut() {
        if taken.insert(page.slug.clone()) {
            continue;
        }

        let folder = paths::get_folder(&page.file_path);
        let qualified = folder
            .rsplit('/')
            .next()
            .filter(|f| !f.is_empty())
            .map(|f| format!("{}-{}", paths::compute_slug(f), page.slug));

        if let Some(candidate) = qualified {
            if taken.insert(candidate.clone()) {
                page.slug = candidate;
                continue;
            }
        }

        let mut n = 2;
        loop {
            let candidate = format!("{}-{}", page.slug, n);
            if taken.insert(candidate.clone()) {
                page.slug = candidate;
                break;
            }
            n += 1;
        }
    }
}

/// Links `prev`/`next` across the pages a reader can actually reach.
///
/// The index page is rendered as the site root, not as a standalone page, so it
/// must not appear in the chain — a link to it would 404.
fn link_navigation(pages: &mut [PageInfo], index_path: Option<&str>) {
    let chain: Vec<usize> = (0..pages.len())
        .filter(|&i| match index_path {
            Some(ip) => !pages[i].file_path.eq_ignore_ascii_case(ip),
            None => true,
        })
        .collect();

    for (pos, &i) in chain.iter().enumerate() {
        let prev = pos
            .checked_sub(1)
            .map(|p| chain[p])
            .map(|j| (pages[j].html_path.clone(), pages[j].title.clone()));
        let next = chain
            .get(pos + 1)
            .map(|&j| (pages[j].html_path.clone(), pages[j].title.clone()));
        pages[i].prev = prev;
        pages[i].next = next;
    }
}

/// Records, for every page, which other pages link to it.
///
/// Link targets in the workspace are document paths (`guide/intro.md`,
/// `./intro.md`, `../guide/intro.md`), so each is resolved relative to the page
/// that holds it and matched against every known `file_path`. Anchors and query
/// strings are trimmed; external links and self-links are ignored.
fn link_backlinks(pages: &mut [PageInfo]) {
    let by_file: std::collections::HashMap<String, usize> = pages
        .iter()
        .enumerate()
        .map(|(i, p)| (p.file_path.to_lowercase(), i))
        .collect();

    // (target index, source index) pairs, collected before mutating so the
    // borrow of `pages` ends first.
    let mut edges: Vec<(usize, usize)> = Vec::new();

    for (source, page) in pages.iter().enumerate() {
        let prose = markdown::prose_lines(&page.content).join("\n");
        for capture in LINK_RE.captures_iter(&prose) {
            let Some(target) = capture.get(1).map(|m| m.as_str()) else { continue };
            let Some(resolved) = resolve_link(&page.file_path, target) else { continue };
            let Some(&index) = by_file.get(&resolved) else { continue };
            if index != source {
                edges.push((index, source));
            }
        }
    }

    for (target, source) in edges {
        let entry = (pages[source].html_path.clone(), pages[source].title.clone());
        let backlinks = &mut pages[target].backlinks;
        if !backlinks.contains(&entry) {
            backlinks.push(entry);
        }
    }

    for page in pages.iter_mut() {
        page.backlinks.sort();
    }
}

/// Resolves a Markdown link target against the linking document's own path.
///
/// Returns `None` for anything that cannot name a document in this workspace —
/// external URLs, bare anchors, and mail links.
fn resolve_link(from: &str, target: &str) -> Option<String> {
    let target = target.split(['#', '?']).next().unwrap_or(target).trim();
    if target.is_empty() || target.contains("://") || target.starts_with('#') || target.starts_with("mailto:") {
        return None;
    }

    // An absolute-looking target is relative to the workspace root.
    let raw = target.trim_start_matches('/');
    let base = if target.starts_with('/') {
        Vec::new()
    } else {
        let folder = paths::get_folder(from);
        if folder.is_empty() {
            Vec::new()
        } else {
            folder.split('/').map(str::to_string).collect()
        }
    };

    let mut segments = base;
    for part in raw.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            other => segments.push(other.to_string()),
        }
    }

    Some(segments.join("/").to_lowercase())
}

fn build_breadcrumbs(page: &PageInfo) -> Vec<(String, Option<String>)> {
    let mut crumbs = vec![("Home".to_string(), Some("index.html".to_string()))];
    let folder = paths::get_folder(&page.file_path);
    if !folder.is_empty() {
        for part in folder.split('/') {
            crumbs.push((title::humanize_group(part), None));
        }
    }
    crumbs.push((page.title.clone(), Some(page.html_path.clone())));
    crumbs
}

pub fn build_pages(docs: &[&DocInfo], index_path: Option<&str>) -> Vec<PageInfo> {
    let mut pages: Vec<PageInfo> = docs
        .iter()
        .map(|doc| PageInfo {
            file_path: doc.file_path.clone(),
            html_path: paths::to_html_path(&doc.file_path),
            slug: paths::compute_slug(&doc.file_path),
            title: doc.title.clone(),
            h1: doc.h1.clone(),
            heading_tree: build_heading_tree(&doc.content),
            excerpt: doc.excerpt.clone(),
            word_count: doc.word_count,
            reading_time_minutes: std::cmp::max(1, doc.word_count / WORDS_PER_MINUTE),
            depth: 0,
            prev: None,
            next: None,
            backlinks: vec![],
            breadcrumbs: vec![],
            tags: paths::extract_tags(&doc.file_path),
            images: extract_images(&rewrite_asset_paths(&doc.content)),
            code_languages: markdown::fence_languages(&doc.content),
            created_at: doc.file_created_at.clone(),
            updated_at: doc.updated_at.clone(),
            content: rewrite_asset_paths(&doc.content),
        })
        .collect();

    deduplicate_slugs(&mut pages);
    link_navigation(&mut pages, index_path);
    link_backlinks(&mut pages);

    for i in 0..pages.len() {
        pages[i].breadcrumbs = build_breadcrumbs(&pages[i]);
    }

    pages
}
