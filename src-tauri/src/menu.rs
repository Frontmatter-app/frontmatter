use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Runtime;

pub struct MenuBundle<R: Runtime> {
    pub menu: Menu<R>,
    pub auto_save_item: CheckMenuItem<R>,
}

/// Builds the application menu.
///
/// Organised the way a desktop writing app is expected to be: File owns the
/// document lifecycle including export, Format carries the commands that were
/// previously only reachable by shortcut, and View owns the workflow stages and
/// panels. Developer commands (reload, devtools) are compiled out of release
/// builds rather than shipped to users.
pub fn create_menu<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<MenuBundle<R>> {
    let separator = || PredefinedMenuItem::separator(app);

    // ---------------------------------------------------------------- app
    #[cfg(target_os = "macos")]
    let app_menu = Submenu::with_items(
        app,
        "MarkType",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &MenuItem::with_id(app, "check_updates", "Check for Updates...", true, None::<&str>)?,
            &separator()?,
            &MenuItem::with_id(app, "settings", "Settings...", true, Some("CmdOrCtrl+,"))?,
            &separator()?,
            &PredefinedMenuItem::services(app, None)?,
            &separator()?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &separator()?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    // --------------------------------------------------------------- file
    let recent_submenu = build_recent_submenu(app)?;
    let auto_save_item = CheckMenuItem::with_id(
        app,
        "toggle_auto_save",
        "Auto Save",
        true,
        false,
        Some("CmdOrCtrl+Alt+S"),
    )?;

    // Export lives under File rather than as a top-level menu: it acts on the
    // open document, which is what File is for.
    let export_file_menu = Submenu::with_items(
        app,
        "Export",
        true,
        &[
            &MenuItem::with_id(app, "export_file_pdf", "PDF...", true, Some("CmdOrCtrl+Shift+P"))?,
            &MenuItem::with_id(app, "export_file_html", "HTML...", true, None::<&str>)?,
            &separator()?,
            &MenuItem::with_id(app, "export_file_markdown", "Copy as Markdown", true, Some("CmdOrCtrl+Shift+C"))?,
        ],
    )?;

    let publish_menu = Submenu::with_items(
        app,
        "Publish Project",
        true,
        &[
            &MenuItem::with_id(app, "export_project_docs", "As Documentation Site...", true, None::<&str>)?,
            &MenuItem::with_id(app, "export_project_blog", "As Blog...", true, None::<&str>)?,
            &MenuItem::with_id(app, "export_project_book", "As Book...", true, None::<&str>)?,
            &MenuItem::with_id(app, "export_project_slide", "As Slide Deck...", true, None::<&str>)?,
        ],
    )?;

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "new_file", "New File", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "new_folder", "New Folder", true, Some("CmdOrCtrl+Shift+N"))?,
            &MenuItem::with_id(app, "new_window", "New Window", true, Some("CmdOrCtrl+Alt+N"))?,
            &separator()?,
            &MenuItem::with_id(app, "open_file", "Open File...", true, Some("CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "open_folder", "Open Folder...", true, Some("CmdOrCtrl+Shift+O"))?,
            &recent_submenu,
            &MenuItem::with_id(app, "clone_repository", "Clone from Git...", true, Some("CmdOrCtrl+Shift+G"))?,
            &separator()?,
            &MenuItem::with_id(app, "save_file", "Save", true, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(app, "save_as", "Save As...", true, Some("CmdOrCtrl+Shift+S"))?,
            &auto_save_item,
            &separator()?,
            &export_file_menu,
            &publish_menu,
            &separator()?,
            &PredefinedMenuItem::close_window(app, None)?,
            #[cfg(not(target_os = "macos"))]
            &separator()?,
            #[cfg(not(target_os = "macos"))]
            &MenuItem::with_id(app, "settings", "Settings...", true, Some("CmdOrCtrl+,"))?,
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    // --------------------------------------------------------------- edit
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &separator()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
            &separator()?,
            &MenuItem::with_id(app, "find", "Find in Document...", true, Some("CmdOrCtrl+F"))?,
        ],
    )?;

    // ------------------------------------------------------------- format
    // These commands existed only as keyboard shortcuts, so they were
    // undiscoverable to anyone who had not read the shortcuts dialog.
    let format_menu = Submenu::with_items(
        app,
        "Format",
        true,
        &[
            &MenuItem::with_id(app, "format_bold", "Bold", true, Some("CmdOrCtrl+B"))?,
            &MenuItem::with_id(app, "format_italic", "Italic", true, Some("CmdOrCtrl+I"))?,
            &MenuItem::with_id(app, "format_code", "Inline Code", true, Some("CmdOrCtrl+E"))?,
            &separator()?,
            &MenuItem::with_id(app, "format_link", "Insert Link...", true, Some("CmdOrCtrl+K"))?,
            &MenuItem::with_id(app, "open_whiteboard", "Insert Whiteboard...", true, Some("CmdOrCtrl+Shift+E"))?,
        ],
    )?;

    // --------------------------------------------------------------- view
    #[cfg(debug_assertions)]
    let developer_menu = Submenu::with_items(
        app,
        "Developer",
        true,
        &[
            &MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?,
            &MenuItem::with_id(app, "force_reload", "Force Reload", true, Some("CmdOrCtrl+Shift+R"))?,
            &MenuItem::with_id(app, "toggle_devtools", "Toggle Developer Tools", true, Some("CmdOrCtrl+Alt+I"))?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(app, "stage_write", "Write", true, Some("CmdOrCtrl+Shift+1"))?,
            &MenuItem::with_id(app, "stage_revise", "Revise", true, Some("CmdOrCtrl+Shift+2"))?,
            &MenuItem::with_id(app, "stage_draft", "Draft", true, Some("CmdOrCtrl+Shift+3"))?,
            &separator()?,
            &MenuItem::with_id(app, "toggle_focus_mode", "Focus Mode", true, Some("CmdOrCtrl+Shift+F"))?,
            &MenuItem::with_id(app, "toggle_left_sidebar", "Show Explorer", true, Some("CmdOrCtrl+1"))?,
            &MenuItem::with_id(app, "toggle_right_sidebar", "Show Inspector", true, Some("CmdOrCtrl+2"))?,
            &separator()?,
            &PredefinedMenuItem::fullscreen(app, None)?,
            #[cfg(debug_assertions)]
            &separator()?,
            #[cfg(debug_assertions)]
            &developer_menu,
        ],
    )?;

    // ----------------------------------------------------------------- go
    let go_menu = Submenu::with_items(
        app,
        "Go",
        true,
        &[
            &MenuItem::with_id(app, "go_prev_section", "Previous Section", true, Some("Alt+Up"))?,
            &MenuItem::with_id(app, "go_next_section", "Next Section", true, Some("Alt+Down"))?,
        ],
    )?;

    // ------------------------------------------------------------- window
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &separator()?,
            &MenuItem::with_id(app, "switch_account", "Switch Account...", true, Some("CmdOrCtrl+Shift+A"))?,
            &MenuItem::with_id(app, "activity_monitor", "Activity Monitor", true, None::<&str>)?,
        ],
    )?;

    // --------------------------------------------------------------- help
    let help_menu = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &MenuItem::with_id(app, "keyboard_shortcuts", "Keyboard Shortcuts", true, Some("CmdOrCtrl+Shift+K"))?,
            &separator()?,
            &MenuItem::with_id(app, "documentation", "Documentation", true, None::<&str>)?,
            &MenuItem::with_id(app, "report_issue", "Report an Issue", true, None::<&str>)?,
            #[cfg(not(target_os = "macos"))]
            &separator()?,
            #[cfg(not(target_os = "macos"))]
            &MenuItem::with_id(app, "check_updates", "Check for Updates...", true, None::<&str>)?,
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::about(app, None, None)?,
        ],
    )?;

    let mut menu_items: Vec<&dyn tauri::menu::IsMenuItem<R>> = Vec::new();
    #[cfg(target_os = "macos")]
    menu_items.push(&app_menu);
    menu_items.push(&file_menu);
    menu_items.push(&edit_menu);
    menu_items.push(&format_menu);
    menu_items.push(&view_menu);
    menu_items.push(&go_menu);
    menu_items.push(&window_menu);
    menu_items.push(&help_menu);

    let menu = Menu::with_items(app, &menu_items)?;
    Ok(MenuBundle { menu, auto_save_item })
}

fn build_recent_submenu<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let items = load_recent_projects();

    if items.is_empty() {
        return Submenu::with_items(
            app,
            "Open Recent",
            true,
            &[&MenuItem::with_id(app, "open_recent_none", "No Recent Projects", false, None::<&str>)?],
        );
    }

    let mut entries: Vec<MenuItem<R>> = Vec::new();
    for (index, name) in items.iter().enumerate() {
        entries.push(MenuItem::with_id(app, &format!("open_recent_{index}"), name, true, None::<&str>)?);
    }

    let separator = PredefinedMenuItem::separator(app)?;
    let clear = MenuItem::with_id(app, "clear_recent", "Clear Menu", true, None::<&str>)?;

    let mut refs: Vec<&dyn tauri::menu::IsMenuItem<R>> =
        entries.iter().map(|m| m as &dyn tauri::menu::IsMenuItem<R>).collect();
    refs.push(&separator);
    refs.push(&clear);
    Submenu::with_items(app, "Open Recent", true, &refs)
}

pub fn load_recent_projects() -> Vec<String> {
    let Some(home) = dirs::home_dir() else { return vec![] };
    let config_path = home.join("MarkType").join(".app").join("recent.json");
    let Ok(content) = std::fs::read_to_string(&config_path) else { return vec![] };
    serde_json::from_str::<Vec<String>>(&content).unwrap_or_default()
}
