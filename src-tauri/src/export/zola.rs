use std::path::Path;
use tauri::Manager;

pub async fn run_build(app: &tauri::AppHandle, output_dir: &Path) -> Result<(), String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let bin_name = if cfg!(target_os = "windows") { "zola.exe" } else { "zola" };
    let zola_bin = resource_dir.join("binaries").join(bin_name);

    if !zola_bin.exists() {
        return Err(format!(
            "zola binary not found at {:?}. Rebuild the app or download zola manually.",
            zola_bin
        ));
    }

    let result = std::process::Command::new(&zola_bin)
        .arg("build")
        .current_dir(output_dir)
        .output()
        .map_err(|e| format!("Failed to run zola: {}", e))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(format!("zola build failed:\n{}", stderr));
    }
    Ok(())
}

pub fn start_server(app: &tauri::AppHandle, output_dir: &Path) {
    let resource_dir = match app.path().resource_dir() {
        Ok(d) => d,
        Err(_) => return,
    };
    let bin_name = if cfg!(target_os = "windows") { "zola.exe" } else { "zola" };
    let zola_bin = resource_dir.join("binaries").join(bin_name);
    if !zola_bin.exists() {
        return;
    }

    let _ = std::process::Command::new(&zola_bin)
        .args(["serve", "--open", "--interface", "127.0.0.1"])
        .current_dir(output_dir)
        .spawn();
}

pub fn kill_existing() {
    #[cfg(target_os = "windows")]
    { let _ = std::process::Command::new("taskkill").args(["/F", "/IM", "zola.exe"]).output(); }
    #[cfg(not(target_os = "windows"))]
    { let _ = std::process::Command::new("killall").arg("zola").output(); }
}
