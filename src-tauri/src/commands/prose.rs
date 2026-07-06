use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{Manager, Window, path::BaseDirectory};
use tokio::io::AsyncWriteExt;
use tokio::process::Command as TokioCommand;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all(deserialize = "PascalCase", serialize = "camelCase"))]
pub struct ValeAlert {
    pub line: usize,
    pub span: [usize; 2],
    pub message: String,
    pub description: String,
    pub severity: String,
    #[serde(rename(deserialize = "Match", serialize = "match"))]
    pub r#match: String,
    #[serde(rename(deserialize = "Check", serialize = "rule"))]
    pub rule: String,
    #[serde(
        default,
        rename(deserialize = "Action", serialize = "action"),
        skip_serializing_if = "Option::is_none"
    )]
    pub action: Option<serde_json::Value>,
    #[serde(
        default,
        rename(deserialize = "Link", serialize = "link"),
        skip_serializing_if = "Option::is_none"
    )]
    pub link: Option<String>,
}

pub type ValeResponse = HashMap<String, Vec<ValeAlert>>;

fn resolve_vale_binary(window: &Window) -> Result<PathBuf, String> {
    let platform_dir = match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "windows",
        "linux" => "linux",
        other => return Err(format!("Unsupported platform: {}", other)),
    };
    let platform_bin = match std::env::consts::OS {
        "windows" => "vale.exe",
        _ => "vale",
    };
    let rel_path = format!("bin/{}/{}", platform_dir, platform_bin);

    // 1. Try resolving using Tauri's resource directory (for production/packaged builds)
    if let Ok(path) = window.path().resolve(&rel_path, BaseDirectory::Resource) {
        if path.exists() {
            return Ok(path);
        }
    }

    // 2. Fallback to manual executable directory traversal (failsafe for some development environments)
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe_path
        .parent()
        .ok_or_else(|| "Executable has no parent directory".to_string())?;

    let mut current = exe_dir;
    let bin_path = current.join("bin").join(platform_dir).join(platform_bin);
    if bin_path.exists() {
        return Ok(bin_path);
    }

    for _ in 0..6 {
        current = match current.parent() {
            Some(p) => p,
            None => break,
        };
        let candidate = current.join("bin").join(platform_dir).join(platform_bin);
        if candidate.exists() {
            return Ok(candidate);
        }
        if current.join("Cargo.toml").exists() || current.join("package.json").exists() {
            break;
        }
    }

    Err(format!(
        "Vale binary not found. Searched resource path and exe path fallback from {:?}",
        exe_path
    ))
}

fn resolve_vale_config(window: &Window) -> Result<PathBuf, String> {
    // 1. Try resolving using Tauri's resource directory (for production/packaged builds)
    if let Ok(path) = window.path().resolve("assets/.vale.ini", BaseDirectory::Resource) {
        if path.exists() {
            return Ok(path);
        }
    }

    // 2. Fallback to manual executable directory traversal (failsafe for some development environments)
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe_path
        .parent()
        .ok_or_else(|| "Executable has no parent directory".to_string())?;

    let mut current = exe_dir;
    let config_path = current.join("assets").join(".vale.ini");
    if config_path.exists() {
        return Ok(config_path);
    }

    for _ in 0..6 {
        current = match current.parent() {
            Some(p) => p,
            None => break,
        };
        let candidate = current.join("assets").join(".vale.ini");
        if candidate.exists() {
            return Ok(candidate);
        }
        if current.join("Cargo.toml").exists() || current.join("package.json").exists() {
            break;
        }
    }

    Err(format!(
        "Vale config not found. Searched resource path and exe path fallback from {:?}",
        exe_path
    ))
}

fn copy_clean_vale_styles(source: &Path, dest: &Path) -> Result<(), String> {
    if !source.is_dir() {
        return Err(format!("Vale styles directory not found: {:?}", source));
    }

    if dest.exists() {
        fs::remove_dir_all(dest).map_err(|e| {
            format!("Failed to remove stale Vale runtime styles {:?}: {}", dest, e)
        })?;
    }
    fs::create_dir_all(dest)
        .map_err(|e| format!("Failed to create Vale runtime styles {:?}: {}", dest, e))?;

    fn visit(source_root: &Path, current: &Path, dest_root: &Path) -> Result<(), String> {
        for entry in fs::read_dir(current)
            .map_err(|e| format!("Failed to read Vale styles directory {:?}: {}", current, e))?
        {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let file_type = entry.file_type().map_err(|e| e.to_string())?;

            if file_type.is_dir() {
                visit(source_root, &path, dest_root)?;
                continue;
            }

            if !file_type.is_file() {
                continue;
            }

            let should_copy = match path.extension().and_then(|ext| ext.to_str()) {
                Some("yml") | Some("yaml") => fs::read_to_string(&path)
                    .map(|content| content.trim_start().starts_with("extends:"))
                    .unwrap_or(false),
                Some("json") | Some("txt") => true,
                _ => false,
            };

            if !should_copy {
                continue;
            }

            let relative = path
                .strip_prefix(source_root)
                .map_err(|e| format!("Failed to relativize Vale style path {:?}: {}", path, e))?;
            let dest_path = dest_root.join(relative);
            if let Some(parent) = dest_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create Vale style directory {:?}: {}", parent, e))?;
            }
            fs::copy(&path, &dest_path)
                .map_err(|e| format!("Failed to copy Vale style {:?}: {}", path, e))?;
        }

        Ok(())
    }

    visit(source, source, dest)
}

fn prepare_vale_runtime_config(config_path: &Path) -> Result<PathBuf, String> {
    let assets_dir = config_path
        .parent()
        .ok_or_else(|| "Vale config path has no parent directory".to_string())?;
    let source_styles = assets_dir.join("styles");
    let runtime_root = std::env::temp_dir().join("marktype-vale-runtime");
    let runtime_styles = runtime_root.join("styles");
    let runtime_config = runtime_root.join(".vale.ini");

    fs::create_dir_all(&runtime_root)
        .map_err(|e| format!("Failed to create Vale runtime directory {:?}: {}", runtime_root, e))?;
    copy_clean_vale_styles(&source_styles, &runtime_styles)?;

    let styles_path = runtime_styles.to_string_lossy();
    let config = format!(
        "StylesPath = {}\nMinAlertSeverity = suggestion\n\n[*.md]\nBasedOnStyles = Google, Microsoft, Proselint, Alex, Readability, WriteGood\n",
        styles_path
    );
    fs::write(&runtime_config, config)
        .map_err(|e| format!("Failed to write Vale runtime config {:?}: {}", runtime_config, e))?;

    Ok(runtime_config)
}

#[tauri::command]
pub async fn scan_prose(
    window: Window,
    text: String,
    filename: String,
) -> Result<ValeResponse, String> {
    let vale_path = resolve_vale_binary(&window)?;
    let config_path = prepare_vale_runtime_config(&resolve_vale_config(&window)?)?;

    let config_str = config_path.to_string_lossy().to_string();

    let ext = std::path::Path::new(&filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| format!(".{}", s))
        .unwrap_or_else(|| ".md".to_string());

    let mut child = TokioCommand::new(&vale_path)
        .args([
            "--config",
            &config_str,
            &format!("--ext={}", ext),
            "--path",
            &filename,
            "--output=JSON",
            "--no-exit",
        ])
        .current_dir(
            config_path
                .parent()
                .ok_or_else(|| "Vale runtime config has no parent directory".to_string())?,
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn Vale process: {}", e))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(text.as_bytes())
            .await
            .map_err(|e| format!("Failed to write to Vale stdin: {}", e))?;
    }

    let output = child
        .wait_with_output()
        .await
        .map_err(|e| format!("Failed to wait for Vale output: {}", e))?;

    if !output.status.success() && !output.stderr.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("Vale stderr: {}", stderr));
    }

    if output.stdout.is_empty() {
        return Ok(HashMap::new());
    }

    let parsed: ValeResponse =
        serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    Ok(parsed)
}
