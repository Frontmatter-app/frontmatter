use serde::Serialize;

#[derive(Serialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileNode>>,
}

#[tauri::command]
pub fn get_directory_tree(workspace_path: String, show_hidden: Option<bool>) -> Result<FileNode, String> {
    let path = std::path::Path::new(&workspace_path);
    if !path.exists() { return Err("Workspace path does not exist".to_string()); }
    let show = show_hidden.unwrap_or(false);
    read_dir(path, show)
}

fn read_dir(path: &std::path::Path, show_hidden: bool) -> Result<FileNode, String> {
    let name = path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let is_dir = path.is_dir();
    let mut children = None;

    if is_dir {
        let mut list = Vec::new();
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                if !show_hidden && entry_path.file_name().map(|n| n.to_string_lossy().starts_with('.')).unwrap_or(false) {
                    continue;
                }
                if let Ok(node) = read_dir(&entry_path, show_hidden) { list.push(node); }
            }
        }
        list.sort_by(|a, b| {
            if a.is_dir != b.is_dir { b.is_dir.cmp(&a.is_dir) }
            else { a.name.to_lowercase().cmp(&b.name.to_lowercase()) }
        });
        children = Some(list);
    }

    Ok(FileNode { name, path: path.to_string_lossy().to_string(), is_dir, children })
}
