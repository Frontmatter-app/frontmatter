use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Serialize)]
pub struct GitStatusEntry { pub path: String, pub staged: bool, pub status: String, }

#[derive(Debug, Serialize)]
pub struct GitStatus { pub branch: String, pub ahead: u32, pub behind: u32, pub dirty: bool, pub entries: Vec<GitStatusEntry>, }

// The history panel reads `shortHash`; without this rename serde emits
// `short_hash` and the abbreviated hash silently never renders.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit { pub hash: String, pub short_hash: String, pub message: String, pub author: String, pub date: String, }

#[derive(Debug, Serialize)]
pub struct GitBranch { pub name: String, pub current: bool, }

fn run_git(args: &[&str], cwd: &str) -> Result<String, String> {
    let output = Command::new("git").args(args).current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0").output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub async fn git_is_available() -> Result<bool, String> {
    Ok(run_git(&["--version"], ".").is_ok())
}

#[tauri::command]
pub async fn git_is_repo(path: String) -> Result<bool, String> {
    Ok(run_git(&["rev-parse", "--is-inside-work-tree"], &path).is_ok())
}

#[tauri::command]
pub async fn git_init(path: String) -> Result<(), String> {
    run_git(&["init"], &path)?;
    let gitignore_path = Path::new(&path).join(".gitignore");
    if !gitignore_path.exists() {
        let content = ".DS_Store\n*.app\nnode_modules/\n";
        std::fs::write(&gitignore_path, content).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn git_status(path: String) -> Result<GitStatus, String> {
    let raw = run_git(&["status", "--porcelain", "-b"], &path)?;
    let mut entries = Vec::new();
    let mut branch = String::new();
    let mut ahead = 0u32;
    let mut behind = 0u32;
    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            let parts: Vec<&str> = rest.split(',').collect();
            let branch_raw = parts[0].split('.').next().unwrap_or("").to_string();
            branch = branch_raw.strip_prefix("No commits yet on ").unwrap_or(&branch_raw).to_string();
            for p in parts.iter().skip(1) {
                let p = p.trim();
                if let Some(a) = p.strip_prefix("ahead ") { ahead = a.parse().unwrap_or(0); }
                if let Some(b) = p.strip_prefix("behind ") { behind = b.parse().unwrap_or(0); }
            }
            continue;
        }
        if line.len() >= 4 {
            let status_x = &line[0..1];
            let status_y = &line[1..2];
            let file_path = line[3..].to_string();
            if status_x != " " && status_x != "?" {
                entries.push(GitStatusEntry { path: file_path.clone(), staged: true, status: format!("{}{}", status_x, status_y) });
            } else {
                entries.push(GitStatusEntry { path: file_path, staged: false, status: status_y.to_string() });
            }
        }
    }
    Ok(GitStatus { branch, ahead, behind, dirty: !entries.is_empty(), entries })
}

#[tauri::command]
pub async fn git_add(path: String, files: Vec<String>) -> Result<(), String> {
    if files.is_empty() {
        run_git(&["add", "-A"], &path)?;
    } else {
        for f in files { run_git(&["add", &f], &path)?; }
    }
    Ok(())
}

#[tauri::command]
pub async fn git_unstage(path: String, files: Vec<String>) -> Result<(), String> {
    if files.is_empty() {
        if run_git(&["restore", "--staged", "."], &path).is_err() {
            run_git(&["rm", "--cached", "-r", "."], &path)?;
        }
    } else {
        for f in files {
            if run_git(&["restore", "--staged", &f], &path).is_err() {
                run_git(&["rm", "--cached", "-r", &f], &path)?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn git_commit(path: String, message: String) -> Result<String, String> {
    let output = run_git(&["commit", "-m", &message], &path)?;
    Ok(output.lines().last().unwrap_or("").to_string())
}

#[tauri::command]
pub async fn git_push(path: String) -> Result<(), String> {
    run_git(&["push"], &path)?;
    Ok(())
}

#[tauri::command]
pub async fn git_pull(path: String) -> Result<(), String> {
    run_git(&["pull"], &path)?;
    Ok(())
}

#[tauri::command]
pub async fn git_log(path: String, file_path: Option<String>) -> Result<Vec<GitCommit>, String> {
    let mut args = vec!["log", "--format=%H|%h|%s|%an|%ai", "--date=short"];
    if let Some(ref f) = file_path { args.push("--"); args.push(f); }
    let raw = match run_git(&args, &path) {
        Ok(out) => out,
        Err(_) => return Ok(vec![]),
    };
    let mut commits = Vec::new();
    for line in raw.lines() {
        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() >= 5 {
            commits.push(GitCommit {
                hash: parts[0].to_string(),
                short_hash: parts[1].to_string(),
                message: parts[2].to_string(),
                author: parts[3].to_string(),
                date: parts[4].to_string(),
            });
        }
    }
    Ok(commits)
}

#[tauri::command]
pub async fn git_branches(path: String) -> Result<Vec<GitBranch>, String> {
    let raw = run_git(&["branch", "--list"], &path)?;
    let mut branches = Vec::new();
    for line in raw.lines() {
        let name = line.trim_start_matches("* ").trim().to_string();
        branches.push(GitBranch { name, current: line.starts_with("*") });
    }
    Ok(branches)
}

#[tauri::command]
pub async fn git_current_branch(path: String) -> Result<String, String> {
    let out = match run_git(&["rev-parse", "--abbrev-ref", "HEAD"], &path) {
        Ok(out) => out.trim().to_string(),
        Err(_) => return Ok("main".to_string()),
    };
    Ok(out)
}

#[tauri::command]
pub async fn git_checkout(path: String, branch: String) -> Result<(), String> {
    run_git(&["checkout", &branch], &path)?;
    Ok(())
}

#[tauri::command]
pub async fn git_create_branch(path: String, name: String) -> Result<(), String> {
    run_git(&["branch", &name], &path)?;
    Ok(())
}

#[tauri::command]
pub async fn git_has_remote_changes(path: String) -> Result<bool, String> {
    let result = run_git(&["fetch"], &path);
    if result.is_err() { return Ok(false); }
    let local = match run_git(&["rev-parse", "@"], &path) {
        Ok(out) => out.trim().to_string(),
        Err(_) => return Ok(false),
    };
    let remote = run_git(&["rev-parse", "@{u}"], &path);
    Ok(remote.map(|r| r.trim() != local).unwrap_or(false))
}

#[tauri::command]
pub async fn git_has_remote(path: String) -> Result<bool, String> {
    let out = run_git(&["remote"], &path)?;
    Ok(!out.trim().is_empty())
}

#[tauri::command]
pub async fn git_read_gitignore(path: String) -> Result<Vec<String>, String> {
    let ignore_path = std::path::Path::new(&path).join(".gitignore");
    if !ignore_path.exists() { return Ok(vec![]); }
    let content = std::fs::read_to_string(&ignore_path).map_err(|e| e.to_string())?;
    Ok(content.lines().map(|l| l.to_string()).collect())
}

#[tauri::command]
pub async fn git_write_gitignore(path: String, patterns: Vec<String>) -> Result<(), String> {
    let ignore_path = std::path::Path::new(&path).join(".gitignore");
    std::fs::write(&ignore_path, patterns.join("\n") + "\n").map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn git_show_file(path: String, commit: String, file_path: String) -> Result<String, String> {
    run_git(&["show", &format!("{}:{}", commit, file_path)], &path)
}

#[tauri::command]
pub async fn git_add_remote(path: String, name: String, url: String) -> Result<(), String> {
    run_git(&["remote", "add", &name, &url], &path)?; Ok(())
}

#[tauri::command]
pub async fn git_get_remote_url(path: String) -> Result<String, String> {
    Ok(run_git(&["remote", "get-url", "origin"], &path).unwrap_or_default().trim().to_string())
}
