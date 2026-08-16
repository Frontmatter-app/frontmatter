use super::types::{ProjectConfig, ProjectConfigPayload};
use sqlx::Row;
use std::collections::HashMap;
use std::path::Path;

const CONFIG_FILENAME: &str = "config.yml";

/// Returns the path to config.yml stored inside `.app/` to keep the
/// workspace root clean (not visible in the file explorer sidebar).
pub fn config_path(workspace_path: &Path) -> std::path::PathBuf {
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

    // No theme is named until the user picks one. This used to default to
    // `"classic"`, a theme that exists in no search root, so the value was
    // dead and the picker could never show a remembered choice.
    let config = ProjectConfig {
        title,
        author: None,
        description: None,
        exclude: vec![],
        order,
        theme: None,
        excerpt: HashMap::new(),
        custom: None,
        index_page: Some("README.md".to_string()),
        base_url: None,
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

/// The config as a generic tree, plus the typed view the exporter uses.
///
/// Creates the default file when none exists, so the settings step always has
/// something to show rather than an empty editor the user must guess at.
pub async fn read_raw_config(
    workspace_path: &Path,
    pool: &sqlx::SqlitePool,
) -> Result<ProjectConfigPayload, String> {
    let config = get_or_create_config(workspace_path, pool).await?;
    let path = config_path(workspace_path);

    // Read the file rather than re-serializing `config`, so keys the struct
    // does not know about still reach the editor.
    let values = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_yaml::from_str::<serde_yaml::Value>(&text).ok())
        .unwrap_or_else(|| {
            serde_yaml::to_value(&config).unwrap_or(serde_yaml::Value::Null)
        });

    Ok(ProjectConfigPayload {
        values,
        config,
        path: path.to_string_lossy().to_string(),
    })
}

/// Writes edited config values back to `config.yml`.
///
/// The tree is written whole, so keys the exporter does not model survive and
/// their order is preserved. Values must still parse as a [`ProjectConfig`] —
/// a type the exporter cannot read is rejected before the file is touched.
pub fn write_values(
    workspace_path: &Path,
    values: &serde_yaml::Value,
) -> Result<ProjectConfigPayload, String> {
    let config: ProjectConfig = serde_yaml::from_value(values.clone())
        .map_err(|e| format!("These settings are not valid: {e}"))?;

    let yaml = serde_yaml::to_string(values)
        .map_err(|e| format!("Could not serialise config.yml: {e}"))?;

    let app_dir = workspace_path.join(".app");
    std::fs::create_dir_all(&app_dir)
        .map_err(|e| format!("Failed to create .app directory: {e}"))?;
    std::fs::write(config_path(workspace_path), &yaml)
        .map_err(|e| format!("Failed to write config.yml: {e}"))?;

    Ok(ProjectConfigPayload {
        values: values.clone(),
        config,
        path: config_path(workspace_path).to_string_lossy().to_string(),
    })
}

/// Records the theme the user just published with, so reopening the picker
/// restores their choice. A failure here must not fail the export.
pub fn remember_theme(workspace_path: &Path, theme: &str) {
    let Ok(existing) = std::fs::read_to_string(config_path(workspace_path)) else { return };
    let Ok(mut value) = serde_yaml::from_str::<serde_yaml::Value>(&existing) else { return };

    let serde_yaml::Value::Mapping(map) = &mut value else { return };
    map.insert(
        serde_yaml::Value::String("theme".to_string()),
        serde_yaml::Value::String(theme.to_string()),
    );

    if let Ok(yaml) = serde_yaml::to_string(&value) {
        let _ = std::fs::write(config_path(workspace_path), yaml);
    }
}
