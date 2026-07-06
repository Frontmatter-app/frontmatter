use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::path::Path;
use std::str::FromStr;
use tauri::{Emitter, Manager, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
#[cfg(target_os = "windows")]
use window_vibrancy::apply_mica;

pub fn emit_to_focused_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: &str) {
    if let Some(window) = app
        .webview_windows()
        .values()
        .find(|window| window.is_focused().unwrap_or(false))
    {
        let _ = window.emit(event, ());
    } else {
        let _ = app.emit(event, ());
    }
}

pub async fn init_workspace_db(path: &Path, label: &str, app: &tauri::AppHandle) -> Result<sqlx::SqlitePool, String> {
    let app_dir = path.join(".app");
    if !app_dir.exists() { std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?; }
    let db_path = app_dir.join("project.db");
    if !db_path.exists() { std::fs::File::create(&db_path).map_err(|e| e.to_string())?; }

    let db_url = format!("sqlite:{}", db_path.to_string_lossy());
    let conn_options = SqliteConnectOptions::from_str(&db_url).map_err(|e| e.to_string())?;
    let pool = SqlitePoolOptions::new().max_connections(5)
        .connect_with(conn_options).await.map_err(|e| e.to_string())?;

    crate::schema::migrate_database(&pool).await.map_err(|e| e.to_string())?;

    let state = app.state::<crate::AppState>();
    state.dbs.lock().await.insert(path.to_string_lossy().to_string(), pool.clone());
    state.window_workspaces.lock().await.insert(label.to_string(), path.to_string_lossy().to_string());

    Ok(pool)
}

pub fn build_window(app: &tauri::AppHandle, label: &str, url: WebviewUrl) -> Result<tauri::WebviewWindow, String> {
    let (win_width, win_height) = crate::commands::window::get_current_window_size(app);
    let builder = WebviewWindowBuilder::new(app, label, url)
        .title("").inner_size(win_width, win_height);

    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(TitleBarStyle::Overlay);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.decorations(false);

    let win = builder.build().map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    { let _ = apply_vibrancy(&win, NSVisualEffectMaterial::HudWindow, None, None); }
    #[cfg(target_os = "windows")]
    { let _ = apply_mica(&win, None); }

    Ok(win)
}

#[allow(dead_code)]
pub fn build_window_with_data_dir(
    app: &tauri::AppHandle, label: &str, url: WebviewUrl, data_dir: std::path::PathBuf,
) -> Result<tauri::WebviewWindow, String> {
    let (win_width, win_height) = crate::commands::window::get_current_window_size(app);
    let builder = WebviewWindowBuilder::new(app, label, url)
        .title("").inner_size(win_width, win_height).data_directory(data_dir);

    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(TitleBarStyle::Overlay);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.decorations(false);

    let win = builder.build().map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    { let _ = apply_vibrancy(&win, NSVisualEffectMaterial::HudWindow, None, None); }
    #[cfg(target_os = "windows")]
    { let _ = apply_mica(&win, None); }

    Ok(win)
}

pub async fn open_folder_in_new_window(
    app: &tauri::AppHandle,
    path: std::path::PathBuf,
) -> Result<(), String> {
    let label = format!("win_{}", uuid::Uuid::new_v4().simple());

    let _pool = init_workspace_db(&path, &label, app).await?;
    crate::watcher::start_workspace_watcher(app.clone(), path.clone());

    let path_clone = path.clone();
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        let state = app_handle.state::<crate::AppState>();
        let db_guard = state.dbs.lock().await;
        if let Some(pool) = db_guard.get(&path_clone.to_string_lossy().to_string()) {
            let pool = pool.clone();
            drop(db_guard);
            let indexer = crate::commands::indexer::WorkspaceIndexer::new(pool, path_clone);
            let _ = indexer.index_workspace().await;
        }
    });

    let _win = build_window(app, &label, WebviewUrl::App("index.html".into()))?;
    Ok(())
}

pub async fn open_default_window(app: &tauri::AppHandle) -> Result<(), String> {
    let default_path =
        crate::commands::workspace::default_local_folder_for_context_json(Some(r#"{"type":"personal"}"#))?;
    open_folder_in_new_window(app, default_path).await
}
