use super::types::ProjectConfig;
use sqlx::Row;
use std::collections::HashMap;
use std::path::Path;

const CONFIG_FILENAME: &str = "config.yml";

fn config_path(workspace_path: &Path) -> std::path::PathBuf {
    workspace_path.join(CONFIG_FILENAME)
}

pub fn load_config(workspace_path: &Path) -> Result<ProjectConfig, String> {
    let path = config_path(workspace_path);
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read config.yml: {}", e))?;
    serde_yaml::from_str(&content).map_err(|e| format!("Invalid config.yml: {}", e))
}

pub fn config_exists(workspace_path: &Path) -> bool {
    config_path(workspace_path).exists()
}

pub async fn create_default_config(workspace_path: &Path, pool: &sqlx::SqlitePool) -> Result<ProjectConfig, String> {
    let rows = sqlx::query("SELECT file_path FROM documents WHERE file_path IS NOT NULL AND file_path != '' ORDER BY file_path ASC")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let order: Vec<String> = rows.iter().map(|r| r.get("file_path")).collect();

    let config = ProjectConfig {
        title: None,
        author: None,
        description: None,
        exclude: vec![],
        order,
        theme: Some("classic".to_string()),
        excerpt: HashMap::new(),
        custom: None,
    };

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
