use std::path::Path;
use std::process::Command;

#[derive(serde::Serialize)]
pub struct CloneResult {
    pub path: String,
    pub success: bool,
    pub error: Option<String>,
}

/// Supplies a token to `git` without writing it anywhere it would persist.
///
/// The obvious approaches are both wrong. Embedding it in the URL
/// (`https://token@host/...`) makes git record the token in `.git/config` as
/// the remote, so it survives on disk indefinitely and is copied by anything
/// that reads the remote. Passing it on the command line exposes it in `ps` to
/// every process on the machine for the duration of the clone.
///
/// A one-shot credential helper reads it from the child's environment instead:
/// the helper script contains no secret, the environment is not world-readable,
/// and the cloned repository's remote URL comes out clean.
fn credential_helper_args(token: &Option<String>) -> Vec<String> {
    match token {
        Some(_) => vec![
            "-c".into(),
            // x-access-token is what GitHub expects as the username for an
            // OAuth token; GitLab and Gitea accept any non-empty username.
            "credential.helper=!f() { echo username=x-access-token; echo password=$FM_FORGE_TOKEN; }; f"
                .into(),
        ],
        None => Vec::new(),
    }
}

#[tauri::command]
pub async fn git_clone(
    url: String,
    destination: String,
    token: Option<String>,
) -> Result<CloneResult, String> {
    let dest_path = Path::new(&destination);

    if dest_path.exists() {
        return Ok(CloneResult {
            path: destination,
            success: false,
            error: Some("Destination already exists".to_string()),
        });
    }

    let parent = dest_path.parent().ok_or("Invalid destination path")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;

    let mut command = Command::new("git");
    command.args(credential_helper_args(&token));
    command.args(["clone", &url, &destination]);
    command.env("GIT_TERMINAL_PROMPT", "0");
    if let Some(secret) = &token {
        command.env("FM_FORGE_TOKEN", secret);
    }

    let output = command
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Ok(CloneResult {
            path: destination,
            success: false,
            error: Some(stderr),
        });
    }

    let gitignore_path = dest_path.join(".gitignore");
    if dest_path.is_dir() && !gitignore_path.exists() {
        // `.app/` — the workspace database directory. This wrote `*.app`, which
        // matches nothing of the sort, so a freshly cloned workspace committed
        // the SQLite file and its write-ahead log until something else repaired
        // the entry. Keep it in step with `ensure_gitignore_entries` in `git.rs`.
        let content = ".app/\nnode_modules/\n";
        let _ = std::fs::write(&gitignore_path, content);
    }

    Ok(CloneResult {
        path: destination,
        success: true,
        error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_token_means_no_credential_helper() {
        assert!(credential_helper_args(&None).is_empty());
    }

    #[test]
    fn a_token_installs_a_helper_that_reads_the_environment() {
        let args = credential_helper_args(&Some("secret".into()));
        assert_eq!(args.len(), 2);
        assert_eq!(args[0], "-c");
        assert!(args[1].starts_with("credential.helper="));
        // The secret must reach git through the environment, not through the
        // argument vector, which `ps` exposes to every process on the machine.
        assert!(args[1].contains("$FM_FORGE_TOKEN"));
        assert!(!args[1].contains("secret"));
    }
}
