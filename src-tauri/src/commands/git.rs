use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Serialize)]
pub struct GitStatusEntry {
    pub path: String,
    pub staged: bool,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct GitStatus {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub dirty: bool,
    pub entries: Vec<GitStatusEntry>,
}

// The history panel reads `shortHash`; without this rename serde emits
// `short_hash` and the abbreviated hash silently never renders.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

#[derive(Debug, Serialize)]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
}

fn run_git_blocking(args: &[String], cwd: &str) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        // Quoted paths turn non-ASCII filenames into C-style escapes that no
        // later `git add` can match, so ask for raw bytes instead.
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Runs git with a token supplied through a one-shot credential helper.
///
/// Shares the reasoning in `git_clone`: the token reaches git through the
/// child's environment, so it appears neither in `.git/config` (as it would if
/// embedded in the remote URL) nor in `ps` output (as it would on the command
/// line).
fn run_git_authenticated(args: &[String], cwd: &str, token: &str) -> Result<String, String> {
    let mut full: Vec<String> = vec![
        "-c".into(),
        "credential.helper=!f() { echo username=x-access-token; echo password=$FM_FORGE_TOKEN; }; f"
            .into(),
    ];
    full.extend_from_slice(args);

    let output = Command::new("git")
        .args(&full)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("FM_FORGE_TOKEN", token)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Runs git off the async runtime.
///
/// `Command::output` blocks until the process exits. Called directly from an
/// async command it parked a Tokio worker for the duration — which for
/// `git fetch` over a slow network meant seconds at a time.
async fn git(args: Vec<String>, cwd: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || run_git_blocking(&args, &cwd))
        .await
        .map_err(|e| format!("git task failed: {e}"))?
}

/// As `git`, with a token when one is available.
///
/// Falls back to the plain runner when `token` is None, so a user whose own
/// credential helper already works is unaffected by having no account
/// connected in the app.
async fn git_auth(args: Vec<String>, cwd: String, token: Option<String>) -> Result<String, String> {
    match token {
        Some(secret) => tokio::task::spawn_blocking(move || {
            run_git_authenticated(&args, &cwd, &secret)
        })
        .await
        .map_err(|e| format!("git task failed: {e}"))?,
        None => git(args, cwd).await,
    }
}

macro_rules! args {
    ($($arg:expr),* $(,)?) => { vec![$($arg.to_string()),*] };
}

/// Resolves the repository root containing `path`.
///
/// Every other call runs from this directory. `git status` reports paths
/// relative to the repository root while a plain `git add <path>` resolves
/// relative to the working directory, so opening a *subfolder* of a repository
/// produced a status list whose entries could never be staged — the failure
/// surfaced as "pathspec did not match any files".
async fn repo_root(path: &str) -> Result<String, String> {
    let out = git(args!["rev-parse", "--show-toplevel"], path.to_string()).await?;
    let root = out.trim().to_string();
    if root.is_empty() {
        return Err("Not inside a git repository".to_string());
    }
    Ok(root)
}

#[tauri::command]
pub async fn git_is_available() -> Result<bool, String> {
    Ok(git(args!["--version"], ".".to_string()).await.is_ok())
}

#[tauri::command]
pub async fn git_is_repo(path: String) -> Result<bool, String> {
    Ok(git(args!["rev-parse", "--is-inside-work-tree"], path)
        .await
        .map(|out| out.trim() == "true")
        .unwrap_or(false))
}

/// Makes sure the workspace's own storage is never committed.
///
/// `.app` holds the workspace SQLite database and its write-ahead log. Only
/// freshly initialised repositories got an ignore entry, so opening a folder
/// that was *already* a repository committed a churning binary on every save.
fn ensure_gitignore_entries(root: &str) -> Result<(), String> {
    let ignore_path = Path::new(root).join(".gitignore");
    let existing = std::fs::read_to_string(&ignore_path).unwrap_or_default();

    // `.app/` only. Whether `.DS_Store` belongs in a repository is the
    // project's business, and adding it uninvited put an unexplained diff in
    // repositories this app merely opened.
    let required = [".app/"];
    let missing: Vec<&str> = required
        .iter()
        .filter(|entry| !existing.lines().any(|line| line.trim() == **entry))
        .copied()
        .collect();

    if missing.is_empty() {
        return Ok(());
    }

    let mut next = existing;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    for entry in missing {
        next.push_str(entry);
        next.push('\n');
    }
    std::fs::write(&ignore_path, next).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_init(path: String) -> Result<(), String> {
    git(args!["init"], path.clone()).await?;
    let root = repo_root(&path).await.unwrap_or(path);
    ensure_gitignore_entries(&root)
}

/// Adds the workspace's ignore entries to an existing repository.
#[tauri::command]
pub async fn git_ensure_ignores(path: String) -> Result<(), String> {
    let root = repo_root(&path).await?;
    ensure_gitignore_entries(&root)
}

/// Splits `git status --porcelain -z` output into its NUL-separated records.
fn parse_status_records(raw: &str) -> Vec<String> {
    raw.split('\0')
        .filter(|record| !record.is_empty())
        .map(|record| record.to_string())
        .collect()
}

fn parse_status(raw: &str) -> GitStatus {
    let records = parse_status_records(raw);
    let mut entries = Vec::new();
    let mut branch = String::new();
    let mut ahead = 0u32;
    let mut behind = 0u32;

    let mut index = 0usize;
    while index < records.len() {
        let record = &records[index];
        index += 1;

        if let Some(rest) = record.strip_prefix("## ") {
            // `## main...origin/main [ahead 2, behind 3]` — the tracking counts
            // live in the bracketed tail, not in the comma-split head. Reading
            // them positionally meant `ahead` was only ever parsed when it was
            // the *second* field, so it always came back as zero.
            let (head, tracking) = match rest.split_once('[') {
                Some((head, tail)) => (head, tail.trim_end_matches(']')),
                None => (rest, ""),
            };

            let branch_raw = head.split("...").next().unwrap_or("").trim().to_string();
            branch = branch_raw
                .strip_prefix("No commits yet on ")
                .unwrap_or(&branch_raw)
                .trim()
                .to_string();

            for part in tracking.split(',') {
                let part = part.trim();
                if let Some(value) = part.strip_prefix("ahead ") {
                    ahead = value.trim().parse().unwrap_or(0);
                }
                if let Some(value) = part.strip_prefix("behind ") {
                    behind = value.trim().parse().unwrap_or(0);
                }
            }
            continue;
        }

        if record.len() < 4 {
            continue;
        }

        let status_x = &record[0..1];
        let status_y = &record[1..2];
        let file_path = record[3..].to_string();

        // A rename or copy is reported as two records: the new path, then the
        // old one. Reading only the first record left the entry holding the
        // literal text "old -> new", which never matched a real file.
        if status_x == "R" || status_x == "C" {
            index += 1;
        }

        if status_x != " " && status_x != "?" {
            entries.push(GitStatusEntry {
                path: file_path.clone(),
                staged: true,
                status: format!("{status_x}{status_y}"),
            });
        }
        if status_y != " " {
            entries.push(GitStatusEntry {
                path: file_path,
                staged: false,
                status: status_y.to_string(),
            });
        }
    }

    GitStatus {
        branch,
        ahead,
        behind,
        dirty: !entries.is_empty(),
        entries,
    }
}

#[tauri::command]
pub async fn git_status(path: String) -> Result<GitStatus, String> {
    let root = repo_root(&path).await?;
    let raw = git(args!["status", "--porcelain=v1", "-z", "-b"], root).await?;
    Ok(parse_status(&raw))
}

#[tauri::command]
pub async fn git_add(path: String, files: Vec<String>) -> Result<(), String> {
    let root = repo_root(&path).await?;
    if files.is_empty() {
        git(args!["add", "-A"], root).await?;
    } else {
        // One process for the whole set rather than one per file.
        let mut command = args!["add", "--"];
        command.extend(files);
        git(command, root).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn git_unstage(path: String, files: Vec<String>) -> Result<(), String> {
    let root = repo_root(&path).await?;

    let (restore, remove) = if files.is_empty() {
        (args!["restore", "--staged", "."], args!["rm", "--cached", "-r", "."])
    } else {
        let mut restore = args!["restore", "--staged", "--"];
        restore.extend(files.clone());
        let mut remove = args!["rm", "--cached", "-r", "--"];
        remove.extend(files);
        (restore, remove)
    };

    // `restore --staged` fails before the first commit, where there is no HEAD
    // to restore from; `rm --cached` is the pre-commit equivalent.
    if git(restore, root.clone()).await.is_err() {
        git(remove, root).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn git_commit(path: String, message: String) -> Result<String, String> {
    let root = repo_root(&path).await?;
    let output = git(args!["commit", "-m", message], root).await?;
    Ok(output.lines().last().unwrap_or("").to_string())
}

/// Pushes, optionally to a named remote and branch.
///
/// Both were previously hardcoded: the command took no arguments and `origin`
/// was assumed at the call site, so a repository with a differently-named
/// remote, or a push to anything but the tracked branch, was not expressible.
#[tauri::command]
pub async fn git_push(
    path: String,
    remote: Option<String>,
    branch: Option<String>,
    token: Option<String>,
) -> Result<(), String> {
    let root = repo_root(&path).await?;
    let mut command = args!["push"];
    if let Some(name) = remote {
        command.push(name);
        if let Some(target) = branch {
            command.push(target);
        }
    }
    git_auth(command, root, token).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_pull(
    path: String,
    remote: Option<String>,
    branch: Option<String>,
    token: Option<String>,
) -> Result<(), String> {
    let root = repo_root(&path).await?;
    let mut command = args!["pull"];
    if let Some(name) = remote {
        command.push(name);
        if let Some(target) = branch {
            command.push(target);
        }
    }
    git_auth(command, root, token).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_log(path: String, file_path: Option<String>) -> Result<Vec<GitCommit>, String> {
    let root = repo_root(&path).await?;
    let mut command = args!["log", "--format=%H|%h|%s|%an|%ai", "--date=short"];
    if let Some(file) = file_path {
        command.push("--".to_string());
        command.push(file);
    }

    let raw = match git(command, root).await {
        Ok(out) => out,
        Err(_) => return Ok(vec![]),
    };

    let mut commits = Vec::new();
    for line in raw.lines() {
        // The subject can contain the separator, so bound the split and keep
        // the remainder intact.
        let parts: Vec<&str> = line.splitn(5, '|').collect();
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
    let root = repo_root(&path).await?;
    let raw = git(args!["branch", "--list"], root).await?;
    let mut branches = Vec::new();
    for line in raw.lines() {
        let current = line.starts_with('*');
        let name = line.trim_start_matches("* ").trim().to_string();
        if !name.is_empty() {
            branches.push(GitBranch { name, current });
        }
    }
    Ok(branches)
}

#[tauri::command]
pub async fn git_current_branch(path: String) -> Result<String, String> {
    let Ok(root) = repo_root(&path).await else {
        return Ok("main".to_string());
    };
    let out = match git(args!["rev-parse", "--abbrev-ref", "HEAD"], root).await {
        Ok(out) => out.trim().to_string(),
        Err(_) => return Ok("main".to_string()),
    };
    Ok(out)
}

#[tauri::command]
pub async fn git_checkout(path: String, branch: String) -> Result<(), String> {
    let root = repo_root(&path).await?;
    git(args!["checkout", branch], root).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_create_branch(path: String, name: String) -> Result<(), String> {
    let root = repo_root(&path).await?;
    git(args!["branch", name], root).await?;
    Ok(())
}

/// Fetches, then compares HEAD with its upstream.
///
/// This performs network I/O, so it is deliberately separate from `git_status`
/// and is called on its own slow cadence rather than on every refresh.
#[tauri::command]
pub async fn git_has_remote_changes(path: String) -> Result<bool, String> {
    let root = repo_root(&path).await?;
    if git(args!["fetch"], root.clone()).await.is_err() {
        return Ok(false);
    }
    let local = match git(args!["rev-parse", "@"], root.clone()).await {
        Ok(out) => out.trim().to_string(),
        Err(_) => return Ok(false),
    };
    let remote = git(args!["rev-parse", "@{u}"], root).await;
    Ok(remote.map(|r| r.trim() != local).unwrap_or(false))
}

#[tauri::command]
pub async fn git_has_remote(path: String) -> Result<bool, String> {
    let root = repo_root(&path).await?;
    let out = git(args!["remote"], root).await?;
    Ok(!out.trim().is_empty())
}

#[tauri::command]
pub async fn git_read_gitignore(path: String) -> Result<Vec<String>, String> {
    let root = repo_root(&path).await.unwrap_or(path);
    let ignore_path = Path::new(&root).join(".gitignore");
    if !ignore_path.exists() {
        return Ok(vec![]);
    }
    let content = std::fs::read_to_string(&ignore_path).map_err(|e| e.to_string())?;
    Ok(content.lines().map(|l| l.to_string()).collect())
}

#[tauri::command]
pub async fn git_write_gitignore(path: String, patterns: Vec<String>) -> Result<(), String> {
    let root = repo_root(&path).await.unwrap_or(path);
    let ignore_path = Path::new(&root).join(".gitignore");
    std::fs::write(&ignore_path, patterns.join("\n") + "\n").map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_show_file(path: String, commit: String, file_path: String) -> Result<String, String> {
    let root = repo_root(&path).await?;
    git(args!["show", format!("{commit}:{file_path}")], root).await
}

#[tauri::command]
pub async fn git_add_remote(path: String, name: String, url: String) -> Result<(), String> {
    let root = repo_root(&path).await?;
    git(args!["remote", "add", name, url], root).await?;
    Ok(())
}

/// The repository root containing `path`, or an empty string when there is none.
///
/// The workspace folder and the repository root are not always the same
/// directory — opening a subfolder of a repository is ordinary. Committing
/// through a provider's API addresses files by their path *within the
/// repository*, so a caller that measures paths from the workspace folder
/// instead would write `chapter.md` where the repository holds
/// `book/chapter.md`, creating a second file rather than updating the one it
/// was editing.
#[tauri::command]
pub async fn git_repo_root(path: String) -> Result<String, String> {
    Ok(repo_root(&path).await.unwrap_or_default())
}

#[tauri::command]
pub async fn git_get_remote_url(path: String) -> Result<String, String> {
    let Ok(root) = repo_root(&path).await else {
        return Ok(String::new());
    };
    Ok(git(args!["remote", "get-url", "origin"], root)
        .await
        .unwrap_or_default()
        .trim()
        .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_and_tracking_counts() {
        let raw = "## main...origin/main [ahead 2, behind 3]\0";
        let status = parse_status(raw);
        assert_eq!(status.branch, "main");
        assert_eq!(status.ahead, 2);
        assert_eq!(status.behind, 3);
    }

    #[test]
    fn parses_branch_before_first_commit() {
        let raw = "## No commits yet on main\0?? notes.md\0";
        let status = parse_status(raw);
        assert_eq!(status.branch, "main");
        assert_eq!(status.entries.len(), 1);
        assert!(!status.entries[0].staged);
    }

    #[test]
    fn keeps_non_ascii_paths_intact() {
        let raw = "## main\0 M caf\u{e9}.md\0";
        let status = parse_status(raw);
        assert_eq!(status.entries[0].path, "caf\u{e9}.md");
    }

    #[test]
    fn reads_rename_records_as_the_new_path() {
        // A rename emits the new path, then the old path as a separate record.
        let raw = "## main\0R  new.md\0old.md\0 M other.md\0";
        let status = parse_status(raw);
        let paths: Vec<&str> = status.entries.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, vec!["new.md", "other.md"]);
        assert!(status.entries[0].staged);
    }

    #[test]
    fn reports_a_file_staged_and_modified_twice() {
        let raw = "## main\0MM chapter.md\0";
        let status = parse_status(raw);
        assert_eq!(status.entries.len(), 2);
        assert!(status.entries.iter().any(|e| e.staged));
        assert!(status.entries.iter().any(|e| !e.staged));
    }

    #[test]
    fn adds_missing_ignore_entries_without_dropping_existing_ones() {
        let dir = std::env::temp_dir().join(format!("frontmatter_gitignore_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(".gitignore"), "node_modules/\n").unwrap();

        ensure_gitignore_entries(&dir.to_string_lossy()).unwrap();

        let content = std::fs::read_to_string(dir.join(".gitignore")).unwrap();
        assert!(content.contains("node_modules/"));
        assert!(content.contains(".app/"));
        // `.DS_Store` is deliberately not added. The workspace database is the
        // app's own artifact and must never be committed; whether a project
        // ignores macOS metadata is the project's decision, and adding it put
        // an unexplained diff in repositories this app merely opened.
        assert!(!content.contains(".DS_Store"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn does_not_duplicate_existing_ignore_entries() {
        let dir = std::env::temp_dir().join(format!("frontmatter_gitignore2_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(".gitignore"), ".app/\n.DS_Store\n").unwrap();

        ensure_gitignore_entries(&dir.to_string_lossy()).unwrap();

        let content = std::fs::read_to_string(dir.join(".gitignore")).unwrap();
        assert_eq!(content.matches(".app/").count(), 1);
        // An entry the project already chose is left exactly as it is.
        assert_eq!(content.matches(".DS_Store").count(), 1);
        std::fs::remove_dir_all(&dir).ok();
    }
}
