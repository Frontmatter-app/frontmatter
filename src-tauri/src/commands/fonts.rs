use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

#[tauri::command]
pub fn get_system_fonts() -> Vec<String> {
    let mut fonts: HashSet<String> = HashSet::new();

    for dir in font_dirs() {
        collect_fonts_from_dir(&dir, &mut fonts);
    }

    let mut result: Vec<String> = fonts.into_iter().collect();
    result.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));

    if result.is_empty() {
        // Absolute last resort – should never be reached
        result.push("Inter".to_string());
        result.push("Georgia".to_string());
        result.push("Helvetica".to_string());
        result.push("Courier New".to_string());
    }

    result
}

/// Returns the platform-specific directories that contain font files.
fn font_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    #[cfg(target_os = "macos")]
    {
        dirs.push(PathBuf::from("/System/Library/Fonts"));
        dirs.push(PathBuf::from("/Library/Fonts"));
        // User fonts
        if let Some(home) = dirs::home_dir() {
            dirs.push(home.join("Library/Fonts"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        // System fonts
        if let Ok(windir) = std::env::var("WINDIR") {
            dirs.push(PathBuf::from(format!("{}\\Fonts", windir)));
        } else {
            dirs.push(PathBuf::from("C:\\Windows\\Fonts"));
        }
        // Per-user fonts (Windows 10+)
        if let Some(home) = dirs::home_dir() {
            dirs.push(home.join("AppData\\Local\\Microsoft\\Windows\\Fonts"));
        }
    }

    #[cfg(target_os = "linux")]
    {
        dirs.push(PathBuf::from("/usr/share/fonts"));
        dirs.push(PathBuf::from("/usr/local/share/fonts"));
        if let Some(home) = dirs::home_dir() {
            dirs.push(home.join(".fonts"));
            dirs.push(home.join(".local/share/fonts"));
        }
    }

    dirs
}

/// Recursively walks a directory and inserts cleaned font names into `out`.
fn collect_fonts_from_dir(dir: &PathBuf, out: &mut HashSet<String>) {
    if !dir.exists() || !dir.is_dir() {
        return;
    }

    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();

        if path.is_dir() {
            // Recurse into subdirectories (common on Linux/Windows)
            collect_fonts_from_dir(&path, out);
            continue;
        }

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if matches!(ext.as_str(), "ttf" | "otf" | "ttc" | "woff" | "woff2") {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                let name = clean_font_name(stem);
                if !name.is_empty() {
                    out.insert(name);
                }
            }
        }
    }
}

/// Cleans a raw filename stem into a human-readable font family name.
/// e.g. "arial-bold_italic" → "Arial Bold Italic"
fn clean_font_name(stem: &str) -> String {
    let name = stem.replace('-', " ").replace('_', " ");

    let mut result = String::with_capacity(name.len());
    let mut capitalize_next = true;

    for ch in name.chars() {
        if ch.is_whitespace() {
            result.push(ch);
            capitalize_next = true;
        } else if capitalize_next {
            result.push(ch.to_ascii_uppercase());
            capitalize_next = false;
        } else {
            result.push(ch);
        }
    }

    result.trim().to_string()
}
