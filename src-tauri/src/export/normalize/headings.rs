use crate::export::types::HeadingNode;
use crate::export::utils::markdown;
use crate::export::utils::title;
use std::collections::HashSet;

/// Places `node` under the deepest trailing ancestor whose level is shallower.
fn insert_at_level(siblings: &mut Vec<HeadingNode>, node: HeadingNode) {
    if let Some(last) = siblings.last_mut() {
        if node.level > last.level {
            insert_at_level(&mut last.children, node);
            return;
        }
    }
    siblings.push(node);
}

/// Builds the nested table of contents for a document.
///
/// Headings inside fenced code blocks are ignored, and anchors are made unique
/// within the document so repeated headings ("Overview", "Examples") each get a
/// link that resolves.
pub fn build_heading_tree(md: &str) -> Vec<HeadingNode> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut root: Vec<HeadingNode> = Vec::new();

    for (level, text) in markdown::heading_lines(md) {
        let anchor = title::unique_anchor(&title::to_anchor(&text), &mut seen);
        insert_at_level(
            &mut root,
            HeadingNode { level, text, anchor, children: vec![] },
        );
    }

    root
}
