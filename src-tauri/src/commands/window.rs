use tauri::{Manager, Window};

#[tauri::command]
pub fn minimize_window(window: Window) { let _ = window.minimize(); }

#[tauri::command]
pub fn maximize_window(window: Window) { let _ = window.maximize(); }

#[tauri::command]
pub fn restore_window(window: Window) { let _ = window.unmaximize(); }

#[tauri::command]
pub fn close_window(window: Window) { let _ = window.close(); }

#[tauri::command]
pub fn get_window_state(window: Window) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}

pub fn get_current_window_size(app: &tauri::AppHandle) -> (f64, f64) {
    let default_width = 1200.0;
    let default_height = 900.0;

    if let Some(window) = app.webview_windows().values().next() {
        if let Ok(true) = window.is_maximized() {
            return (default_width, default_height);
        }
        if let Ok(size) = window.inner_size() {
            let w = size.width as f64;
            let h = size.height as f64;
            if w > 200.0 && h > 200.0 && w < 4000.0 && h < 4000.0 {
                return (w.min(default_width), h.min(default_height));
            }
        }
    }
    (default_width, default_height)
}

#[tauri::command]
pub fn open_browser_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")] { std::process::Command::new("open").arg(&url).spawn().map_err(|e| e.to_string())?; }
    #[cfg(target_os = "windows")] { std::process::Command::new("cmd").args(&["/C", "start", &url]).spawn().map_err(|e| e.to_string())?; }
    #[cfg(target_os = "linux")] { std::process::Command::new("xdg-open").arg(&url).spawn().map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
pub async fn open_folder_in_new_window_from_path(
    app: tauri::AppHandle,
    path: String,
) -> Result<(), String> {
    crate::window_ops::open_folder_in_new_window(&app, std::path::PathBuf::from(&path)).await
}


