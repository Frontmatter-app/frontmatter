use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::path::PathBuf;
use std::time::Duration;
use std::time::SystemTime;
use tokio::process::Command as AsyncCommand;
use tokio::time::timeout;

const EXECUTION_TIMEOUT_SECS: u64 = 30;

static COMPILED_LANGUAGES: &[&str] = &[
    "rust", "rs", "c", "c++", "cpp", "cxx", "d", "nim",
];

static RUNNER_LANGUAGES: &[&str] = &[
    "go", "zig", "crystal",
];

fn detect_language_from_content(code: &str) -> Option<String> {
    let candidates: &[(&str, &str)] = &[
        ("test.py", "python"),
        ("test.js", "javascript"),
        ("test.sh", "bash"),
        ("test.rb", "ruby"),
        ("test.rs", "rust"),
        ("test.go", "go"),
        ("test.php", "php"),
    ];
    for &(filename, lang) in candidates {
        if let Ok(langs) = linguist::disambiguate(filename, code) {
            if !langs.is_empty() {
                return Some(lang.to_string());
            }
        }
    }
    let t = code.trim();
    if t.contains("print(") || t.contains("def ") || t.contains("import ") {
        return Some("python".into());
    }
    if t.contains("console.log") || t.contains("const ") || t.contains("let ") {
        return Some("javascript".into());
    }
    None
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionRequest {
    pub object_uuid: String,
    pub language: String,
    pub code: String,
    pub runtime_path: String,
    pub session_id: Option<String>,
    pub continue_of: Option<String>,
    pub working_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputQueryResult {
    pub uuid: String,
    pub parent_object_uuid: String,
    pub output_type: String,
    pub content_hash: String,
    pub file_path: Option<String>,
    pub content: Option<String>,
    pub updated_at: String,
}

#[tauri::command]
pub async fn execute_block(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    request: ExecutionRequest,
) -> Result<ExecutionResult, String> {
    let start = SystemTime::now();
    let workspace_path = {
        let ws_guard = state.window_workspaces.lock().await;
        let label = window.label();
        ws_guard
            .get(label)
            .cloned()
            .ok_or("No workspace open")?
    };

    let db_guard = state.dbs.lock().await;
    let pool = db_guard
        .get(&workspace_path)
        .ok_or("No database pool")?;

    let object_row = sqlx::query(
        "SELECT uuid, name, document_path, start_line, end_line, content_hash, object_type FROM objects WHERE uuid = ?",
    )
    .bind(&request.object_uuid)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    let object_row = object_row.ok_or("Object not found")?;
    let object_name: String = object_row.get("name");
    let object_type_str: String = object_row.get("object_type");

    // Parse before_line / after_line from the current block's metadata
    let (before_line, after_line) = serde_json::from_str::<serde_json::Value>(&object_type_str)
        .ok()
        .map(|v| (
            v.get("before_line").and_then(|x| x.as_i64()).map(|x| x as i32),
            v.get("after_line").and_then(|x| x.as_i64()).map(|x| x as i32),
        ))
        .unwrap_or((None, None));

    let mut code = request.code.clone();
    let mut language = request.language.trim().to_lowercase();

    eprintln!("[execute_block] object_uuid={} name={} continue_of={:?} language={} code_len={}", 
        request.object_uuid, object_name, request.continue_of, language, code.len());

    if language.contains('=')
        || language.starts_with("continue")
        || language.starts_with("anchor")
        || language.starts_with("title")
    {
        language.clear();
    }

    // Walk continuation chain and prepend ancestor code (concatenation approach)
    if let Some(ref continue_of) = request.continue_of {
        if continue_of.trim().is_empty() {
            eprintln!("continue_of is empty string — skipping chain walk");
        } else {
            match resolve_object_by_id(pool, continue_of).await {
                Ok(Some((first_uuid, first_type))) => {
                    eprintln!("Chain ancestor found: uuid={first_uuid}, continue_of={continue_of}");
                    if language.is_empty() || language == "text" {
                        if let Ok(pj) = serde_json::from_str::<serde_json::Value>(&first_type) {
                            if let Some(pl) = pj.get("language").and_then(|l| l.as_str()) {
                                let clean = pl.trim().to_lowercase();
                                if !clean.is_empty() && clean != "text" && !clean.contains('=') {
                                    language = clean;
                                }
                            }
                        }
                    }

                    // Walk the full ancestor chain oldest → newest
                    let mut chain: Vec<String> = Vec::new();
                    let mut current_uuid = first_uuid;
                    let mut current_type = first_type;
                    let mut visited = std::collections::HashSet::new();

                    loop {
                        if !visited.insert(current_uuid.clone()) {
                            break;
                        }
                        chain.push(current_uuid.clone());

                        let grandparent = serde_json::from_str::<serde_json::Value>(&current_type)
                            .ok()
                            .and_then(|v| {
                                v.get("continue_of")
                                    .and_then(|c| c.as_str())
                                    .map(|s| s.to_string())
                            });

                        if let Some(gp_ref) = grandparent {
                            if gp_ref.is_empty() {
                                break;
                            }
                            match resolve_object_by_id(pool, &gp_ref).await {
                                Ok(Some((gp_uuid, gp_type))) => {
                                    current_uuid = gp_uuid;
                                    current_type = gp_type;
                                    continue;
                                }
                                Ok(None) => {
                                    eprintln!("Grandparent id '{gp_ref}' not found — end of chain");
                                    break;
                                }
                                Err(e) => {
                                    eprintln!("Grandparent id '{gp_ref}' error: {e}");
                                    return Err(format!("Failed to resolve continuation '{gp_ref}': {e}"));
                                }
                            }
                        } else {
                            break;
                        }
                    }

                    // Prepend ancestor code in chronological order (oldest first)
                    chain.reverse();
                    let mut prefix = String::new();
                    for ancestor_uuid in &chain {
                        let ancestor_code =
                            get_object_source_code(pool, &workspace_path, ancestor_uuid).await?;
                        if !ancestor_code.trim().is_empty() {
                            prefix.push_str(&ancestor_code);
                            prefix.push_str("\n\n");
                        }
                    }

                    code = {
                        let lines: Vec<&str> = code.lines().collect();
                        let total = lines.len();
                        let pos = if let Some(n) = before_line {
                            ((n - 1).max(0) as usize).min(total)
                        } else if let Some(n) = after_line {
                            (n as usize).min(total)
                        } else {
                            0
                        };

                        let before_part = if pos > 0 {
                            lines[..pos].join("\n") + "\n"
                        } else {
                            String::new()
                        };
                        let after_part = if pos < total {
                            lines[pos..].join("\n")
                        } else {
                            String::new()
                        };

                        format!(
                            "{}{}# --- continuation of {} ---\n{}",
                            before_part, prefix, object_name, after_part
                        )
                    };
                    eprintln!("[DEBUG] prefix ({}) bytes: |{}|", prefix.len(), prefix);
                    eprintln!("[DEBUG] code after chain = |{}|", code);
                    eprintln!("Chain walker prepended {} ancestors for continue_of={continue_of}", chain.len());
                }
                Ok(None) => {
                    eprintln!("resolve_object_by_id returned None for continue_of={continue_of}");
                }
                Err(e) => {
                    eprintln!("resolve_object_by_id error for continue_of={continue_of}: {e}");
                    return Err(format!("Failed to resolve continuation anchor '{continue_of}': {e}"));
                }
            }
        }
    }

    if language.is_empty() || language == "text" {
        language = detect_language_from_content(&code).unwrap_or_else(|| "python".into());
    }

    let runtime_path = PathBuf::from(&request.runtime_path);
    if !runtime_path.exists() {
        return Err(format!("Runtime not found at path: {}", request.runtime_path));
    }

    let normalized_lang = language.as_str();
    let ext = match normalized_lang {
        "python" | "py" => "py",
        "javascript" | "js" | "node" => "js",
        "typescript" | "ts" => "ts",
        "bash" | "sh" | "zsh" | "shell" => "sh",
        "ruby" | "rb" => "rb",
        "go" => "go",
        "rust" | "rs" => "rs",
        "c" => "c",
        "c++" | "cpp" | "cxx" => "cpp",
        "php" => "php",
        "perl" | "pl" => "pl",
        "zig" => "zig",
        "d" => "d",
        "nim" => "nim",
        "crystal" => "cr",
        _ => "tmp",
    };

    let temp_name = format!(".__exec_tmp_{}.{}", request.object_uuid, ext);
    let temp_path = PathBuf::from(&workspace_path).join(&temp_name);
    eprintln!("[execute_block] writing temp file '{}' with code ({} bytes):\n---\n{}\n---", temp_name, code.len(), code);
    std::fs::write(&temp_path, &code)
        .map_err(|e| format!("Failed to write temp execution file: {}", e))?;

    let working_dir = request.working_dir.as_deref().unwrap_or(&workspace_path);

    let is_compiled = COMPILED_LANGUAGES.contains(&normalized_lang);
    let has_runner = RUNNER_LANGUAGES.contains(&normalized_lang);

    let output = if is_compiled {
        // Two-step: compile then run
        let binary_name = format!(
            ".__exec_tmp_{}_bin{}",
            request.object_uuid,
            std::env::consts::EXE_SUFFIX
        );
        let binary_path = PathBuf::from(&workspace_path).join(&binary_name);

        // Step 1: Compile
        let compile_result = timeout(
            Duration::from_secs(EXECUTION_TIMEOUT_SECS),
            AsyncCommand::new(&runtime_path)
                .arg(&temp_path)
                .arg("-o")
                .arg(&binary_path)
                .current_dir(&working_dir)
                .output(),
        )
        .await;

        let compile_output = match compile_result {
            Ok(Ok(o)) => o,
            Ok(Err(e)) => {
                let _ = std::fs::remove_file(&temp_path);
                return Err(format!("Compiler process failed: {}", e));
            }
            Err(_) => {
                let _ = std::fs::remove_file(&temp_path);
                return Err(format!(
                    "Compilation timed out after {} seconds",
                    EXECUTION_TIMEOUT_SECS
                ));
            }
        };

        if !compile_output.status.success() {
            let _ = std::fs::remove_file(&temp_path);
            let _ = std::fs::remove_file(&binary_path);
            let stderr = String::from_utf8_lossy(&compile_output.stderr).to_string();
            return Err(format!("Compilation failed:\n{}", stderr));
        }

        // Step 2: Run the compiled binary
        let run_result = timeout(
            Duration::from_secs(EXECUTION_TIMEOUT_SECS),
            AsyncCommand::new(&binary_path)
                .current_dir(&working_dir)
                .output(),
        )
        .await;

        let _ = std::fs::remove_file(&temp_path);
        let _ = std::fs::remove_file(&binary_path);

        match run_result {
            Ok(Ok(o)) => o,
            Ok(Err(e)) => return Err(format!("Execution failed: {}", e)),
            Err(_) => {
                return Err(format!(
                    "Execution timed out after {} seconds",
                    EXECUTION_TIMEOUT_SECS
                ));
            }
        }
    } else if has_runner {
        // Languages with built-in runners (go run, zig run, crystal run)
        let run_result = timeout(
            Duration::from_secs(EXECUTION_TIMEOUT_SECS),
            AsyncCommand::new(&runtime_path)
                .arg(&temp_path)
                .current_dir(&working_dir)
                .output(),
        )
        .await;

        let _ = std::fs::remove_file(&temp_path);

        match run_result {
            Ok(Ok(o)) => o,
            Ok(Err(e)) => return Err(format!("Runtime process failed: {}", e)),
            Err(_) => {
                return Err(format!(
                    "Execution timed out after {} seconds",
                    EXECUTION_TIMEOUT_SECS
                ));
            }
        }
    } else {
        // Interpreted languages (python, node, bash, etc.)
        let run_result = timeout(
            Duration::from_secs(EXECUTION_TIMEOUT_SECS),
            AsyncCommand::new(&runtime_path)
                .arg(&temp_path)
                .current_dir(&working_dir)
                .output(),
        )
        .await;

        let _ = std::fs::remove_file(&temp_path);

        match run_result {
            Ok(Ok(o)) => o,
            Ok(Err(e)) => return Err(format!("Runtime process failed: {}", e)),
            Err(_) => {
                return Err(format!(
                    "Execution timed out after {} seconds",
                    EXECUTION_TIMEOUT_SECS
                ));
            }
        }
    };

    let duration_ms = start
        .elapsed()
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    let result = ExecutionResult {
        success: output.status.success(),
        stdout,
        stderr,
        exit_code: output.status.code().unwrap_or(-1),
        duration_ms,
    };

    // Cache outputs
    let now = chrono::Utc::now().to_rfc3339();
    let output_uuid = uuid::Uuid::new_v4().simple().to_string();
    let output_hash = {
        let mut hasher = Sha256::new();
        hasher.update(result.stdout.as_bytes());
        hasher.update(result.stderr.as_bytes());
        format!("{:x}", hasher.finalize())
    };

    sqlx::query(
        "INSERT OR REPLACE INTO outputs (uuid, parent_object_uuid, output_type, content_hash, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&output_uuid)
    .bind(&request.object_uuid)
    .bind("stdout")
    .bind(&output_hash)
    .bind(&result.stdout)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&result.stdout) {
        let json_uuid = uuid::Uuid::new_v4().simple().to_string();
        let json_hash = {
            let mut hasher = Sha256::new();
            hasher.update(result.stdout.as_bytes());
            format!("{:x}", hasher.finalize())
        };
        sqlx::query(
            "INSERT OR REPLACE INTO outputs (uuid, parent_object_uuid, output_type, content_hash, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&json_uuid)
        .bind(&request.object_uuid)
        .bind("json")
        .bind(&json_hash)
        .bind(serde_json::to_string(&json_val).ok())
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }

    Ok(result)
}

#[tauri::command]
pub async fn get_outputs(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    object_uuid: String,
) -> Result<Vec<OutputQueryResult>, String> {
    let label = window.label();
    let ws_guard = state.window_workspaces.lock().await;
    let workspace_path = match ws_guard.get(label) {
        Some(p) => p,
        None => return Ok(Vec::new()),
    };

    let db_guard = state.dbs.lock().await;
    let pool = match db_guard.get(workspace_path) {
        Some(p) => p,
        None => return Ok(Vec::new()),
    };

    let rows = sqlx::query(
        "SELECT uuid, parent_object_uuid, output_type, content_hash, file_path, content, updated_at FROM outputs WHERE parent_object_uuid = ? ORDER BY output_type",
    )
    .bind(&object_uuid)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        results.push(OutputQueryResult {
            uuid: row.get("uuid"),
            parent_object_uuid: row.get("parent_object_uuid"),
            output_type: row.get("output_type"),
            content_hash: row.get("content_hash"),
            file_path: row.get("file_path"),
            content: row.get("content"),
            updated_at: row.get("updated_at"),
        });
    }

    Ok(results)
}

async fn get_object_source_code(
    pool: &sqlx::SqlitePool,
    workspace_path: &str,
    object_uuid: &str,
) -> Result<String, String> {
    let row = sqlx::query(
        "SELECT document_path, start_line, end_line, object_type FROM objects WHERE uuid = ? LIMIT 1",
    )
    .bind(object_uuid)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    if let Some(row) = row {
        let doc_path: String = row.get("document_path");
        let start_line: i32 = row.get("start_line");
        let end_line: i32 = row.get("end_line");
        let object_type_str: String = row.get("object_type");
        eprintln!("[get_object_source_code] uuid={object_uuid} doc={doc_path} lines={start_line}-{end_line} type={}", &object_type_str[..object_type_str.len().min(80)]);

        let abs_path = PathBuf::from(workspace_path).join(&doc_path);
        let content =
            std::fs::read_to_string(&abs_path)
                .map_err(|e| format!("Failed to read source file {}: {}", doc_path, e))?;

        let lines: Vec<&str> = content.lines().collect();
        let start = (start_line as usize - 1).min(lines.len());
        let end = (end_line as usize).min(lines.len());

        if start < end {
            let is_code_block = object_type_str.contains("CodeBlock");
            if is_code_block {
                if end - start > 2 {
                    let result = lines[start + 1..end - 1].join("\n");
                    eprintln!("[get_object_source_code] extracted {} chars (stripped fences)", result.len());
                    Ok(result)
                } else {
                    eprintln!("[get_object_source_code] block too small ({} lines), returning empty", end - start);
                    Ok("".to_string())
                }
            } else {
                let result = lines[start..end].join("\n");
                eprintln!("[get_object_source_code] extracted {} chars (non-code block)", result.len());
                Ok(result)
            }
        } else {
            eprintln!("[get_object_source_code] line offsets out of bounds: start={start} end={end} total_lines={}", lines.len());
            Err("Line offsets out of bounds".to_string())
        }
    } else {
        Err("Source block not found in database".to_string())
    }
}

async fn resolve_object_by_id(
    pool: &sqlx::SqlitePool,
    id_val: &str,
) -> Result<Option<(String, String)>, String> {
    // Try UUID lookup
    let row = sqlx::query("SELECT uuid, object_type FROM objects WHERE uuid = ? LIMIT 1")
        .bind(id_val)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(r) = row {
        let uuid: String = r.get("uuid");
        eprintln!("resolve_object_by_id: found by UUID '{}' → uuid={}", id_val, uuid);
        Ok(Some((uuid, r.get("object_type"))))
    } else {
        // Try id field lookup (CodeBlock's id= attribute)
        let id_pattern = format!("%\"id\":\"{}\"%", id_val);
        eprintln!("resolve_object_by_id: UUID not found, trying id LIKE query for '{}'", id_val);
        let row = sqlx::query(
            "SELECT uuid, object_type FROM objects \
             WHERE object_type LIKE ? \
             ORDER BY updated_at DESC LIMIT 1",
        )
        .bind(&id_pattern)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;

        if let Some(r) = &row {
            let uuid: String = r.get("uuid");
            eprintln!("resolve_object_by_id: id found '{}' → uuid={}", id_val, uuid);
        } else {
            eprintln!("resolve_object_by_id: id NOT FOUND for '{}' (pattern={})", id_val, id_pattern);
        }

        Ok(row.map(|r| (r.get("uuid"), r.get("object_type"))))
    }
}
