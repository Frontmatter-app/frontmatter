#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod menu;
mod schema;
mod watcher;
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
        .on_menu_event(|app, event| {
            let id = event.id.as_ref();

            if let Some(index) = id.strip_prefix("open_recent_") {
                if let Ok(i) = index.parse::<usize>() {
                    let items = crate::menu::load_recent_projects();
                    if let Some(path) = items.get(i) {
                        let app_handle = app.clone();
                        let p = path.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = window_ops::open_folder_in_new_window(&app_handle, std::path::PathBuf::from(&p)).await;
                        });
                    }
                }
                return;
            }

            match id {
                "new_file" => window_ops::emit_to_focused_window(app, "menu-new-file"),
                "new_folder" => window_ops::emit_to_focused_window(app, "menu-new-folder"),
                "open_file" => window_ops::emit_to_focused_window(app, "menu-open-file"),
                "open_folder" => window_ops::emit_to_focused_window(app, "menu-open-folder"),
                "save_file" => window_ops::emit_to_focused_window(app, "menu-save"),
                "save_as" => window_ops::emit_to_focused_window(app, "menu-save-as"),
                "toggle_auto_save" => {
                    window_ops::emit_to_focused_window(app, "menu-toggle-auto-save");
                }
                "clone_repository" => window_ops::emit_to_focused_window(app, "menu-clone-repository"),
                "clear_recent" => {
                    let _ = commands::project::clear_recent_projects();
                }
                "new_window" => {
                    let app_handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = window_ops::open_default_window(&app_handle).await;
                    });
                }
                "settings" => window_ops::emit_to_focused_window(app, "menu-settings"),
                "reload" => {
                    for window in app.webview_windows().values() {
                        let _ = window.reload();
                    }
                }
                "force_reload" => {
                    for window in app.webview_windows().values() {
                        let _ = window.eval("window.location.reload(true)");
                    }
                }
                "toggle_devtools" => {
                    for window in app.webview_windows().values() {
                        if window.is_devtools_open() {
                            let _ = window.close_devtools();
                        } else {
                            let _ = window.open_devtools();
                        }
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::workspace::get_default_workspace,
            commands::workspace::get_last_workspace,
            commands::workspace::save_last_workspace,
            commands::workspace::get_window_workspace,
            commands::workspace::get_pending_import,
            commands::workspace::get_documents,
            commands::workspace::open_workspace,
            commands::workspace_tree::get_directory_tree,
            commands::documents::create_document,
            commands::documents::update_document,
            commands::documents::get_document,
            commands::documents::delete_document,
            commands::dialogs::open_external_file,
            commands::dialogs::pick_save_path,
            commands::file_ops::open_or_import_file,
            commands::file_ops::create_file_on_disk,
            commands::file_ops::create_directory_on_disk,
            commands::file_ops::delete_file_or_dir_on_disk,
            commands::file_ops::move_or_rename_on_disk,
            commands::file_ops::reveal_in_folder,
            commands::documents::update_document_path,
            commands::dialogs::show_unsaved_dialog,
            commands::cloud_sync::set_cloud_sync,
            commands::cloud_sync::clear_cloud_sync,
            commands::cloud_sync::set_offline_enabled,
            commands::snapshots::save_snapshot,
            commands::snapshots::get_snapshots,
            commands::snapshots::get_snapshot_data,
            commands::snapshots::delete_snapshot,
            commands::snapshots::clear_document_history,
            commands::snapshots::create_snapshot,
            commands::annotations::save_annotation,
            commands::annotations::resolve_annotation,
            commands::annotations::get_annotations,
            commands::drafts::sync_draft_nodes,
            commands::metrics::get_metrics_date_range,
            commands::metrics::save_daily_metrics,
            commands::new_window::open_file_in_new_window_command,
            commands::new_window::open_account_window,
            commands::new_window::start_google_auth,
            commands::window::open_browser_url,
            commands::window::open_folder_in_new_window_from_path,
            commands::dialogs::show_confirm_dialog,
            commands::dialogs::show_alert_dialog,
            commands::window::minimize_window,
            commands::window::maximize_window,
            commands::window::restore_window,
            commands::window::close_window,
            commands::window::get_window_state,
            commands::fonts::get_system_fonts,
            commands::prose::scan_prose,
            commands::indexer::index_workspace,
            commands::indexer::index_file,
            commands::references::search_objects,
            commands::references::find_references,
            commands::references::rename_object,
            commands::references::get_object_by_uuid,
            commands::references::get_references_for_document,
            commands::references::set_transclusion_hash,
            commands::references::get_transclusion_hash,
            commands::execution::execute_block,
            commands::execution::get_outputs,
            commands::runtimes::list_runtimes,
            commands::runtimes::add_runtime,
            commands::runtimes::remove_runtime,
            commands::runtimes::set_default_runtime,
            commands::git::git_is_available,
            commands::git::git_is_repo,
            commands::git::git_init,
            commands::git::git_status,
            commands::git::git_add,
            commands::git::git_unstage,
            commands::git::git_commit,
            commands::git::git_push,
            commands::git::git_pull,
            commands::git::git_log,
            commands::git::git_branches,
            commands::git::git_current_branch,
            commands::git::git_checkout,
            commands::git::git_create_branch,
            commands::git::git_has_remote_changes,
            commands::git::git_has_remote,
            commands::git::git_read_gitignore,
            commands::git::git_write_gitignore,
            commands::git::git_show_file,
            commands::git::git_add_remote,
            commands::git::git_get_remote_url,
            commands::git_clone::git_clone,
            commands::dialogs::pick_folder,
            commands::project::save_as_document,
            commands::project::get_auto_save,
            commands::project::set_auto_save,
            commands::project::get_recent_projects,
            commands::project::add_recent_project,
            commands::project::clear_recent_projects,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
