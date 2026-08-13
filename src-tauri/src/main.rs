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

pub struct AppState {
    pub dbs: Mutex<HashMap<String, sqlx::SqlitePool>>,
    pub window_workspaces: Mutex<HashMap<String, String>>,
    pub pending_imports: Mutex<HashMap<String, PendingImport>>,
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let bundle = menu::create_menu(app.handle())?;
            app.set_menu(bundle.menu)?;
            app.manage(AutoSaveCheckItem(Mutex::new(bundle.auto_save_item)));

            app.manage(AppState {
                dbs: Mutex::new(HashMap::new()),
                window_workspaces: Mutex::new(HashMap::new()),
                pending_imports: Mutex::new(HashMap::new()),
            });

            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app.webview_windows().values().next() {
                    let _ = window.set_title_bar_style(TitleBarStyle::Overlay);
                }
            }

            Ok(())
        })
        .on_menu_event(menu_events::handle)
        .invoke_handler(app_command_handlers!())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
