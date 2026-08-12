use crate::export::types::{DocInfo, ExportNode};
use crate::export::utils::{paths::get_folder, title::humanize_group, paths::to_html_path};
use std::collections::HashMap;

fn assign_depth(nodes: &mut [ExportNode], parent_depth: usize) {
    for node in nodes.iter_mut() {
        node.depth = parent_depth;
        assign_depth(&mut node.children, parent_depth + 1);
    }
}

pub fn build_tree(sorted: &[&DocInfo]) -> Vec<ExportNode> {
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