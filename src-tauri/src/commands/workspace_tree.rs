use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileNode>>,
}

/// Directories that are never worth walking into for a writing workspace.
///
/// The tree used to descend into every one of these. A workspace that happened
/// to contain a `node_modules` produced tens of thousands of nodes per walk,
/// all of them serialised to the webview.
const IGNORED_DIRS: &[&str] = &["node_modules", "target", "dist", "build", ".git"];

/// Guards against pathological nesting; no writing project legitimately nests
/// this deep, and it bounds the work a symlinked or generated tree can cause.
const MAX_DEPTH: usize = 24;

#[tauri::command]
pub async fn get_directory_tree(
    workspace_path: String,
    show_hidden: Option<bool>,
) -> Result<FileNode, String> {
    let show = show_hidden.unwrap_or(false);

    // Walking the tree is blocking filesystem work. As a synchronous command it
    // ran on the main thread, so every pass stalled the UI for as long as the
    // walk took.
    tokio::task::spawn_blocking(move || {
        let path = std::path::PathBuf::from(&workspace_path);
        if !path.exists() {
            return Err("Workspace path does not exist".to_string());
        }
        read_dir(&path, show, 0)
    })
    .await
    .map_err(|e| format!("Directory scan failed: {e}"))?
}

fn read_dir(path: &Path, show_hidden: bool, depth: usize) -> Result<FileNode, String> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let is_dir = path.is_dir();
    let mut children = None;

    if is_dir && depth < MAX_DEPTH {
        let mut list = Vec::new();
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                let entry_name = entry.file_name().to_string_lossy().to_string();

                if !show_hidden && entry_name.starts_with('.') {
                    continue;
                }

                // `file_type` does not follow symlinks, so a link pointing at an
                // ancestor cannot send the walk into a cycle.
                let Ok(file_type) = entry.file_type() else { continue };
                if file_type.is_symlink() {
                    continue;
                }
                if file_type.is_dir() && IGNORED_DIRS.contains(&entry_name.as_str()) {
                    continue;
                }

                if let Ok(node) = read_dir(&entry_path, show_hidden, depth + 1) {
                    list.push(node);
                }
            }
        }
        list.sort_by(|a, b| {
            if a.is_dir != b.is_dir {
                b.is_dir.cmp(&a.is_dir)
            } else {
                a.name.to_lowercase().cmp(&b.name.to_lowercase())
            }
        });
        children = Some(list);
    } else if is_dir {
        children = Some(Vec::new());
    }

    Ok(FileNode {
        name,
        path: path.to_string_lossy().to_string(),
        is_dir,
        children,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("frontmatter_tree_{name}_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn skips_ignored_and_hidden_directories() {
        let root = temp_dir("ignored");
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::create_dir_all(root.join(".hidden")).unwrap();
        std::fs::create_dir_all(root.join("chapters")).unwrap();
        std::fs::write(root.join("chapters/one.md"), "# one").unwrap();

        let tree = read_dir(&root, false, 0).unwrap();
        let names: Vec<String> = tree.children.unwrap().iter().map(|c| c.name.clone()).collect();

        assert_eq!(names, vec!["chapters".to_string()]);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn includes_hidden_when_requested() {
        let root = temp_dir("hidden");
        std::fs::create_dir_all(root.join(".config")).unwrap();
        std::fs::write(root.join("notes.md"), "hi").unwrap();

        let tree = read_dir(&root, true, 0).unwrap();
        let names: Vec<String> = tree.children.unwrap().iter().map(|c| c.name.clone()).collect();

        assert!(names.contains(&".config".to_string()));
        assert!(names.contains(&"notes.md".to_string()));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn sorts_directories_before_files() {
        let root = temp_dir("sort");
        std::fs::write(root.join("a.md"), "").unwrap();
        std::fs::create_dir_all(root.join("z_folder")).unwrap();

        let tree = read_dir(&root, false, 0).unwrap();
        let children = tree.children.unwrap();

        assert!(children[0].is_dir);
        assert_eq!(children[0].name, "z_folder");
        assert_eq!(children[1].name, "a.md");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn stops_descending_at_max_depth() {
        let root = temp_dir("depth");
        let mut deep = root.clone();
        for i in 0..(MAX_DEPTH + 4) {
            deep = deep.join(format!("d{i}"));
        }
        std::fs::create_dir_all(&deep).unwrap();

        let tree = read_dir(&root, false, 0).unwrap();

        let mut node = &tree;
        let mut levels = 0;
        while let Some(children) = node.children.as_ref() {
            match children.first() {
                Some(child) => {
                    node = child;
                    levels += 1;
                }
                None => break,
            }
        }
        assert!(levels <= MAX_DEPTH, "walked {levels} levels");
        std::fs::remove_dir_all(&root).ok();
    }
}
