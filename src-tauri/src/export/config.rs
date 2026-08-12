use super::types::ProjectConfig;
use sqlx::Row;
use std::collections::HashMap;
use std::path::Path;

const CONFIG_FILENAME: &str = "config.yml";

/// Returns the path to config.yml stored inside `.app/` to keep the
/// workspace root clean (not visible in the file explorer sidebar).
fn config_path(workspace_path: &Path) -> std::path::PathBuf {
    workspace_path.join(".app").join(CONFIG_FILENAME)
}

pub fn load_config(workspace_path: &Path) -> Result<ProjectConfig, String> {
    // Also check the old location in the workspace root for backwards-compatibility
    let new_path = config_path(workspace_path);
    let old_path = workspace_path.join(CONFIG_FILENAME);

    let path = if new_path.exists() {
        new_path
    } else if old_path.exists() {
        // Migrate: move the old config.yml into .app/ and remove the old one
        let _ = std::fs::create_dir_all(workspace_path.join(".app"));
        let _ = std::fs::copy(&old_path, &new_path);
        let _ = std::fs::remove_file(&old_path);
        new_path
    } else {
        return Err("config.yml not found".to_string());
    };

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read config.yml: {}", e))?;
    serde_yaml::from_str(&content).map_err(|e| format!("Invalid config.yml: {}", e))
}

pub fn config_exists(workspace_path: &Path) -> bool {
    // Check both new and old locations
    config_path(workspace_path).exists() || workspace_path.join(CONFIG_FILENAME).exists()
}

pub async fn create_default_config(workspace_path: &Path, pool: &sqlx::SqlitePool) -> Result<ProjectConfig, String> {
    let rows = sqlx::query("SELECT file_path FROM documents WHERE file_path IS NOT NULL AND file_path != '' ORDER BY file_path ASC")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let order: Vec<String> = rows.iter().map(|r| r.get("file_path")).collect();

    let title = workspace_path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| {
            n.split(['-', '_'])
                .map(|w| {
                    let mut c = w.chars();
                    match c.next() {
                        None => String::new(),
                        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                    }
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|s| !s.is_empty());

    let config = ProjectConfig {
        title,
        author: None,
        description: None,
        exclude: vec![],
        order,
        theme: Some("classic".to_string()),
        excerpt: HashMap::new(),
        custom: None,
        index_page: Some("README.md".to_string()),
    };

    // Ensure .app/ directory exists before writing
    let app_dir = workspace_path.join(".app");
    std::fs::create_dir_all(&app_dir)
        .map_err(|e| format!("Failed to create .app directory: {}", e))?;

    let yaml = serde_yaml::to_string(&config).map_err(|e| e.to_string())?;
    std::fs::write(config_path(workspace_path), &yaml)
        .map_err(|e| format!("Failed to write config.yml: {}", e))?;

    Ok(config)
}

pub async fn get_or_create_config(workspace_path: &Path, pool: &sqlx::SqlitePool) -> Result<ProjectConfig, String> {
    if config_exists(workspace_path) {
        load_config(workspace_path)
    } else {
        create_default_config(workspace_path, pool).await
    }
}
