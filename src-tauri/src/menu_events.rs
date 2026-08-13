//! Routing for native menu selections.
//!
//! Most items forward an event to the focused window and are handled in the
//! frontend; the rest act on the application directly. `menuCommands.test.ts`
//! reads the table below and fails if the frontend has no handler for a
//! forwarded event, so a menu item cannot ship doing nothing.

use crate::{commands, menu, window_ops};
use tauri::{Emitter, Manager};

const DOCUMENTATION_URL: &str = "https://marktype.app/docs";
const ISSUES_URL: &str = "https://github.com/marktype/marktype/issues/new";

/// Menu ids that only notify the focused window: `(menu id, event name)`.
const FORWARDED: &[(&str, &str)] = &[
    // File
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
    // Edit
    ("find", "menu-find"),
    // Format
    ("format_bold", "menu-format-bold"),
    ("format_italic", "menu-format-italic"),
    ("format_code", "menu-format-code"),
    ("format_link", "menu-format-link"),
    ("open_whiteboard", "menu-open-whiteboard"),
    // View
    ("stage_write", "menu-stage-write"),
    ("stage_revise", "menu-stage-revise"),
    ("stage_draft", "menu-stage-draft"),
    ("toggle_focus_mode", "menu-toggle-focus-mode"),
    ("toggle_left_sidebar", "menu-toggle-left-sidebar"),
    ("toggle_right_sidebar", "menu-toggle-right-sidebar"),
    // Go
    ("go_prev_section", "menu-prev-section"),
    ("go_next_section", "menu-next-section"),
    // Window
    ("switch_account", "menu-switch-account"),
    ("activity_monitor", "menu-activity-monitor"),
    // Help & app
    ("keyboard_shortcuts", "menu-keyboard-shortcuts"),
    ("check_updates", "menu-check-updates"),
    ("settings", "menu-settings"),
];

/// `export_project_<type>`; the suffix is sent as the payload.
const EXPORT_PROJECT_PREFIX: &str = "export_project_";

/// `open_recent_<index>` into the recent-projects list.
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
        "documentation" => open_url(DOCUMENTATION_URL),
        "report_issue" => open_url(ISSUES_URL),
        // Developer commands are only built in debug, so these ids never
        // arrive in a release build.
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

fn open_url(url: &str) {
    if let Err(e) = commands::window::open_browser_url(url.to_string()) {
        tracing::warn!(error = %e, url, "could not open external url");
    }
}
