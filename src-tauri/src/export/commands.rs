use super::site::theme::ThemeRoots;
use super::types::{ExportTarget, ProjectType, ThemeOption};
use super::{config, discover, normalize, site, zola};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use tauri::Manager;

#[derive(Clone, Serialize)]
pub struct ExportDonePayload {
    success: bool,
    output_dir: String,
    page_count: usize,
    error: Option<String>,
}

impl ExportDonePayload {
    fn failed(output_dir: &Path, page_count: usize, error: String) -> Self {
        Self {
            success: false,
            output_dir: output_dir.to_string_lossy().to_string(),
            page_count,
            error: Some(error),
        }
    }
}

/// Workspace directory bound to the currently focused window.
async fn focused_workspace_path(app: &tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<crate::AppState>();
    let windows = app.webview_windows();
    let window = windows
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .ok_or("No focused window")?;
    let label = window.label().to_string();

    let ws_guard = state.window_workspaces.lock().await;
    ws_guard
        .get(&label)
        .cloned()
        .ok_or_else(|| "No workspace open".to_string())
}

async fn focused_workspace(
    app: &tauri::AppHandle,
) -> Result<(sqlx::SqlitePool, String), String> {
    let ws_path = focused_workspace_path(app).await?;
    let state = app.state::<crate::AppState>();
    let db_guard = state.dbs.lock().await;
    let pool = db_guard
        .get(&ws_path)
        .cloned()
        .ok_or("No database pool")?;
    drop(db_guard);
    Ok((pool, ws_path))
}

/// Themes shipped with the application.
///
/// Packaged builds carry them in the resource directory; a dev run falls back
/// to the `themes/` directory at the repository root.
fn bundled_themes_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = app.path().resource_dir() {
        let packaged = dir.join("themes");
        if packaged.is_dir() {
            return Some(packaged);
        }
    }
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).parent()?.join("themes");
    dev.is_dir().then_some(dev)
}

#[tauri::command]
pub async fn list_theme_options(
    app: tauri::AppHandle,
    project_type: String,
) -> Result<Vec<ThemeOption>, String> {
    let target_type = ProjectType::from_str(&project_type)?;
    let ws_path = focused_workspace_path(&app).await?;
    let bundled = bundled_themes_root(&app);

    Ok(ThemeRoots::new(Path::new(&ws_path), bundled.as_deref(), target_type).list())
}

#[tauri::command]
pub async fn export_project_zola(
    app: tauri::AppHandle,
    project_type: String,
    theme_name: String,
) -> Result<ExportDonePayload, String> {
    let target = ExportTarget::new(ProjectType::from_str(&project_type)?, theme_name);

    let (pool, ws_path_str) = focused_workspace(&app).await?;
    let workspace_path = PathBuf::from(&ws_path_str);
    let output_dir = workspace_path.join(".app").join("export");

    tracing::info!(
        workspace = %ws_path_str,
        project_type = target.project_type.slug(),
        theme = %target.theme,
        "starting export",
    );

    let cfg = config::get_or_create_config(&workspace_path, &pool).await?;
    let docs = discover::discover_docs(&workspace_path, &pool, &cfg).await?;

    if docs.is_empty() {
        return Err("No documents found to export.".to_string());
    }

    let ctx = normalize::build_context(&docs, &cfg);
    let page_count = ctx.pages.len();

    // Rebuilt from scratch so deleted documents cannot linger in the output.
    let content_dir = output_dir.join("content");
    if content_dir.exists() {
        std::fs::remove_dir_all(&content_dir)
            .map_err(|e| format!("Failed to clear previous export: {e}"))?;
    }

    let bundled = bundled_themes_root(&app);
    site::ensure_zola_project(
        &output_dir,
        &ctx,
        &target,
        &workspace_path,
        bundled.as_deref(),
    )?;

    if let Err(e) = zola::run_build(&app, &output_dir).await {
        tracing::error!(error = %e, "zola build failed");
        return Ok(ExportDonePayload::failed(
            &output_dir,
            page_count,
            format!("Content was written, but the site build failed: {e}"),
        ));
    }

    zola::kill_existing();
    zola::start_server(&app, &output_dir);

    tracing::info!(pages = page_count, "export complete");

    Ok(ExportDonePayload {
        success: true,
        output_dir: output_dir.to_string_lossy().to_string(),
        page_count,
        error: None,
    })
}
