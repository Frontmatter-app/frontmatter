#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod export;
mod menu;
mod menu_events;
mod schema;
mod watcher;
mod workspace_sync;
mod window_ops;

use std::collections::HashMap;
use tauri::{Manager, TitleBarStyle};
use tokio::sync::Mutex;


#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct PendingImport {
    pub path: String,
    pub name: String,
    pub content: String,
}

pub struct AutoSaveCheckItem(pub Mutex<tauri::menu::CheckMenuItem<tauri::Wry>>);

/// The live "Open Recent" submenu, kept so its entries can be rebuilt in place
/// when the recent list changes. Replacing the whole application menu would
/// orphan the auto-save item that is managed alongside it.
pub struct RecentSubmenu(pub Mutex<tauri::menu::Submenu<tauri::Wry>>);

pub struct AppState {
    pub dbs: Mutex<HashMap<String, sqlx::SqlitePool>>,
    pub window_workspaces: Mutex<HashMap<String, String>>,
    pub pending_imports: Mutex<HashMap<String, PendingImport>>,
    /// One filesystem watcher per workspace path, so switching workspaces can
    /// stop the previous one instead of leaving it running.
    pub watchers: Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>,
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let bundle = menu::create_menu(app.handle())?;
            app.set_menu(bundle.menu)?;
            app.manage(AutoSaveCheckItem(Mutex::new(bundle.auto_save_item)));
            app.manage(RecentSubmenu(Mutex::new(bundle.recent_submenu)));

            app.manage(AppState {
                dbs: Mutex::new(HashMap::new()),
                window_workspaces: Mutex::new(HashMap::new()),
                pending_imports: Mutex::new(HashMap::new()),
                watchers: Mutex::new(HashMap::new()),
            });

            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app.webview_windows().values().next() {
                    let _ = window.set_title_bar_style(TitleBarStyle::Overlay);
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Without this, a closed window left its workspace mapping, its
            // database pool, and its filesystem watcher alive for the rest of
            // the session.
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let app = window.app_handle().clone();
                let label = window.label().to_string();
                tauri::async_runtime::spawn(async move {
                    window_ops::release_window(&app, &label).await;
                });
            }
        })
        .on_menu_event(menu_events::handle)
        .invoke_handler(app_command_handlers!())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
