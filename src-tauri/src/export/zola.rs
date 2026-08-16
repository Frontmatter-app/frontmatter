use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::net::TcpListener;
use std::path::Path;
use std::process::Child;
use std::sync::Mutex;
use tauri::Manager;

/// Preview servers, keyed by the output directory they serve.
///
/// This used to be `killall zola`, which took down every other workspace's
/// preview — and any zola the user was running themselves — on each publish.
static SERVERS: Lazy<Mutex<HashMap<String, Child>>> = Lazy::new(|| Mutex::new(HashMap::new()));

fn zola_binary(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let bin_name = if cfg!(target_os = "windows") { "zola.exe" } else { "zola" };
    Ok(resource_dir.join("binaries").join(bin_name))
}

pub async fn run_build(app: &tauri::AppHandle, output_dir: &Path) -> Result<(), String> {
    let zola_bin = zola_binary(app)?;

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

/// Serves `output_dir` and returns the URL it is reachable at.
///
/// A previous server for the same directory is stopped first so republishing
/// does not leave orphaned processes holding ports.
pub fn start_server(app: &tauri::AppHandle, output_dir: &Path) -> Option<String> {
    let zola_bin = zola_binary(app).ok()?;
    if !zola_bin.exists() {
        return None;
    }

    stop_server(output_dir);

    // An explicit port lets several workspaces preview at once and gives the
    // UI a URL to link to; zola's default 1111 would collide.
    let port = free_port()?;

    let child = std::process::Command::new(&zola_bin)
        .args([
            "serve",
            "--open",
            "--interface",
            "127.0.0.1",
            "--port",
            &port.to_string(),
        ])
        .current_dir(output_dir)
        .spawn()
        .ok()?;

    if let Ok(mut servers) = SERVERS.lock() {
        servers.insert(output_dir.to_string_lossy().to_string(), child);
    }

    Some(format!("http://127.0.0.1:{port}"))
}

/// Stops the preview for one output directory, if this app started it.
pub fn stop_server(output_dir: &Path) {
    let key = output_dir.to_string_lossy().to_string();
    let Ok(mut servers) = SERVERS.lock() else { return };
    if let Some(mut child) = servers.remove(&key) {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Asks the OS for an unused port by binding to 0 and reading back the
/// assignment. The port is released before zola claims it, so a collision is
/// possible in principle but needs another process to win the gap.
fn free_port() -> Option<u16> {
    TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|l| l.local_addr().ok())
        .map(|addr| addr.port())
}
