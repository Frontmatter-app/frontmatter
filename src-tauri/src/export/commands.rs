use super::{config, discover, normalize, package};
use serde::Serialize;
use std::path::Path;
use tauri::{Emitter, Manager};

#[derive(Clone, Serialize)]
struct ExportStartPayload {
    project_type: String,
}

#[derive(Clone, Serialize)]
struct ExportDonePayload {
    success: bool,
    output_dir: String,
    page_count: usize,
    error: Option<String>,
}

async fn focused_workspace(app: &tauri::AppHandle) -> Result<(sqlx::SqlitePool, String), String> {
    let state = app.state::<crate::AppState>();
    let windows = app.webview_windows();
    let window = windows.values()
        .find(|w| w.is_focused().unwrap_or(false))
        .ok_or("No focused window")?;
    let label = window.label().to_string();
    let ws_guard = state.window_workspaces.lock().await;
    let ws_path = ws_guard.get(&label).ok_or("No workspace open")?.clone();
    drop(ws_guard);
    let db_guard = state.dbs.lock().await;
    let pool = db_guard.get(&ws_path).cloned().ok_or("No database pool")?;
    drop(db_guard);
    Ok((pool, ws_path))
}

fn ensure_zola_project(output_dir: &Path) {
    if !output_dir.join("config.toml").exists() {
        let config = r#"base_url = "/"
title = "Exported Site"
build_search_index = false
default_language = "en"

[extra]
"#;
        let _ = std::fs::write(output_dir.join("config.toml"), config);
    }

    let templates_dir = output_dir.join("templates");
    if !templates_dir.exists() {
        let _ = std::fs::create_dir_all(&templates_dir);
        let index_html = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{{ config.title }}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/water.css@2/out/water.min.css">
</head>
<body>
  <h1>{{ config.title }}</h1>
  {% set manifest = load_data(path="data/manifest.json") %}
  <ul>
  {% for page in manifest.pages %}
    <li><a href="{{ page.html_path }}">{{ page.title | default(value=page.slug) }}</a></li>
  {% endfor %}
  </ul>
</body>
</html>"#;
        let _ = std::fs::write(templates_dir.join("index.html"), index_html);

        let page_html = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{{ page.title }}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/water.css@2/out/water.min.css">
</head>
<body>
  {% set slug = page.components | last %}
  {% set data_path = "data/pages/" ~ slug ~ ".json" %}
  {% set page_data = load_data(path=data_path) %}
  <h1>{{ page_data.title | default(value=page_data.slug) }}</h1>
  {{ page_data.content_markdown | markdown | safe }}
</body>
</html>"#;
        let _ = std::fs::write(templates_dir.join("page.html"), page_html);
    }
}

async fn run_zola_build(app: &tauri::AppHandle, output_dir: &Path) -> Result<(), String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let bin_name = if cfg!(target_os = "windows") { "zola.exe" } else { "zola" };
    let zola_bin = resource_dir.join("binaries").join(bin_name);

    if !zola_bin.exists() {
        return Err(format!(
            "zola binary not found at {:?}. Rebuild the app or download zola manually.",
            zola_bin
        ));
    }

    let result = std::process::Command::new(&zola_bin)
        .arg("build")
        .current_dir(output_dir)
        .output()
        .map_err(|e| format!("Failed to run zola: {}", e))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(format!("zola build failed:\n{}", stderr));
    }
    Ok(())
}

fn open_in_browser(path: &Path) {
    let url = format!("file://{}", path.display());
    #[cfg(target_os = "macos")] {
        let _ = std::process::Command::new("open").arg(&url).spawn();
    }
    #[cfg(target_os = "windows")] {
        let _ = std::process::Command::new("cmd").args(["/C", "start", &url]).spawn();
    }
    #[cfg(target_os = "linux")] {
        let _ = std::process::Command::new("xdg-open").arg(&url).spawn();
    }
}

async fn generate(app: tauri::AppHandle, project_type: String) {
    let _ = app.emit("export-start", ExportStartPayload { project_type: project_type.clone() });

    let (pool, ws_path_str) = match focused_workspace(&app).await {
        Ok(v) => v,
        Err(e) => {
            let _ = app.emit("export-done", ExportDonePayload {
                success: false, output_dir: String::new(), page_count: 0, error: Some(e),
            });
            return;
        }
    };
    let workspace_path = std::path::PathBuf::from(&ws_path_str);

    let cfg = match config::get_or_create_config(&workspace_path, &pool).await {
        Ok(c) => c,
        Err(e) => {
            let _ = app.emit("export-done", ExportDonePayload {
                success: false, output_dir: String::new(), page_count: 0, error: Some(e),
            });
            return;
        }
    };

    let docs = match discover::discover_docs(&pool, &cfg).await {
        Ok(d) => d,
        Err(e) => {
            let _ = app.emit("export-done", ExportDonePayload {
                success: false, output_dir: String::new(), page_count: 0, error: Some(e),
            });
            return;
        }
    };

    if docs.is_empty() {
        let _ = app.emit("export-done", ExportDonePayload {
            success: false, output_dir: String::new(), page_count: 0,
            error: Some("No documents found to export".to_string()),
        });
        return;
    }

    let ctx = normalize::build_context(&docs, &cfg);
    let output_dir = workspace_path.join("export");

    if let Err(e) = package::write_export_data(&ctx, &output_dir).await {
        let _ = app.emit("export-done", ExportDonePayload {
            success: false, output_dir: String::new(), page_count: 0, error: Some(e),
        });
        return;
    }

    ensure_zola_project(&output_dir);

    if let Err(e) = run_zola_build(&app, &output_dir).await {
        let _ = app.emit("export-done", ExportDonePayload {
            success: true,
            output_dir: output_dir.to_string_lossy().to_string(),
            page_count: ctx.pages.len(),
            error: Some(format!("Data exported but zola build failed: {}", e)),
        });
        return;
    }

    let public_dir = output_dir.join("public").join("index.html");
    if public_dir.exists() {
        open_in_browser(&public_dir);
    }

    let _ = app.emit("export-done", ExportDonePayload {
        success: true,
        output_dir: output_dir.to_string_lossy().to_string(),
        page_count: ctx.pages.len(),
        error: None,
    });
}

pub async fn export_project_data(app: tauri::AppHandle, project_type: String) {
    generate(app, project_type).await
}
