//! Routing for native menu selections.
//!
//! Most items simply forward an event to the focused window; the rest are
//! handled here. Previously this lived inline in `main.rs`.

use crate::{commands, menu, window_ops};
use tauri::{Emitter, Manager};

/// Menu ids that do nothing but notify the focused window.
const FORWARDED: &[(&str, &str)] = &[
    ("new_file", "menu-new-file"),
    ("new_folder", "menu-new-folder"),
    ("open_file", "menu-open-file"),
    ("open_folder", "menu-open-folder"),
    ("save_file", "menu-save"),
    ("save_as", "menu-save-as"),
    ("toggle_auto_save", "menu-toggle-auto-save"),
    ("clone_repository", "menu-clone-repository"),
    ("export_file_pdf", "menu-export-file-pdf"),
    ("export_file_html", "menu-export-file-html"),
    ("export_file_markdown", "menu-export-file-markdown"),
    ("settings", "menu-settings"),
];

/// Menu ids of the form `export_project_<type>`; the suffix is the project type.
const EXPORT_PROJECT_PREFIX: &str = "export_project_";

/// Menu ids of the form `open_recent_<index>` into the recent-projects list.
const OPEN_RECENT_PREFIX: &str = "open_recent_";

fn emit_to_focused<P: serde::Serialize + Clone>(app: &tauri::AppHandle, event: &str, payload: P) {
    match app
        .webview_windows()
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
    {
        Some(window) => {
            let _ = window.emit(event, payload);
        }
        None => {
            let _ = app.emit(event, payload);
        }
    }
}

fn open_recent(app: &tauri::AppHandle, index: &str) {
    let Ok(i) = index.parse::<usize>() else { return };
    let items = menu::load_recent_projects();
    let Some(path) = items.get(i).cloned() else { return };

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ =
            window_ops::open_folder_in_new_window(&app_handle, std::path::PathBuf::from(&path))
                .await;
    });
}

pub fn handle(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id.as_ref();

    if let Some(index) = id.strip_prefix(OPEN_RECENT_PREFIX) {
        open_recent(app, index);
        return;
    }

    if let Some(project_type) = id.strip_prefix(EXPORT_PROJECT_PREFIX) {
        emit_to_focused(app, "menu-export-project", project_type.to_string());
        return;
    }

    if let Some((_, forwarded)) = FORWARDED.iter().find(|(menu_id, _)| *menu_id == id) {
        window_ops::emit_to_focused_window(app, forwarded);
        return;
    }

    match id {
        "clear_recent" => {
            let _ = commands::project::clear_recent_projects();
        }
        "new_window" => {
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = window_ops::open_default_window(&app_handle).await;
            });
        }
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
                    window.close_devtools();
                } else {
                    window.open_devtools();
                }
            }
        }
        _ => {}
    }
}
