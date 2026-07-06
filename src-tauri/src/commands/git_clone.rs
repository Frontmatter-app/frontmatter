use std::path::Path;
use std::process::Command;

#[derive(serde::Serialize)]
pub struct CloneResult {
    pub path: String,
    pub success: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn git_clone(url: String, destination: String) -> Result<CloneResult, String> {
    let dest_path = Path::new(&destination);

    if dest_path.exists() {
        return Ok(CloneResult {
            path: destination,
            success: false,
            error: Some("Destination already exists".to_string()),
        });
    }

    let parent = dest_path.parent().ok_or("Invalid destination path")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;

    let output = Command::new("git")
        .args(["clone", &url, &destination])
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Ok(CloneResult {
            path: destination,
            success: false,
            error: Some(stderr),
        });
    }

    let gitignore_path = dest_path.join(".gitignore");
    if dest_path.is_dir() && !gitignore_path.exists() {
        let content = ".DS_Store\n*.app\nnode_modules/\n";
        let _ = std::fs::write(&gitignore_path, content);
    }

    Ok(CloneResult {
        path: destination,
        success: true,
        error: None,
    })
}
