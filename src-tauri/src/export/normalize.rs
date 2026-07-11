use super::types::{DocInfo, ExportContext, ExportNode, HeadingNode, PageInfo, ProjectConfig};
use std::collections::HashMap;

fn get_folder(path: &str) -> String {
    std::path::Path::new(path)
        .parent().and_then(|p| p.to_str())
        .filter(|p| !p.is_empty())
        .map(|p| p.to_string())
        .unwrap_or_default()
}

fn extract_prefix(path: &str) -> i32 {
    let stem = std::path::Path::new(path)
        .file_stem().and_then(|s| s.to_str()).unwrap_or("");
    stem.chars().take_while(|c| c.is_ascii_digit()).collect::<String>()
        .parse::<i32>().unwrap_or(i32::MAX)
}

fn humanize_group(path: &str) -> String {
    path.split('/').last().unwrap_or(path)
        .replace('-', " ")
        .split(' ')
        .map(|w| w[..1].to_uppercase() + &w[1..])
        .collect::<Vec<_>>()
        .join(" ")
}

fn to_html_path(path: &str) -> String {
    std::path::Path::new(path).with_extension("html").to_string_lossy().to_string()
}

fn extract_tags(path: &str) -> Vec<String> {
    let folder = get_folder(path);
    if folder.is_empty() { vec![] } else { vec![humanize_group(&folder)] }
}

fn compute_slug(path: &str) -> String {
    std::path::Path::new(path)
        .file_stem().and_then(|s| s.to_str())
        .map(|s| s.trim_start_matches(|c: char| c.is_ascii_digit() || c == '-' || c == '_' || c == ' ').to_lowercase())
        .unwrap_or_default()
}

fn to_anchor(text: &str) -> String {
    text.to_lowercase()
        .chars().filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-' || *c == '_')
        .collect::<String>()
        .replace(' ', "-")
}

fn build_heading_tree(md: &str) -> Vec<HeadingNode> {
    let raw: Vec<(i32, String)> = md.lines().filter_map(|l| {
        let t = l.trim();
        let level = t.chars().take_while(|c| *c == '#').count() as i32;
        if level >= 1 && level <= 6 && t.len() > level as usize && t.as_bytes()[level as usize] == b' ' {
            Some((level, t[level as usize + 1..].trim().to_string()))
        } else { None }
    }).collect();

    fn insert(children: &mut Vec<HeadingNode>, level: i32, text: &str) {
        let anchor = to_anchor(text);
        let node = HeadingNode { level, text: text.to_string(), anchor, children: vec![] };
        if let Some(last) = children.last_mut() {
            if level > last.level {
                insert(&mut last.children, level, text);
                return;
            }
        }
        children.push(node);
    }

    let mut root: Vec<HeadingNode> = vec![];
    for (level, text) in &raw {
        if *level == 1 && !root.is_empty() {
            root.push(HeadingNode {
                level: *level, text: text.clone(),
                anchor: to_anchor(text), children: vec![],
            });
        } else {
            insert(&mut root, *level, text);
        }
    }
    root
}

fn extract_images(md: &str) -> Vec<String> {
    let re = regex::Regex::new(r"!\[.*?\]\(([^)]+)\)").unwrap();
    let mut urls: Vec<String> = re.captures_iter(md).filter_map(|c| c.get(1)).map(|m| m.as_str().to_string()).collect();
    urls.sort();
    urls.dedup();
    urls
}

fn extract_code_languages(md: &str) -> Vec<String> {
    let re = regex::Regex::new(r"^```(\w+)").unwrap();
    let mut langs: Vec<String> = md.lines().filter_map(|l| {
        re.captures(l).and_then(|c| c.get(1)).map(|m| m.as_str().to_string())
    }).collect();
    langs.sort();
    langs.dedup();
    langs
}

fn build_pages(docs: &[&DocInfo]) -> Vec<PageInfo> {
    let mut pages: Vec<PageInfo> = Vec::new();
    for doc in docs {
        let heading_tree = build_heading_tree(&doc.content);
        pages.push(PageInfo {
            file_path: doc.file_path.clone(),
            html_path: to_html_path(&doc.file_path),
            slug: compute_slug(&doc.file_path),
            title: doc.title.clone(),
            h1: doc.h1.clone(),
            heading_tree,
            excerpt: doc.excerpt.clone(),
            word_count: doc.word_count,
            reading_time_minutes: std::cmp::max(1, doc.word_count / 200),
            depth: 0,
            prev: None,
            next: None,
            breadcrumbs: vec![],
            tags: extract_tags(&doc.file_path),
            images: extract_images(&doc.content),
            code_languages: extract_code_languages(&doc.content),
            created_at: doc.file_created_at.clone(),
            updated_at: None,
        });
    }

    for i in 0..pages.len() {
        pages[i].prev = if i > 0 {
            Some((pages[i - 1].html_path.clone(), pages[i - 1].title.clone()))
        } else { None };
        pages[i].next = pages.get(i + 1).map(|p| (p.html_path.clone(), p.title.clone()));

        let mut crumbs = vec![("Home".to_string(), Some("index.html".to_string()))];
        let folder = get_folder(&pages[i].file_path);
        if !folder.is_empty() {
            for part in folder.split('/') {
                crumbs.push((humanize_group(part), None));
            }
        }
        crumbs.push((pages[i].title.clone(), Some(pages[i].html_path.clone())));
        pages[i].breadcrumbs = crumbs;
    }
    pages
}

fn assign_depth(nodes: &mut [ExportNode], parent_depth: usize) {
    for node in nodes.iter_mut() {
        node.depth = parent_depth;
        assign_depth(&mut node.children, parent_depth + 1);
    }
}

fn build_tree(sorted: &[&DocInfo]) -> Vec<ExportNode> {
    let mut root: Vec<ExportNode> = Vec::new();
    let mut group_map: HashMap<String, Vec<ExportNode>> = HashMap::new();
    let mut root_files: Vec<ExportNode> = Vec::new();

    for doc in sorted {
        let folder = get_folder(&doc.file_path);
        let node = ExportNode {
            title: doc.title.clone(),
            file_path: Some(doc.file_path.clone()),
            html_path: Some(to_html_path(&doc.file_path)),
            depth: 0, children: vec![],
        };
        if folder.is_empty() { root_files.push(node); }
        else { group_map.entry(folder).or_default().push(node); }
    }

    root.append(&mut root_files);
    let mut group_keys: Vec<String> = group_map.keys().cloned().collect();
    group_keys.sort();
    for key in &group_keys {
        let children = group_map.remove(key).unwrap();
        root.push(ExportNode { title: humanize_group(key), file_path: None, html_path: None, depth: 0, children });
    }
    assign_depth(&mut root, 0);
    root
}

pub fn build_context(docs: &[DocInfo], config: &ProjectConfig) -> ExportContext {
    let mut sorted: Vec<&DocInfo> = docs.iter().collect();
    if !config.order.is_empty() {
        let order_map: HashMap<&str, usize> = config.order.iter().enumerate().map(|(i, p)| (p.as_str(), i)).collect();
        sorted.sort_by_key(|d| order_map.get(d.file_path.as_str()).copied().unwrap_or(usize::MAX));
    } else {
        sorted.sort_by(|a, b| {
            (extract_prefix(&a.file_path), get_folder(&a.file_path), &a.file_path)
                .cmp(&(extract_prefix(&b.file_path), get_folder(&b.file_path), &b.file_path))
        });
    }

    let mut pages = build_pages(&sorted);
    for p in pages.iter_mut() {
        p.depth = get_folder(&p.file_path).split('/').count();
    }

    ExportContext { config: config.clone(), tree: build_tree(&sorted), pages }
}
