use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Runtime;

pub struct MenuBundle<R: Runtime> {
    pub menu: Menu<R>,
    pub auto_save_item: CheckMenuItem<R>,
}

pub fn create_menu<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<MenuBundle<R>> {
    #[cfg(target_os = "macos")]
    let app_menu = Submenu::with_items(
        app,
        "MarkType",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "settings", "Settings...", true, Some("CmdOrCtrl+,"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let recent_submenu = build_recent_submenu(app)?;
    let auto_save_item = CheckMenuItem::with_id(app, "toggle_auto_save", "Auto Save", true, false, Some("CmdOrCtrl+Alt+S"))?;

    let export_file_menu = Submenu::with_items(
        app,
        "Export File",
        true,
        &[
            &MenuItem::with_id(app, "export_file_pdf", "Export as PDF...", true, Some("CmdOrCtrl+Shift+P"))?,
            &MenuItem::with_id(app, "export_file_html", "Export as HTML...", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "export_file_markdown", "Copy as Markdown", true, Some("CmdOrCtrl+Shift+C"))?,
        ],
    )?;

    let export_project_menu = Submenu::with_items(
        app,
        "Export Project",
        true,
        &[
            &MenuItem::with_id(app, "export_project_blog", "Export as Blog...", true, None::<&str>)?,
            &MenuItem::with_id(app, "export_project_docs", "Export as Documentation...", true, None::<&str>)?,
            &MenuItem::with_id(app, "export_project_book", "Export as Book...", true, None::<&str>)?,
            &MenuItem::with_id(app, "export_project_slide", "Export as Slide...", true, None::<&str>)?,
        ],
    )?;

    let export_menu = Submenu::with_items(
        app,
        "Export",
        true,
        &[
            &export_file_menu,
            &PredefinedMenuItem::separator(app)?,
            &export_project_menu,
        ],
    )?;

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "new_file", "New File", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "new_folder", "New Folder", true, Some("CmdOrCtrl+Shift+N"))?,
            &MenuItem::with_id(app, "open_file", "Open File...", true, Some("CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "open_folder", "Open Folder...", true, Some("CmdOrCtrl+Shift+O"))?,
            &recent_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "save_file", "Save", true, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(app, "save_as", "Save As...", true, Some("CmdOrCtrl+Shift+S"))?,
            &PredefinedMenuItem::separator(app)?,
            &auto_save_item,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "clone_repository", "New Project from Git...", true, Some("CmdOrCtrl+Shift+G"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "new_window", "New Window", true, Some("CmdOrCtrl+Alt+N"))?,
            &PredefinedMenuItem::close_window(app, None)?,
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::separator(app)?,
            #[cfg(not(target_os = "macos"))]
            &MenuItem::with_id(app, "settings", "Settings...", true, Some("CmdOrCtrl+,"))?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?,
            &MenuItem::with_id(app, "force_reload", "Force Reload", true, Some("CmdOrCtrl+Shift+R"))?,
            &MenuItem::with_id(app, "toggle_devtools", "Toggle Developer Tools", true, Some("CmdOrCtrl+Alt+I"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[&PredefinedMenuItem::minimize(app, None)?],
    )?;

    let help_menu = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::about(app, None, None)?,
        ],
    )?;

    let mut menu_items: Vec<&dyn tauri::menu::IsMenuItem<R>> = Vec::new();
    #[cfg(target_os = "macos")]
    menu_items.push(&app_menu);
    menu_items.push(&file_menu);
    menu_items.push(&edit_menu);
    menu_items.push(&view_menu);
    menu_items.push(&export_menu);
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

    let mut mi: Vec<MenuItem<R>> = Vec::new();
    for (i, name) in items.iter().enumerate() {
        let id = format!("open_recent_{}", i);
        mi.push(MenuItem::with_id(app, &id, name, true, None::<&str>)?);
    }
    let sep = PredefinedMenuItem::separator(app)?;
    let clear = MenuItem::with_id(app, "clear_recent", "Clear Recent Items", true, None::<&str>)?;

    let mut refs: Vec<&dyn tauri::menu::IsMenuItem<R>> = mi.iter().map(|m| m as &dyn tauri::menu::IsMenuItem<R>).collect();
    refs.push(&sep);
    refs.push(&clear);
    Submenu::with_items(app, "Open Recent", true, &refs)
}

pub fn load_recent_projects() -> Vec<String> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return vec![],
    };
    let config_path = home.join("MarkType").join(".app").join("recent.json");
    let content = match std::fs::read_to_string(&config_path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    serde_json::from_str::<Vec<String>>(&content).unwrap_or_default()
}
