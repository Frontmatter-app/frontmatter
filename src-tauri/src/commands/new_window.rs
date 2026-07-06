use tauri::{Emitter, Manager, WebviewUrl};

fn url_encode(input: &str) -> String {
    input.as_bytes().iter().flat_map(|byte| match byte {
        b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => vec![*byte as char],
        _ => format!("%{:02X}", byte).chars().collect(),
    }).collect()
}

#[tauri::command]
pub async fn open_file_in_new_window_command(
    app: tauri::AppHandle,
    workspace_path: String,
    file_path: String,
) -> Result<(), String> {
    let workspace_path_buf = std::path::PathBuf::from(&workspace_path);
    let file_path_buf = std::path::PathBuf::from(&file_path);
    let name = file_path_buf.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled.md".to_string());
    let content = std::fs::read_to_string(&file_path_buf).unwrap_or_default();
    let label = format!("win_{}", uuid::Uuid::new_v4().simple());

    let _pool = crate::window_ops::init_workspace_db(&workspace_path_buf, &label, &app).await?;
    app.state::<crate::AppState>().pending_imports.lock().await.insert(
        label.clone(), crate::PendingImport { path: file_path, name, content },
    );
    crate::watcher::start_workspace_watcher(app.clone(), workspace_path_buf);

    let win = crate::window_ops::build_window(&app, &label, WebviewUrl::App("index.html".into()))?;
    Ok(())
}

#[tauri::command]
pub async fn open_account_window(
    app: tauri::AppHandle,
    account_uid: String,
    account_token: Option<String>,
    workspace_context_json: String,
    saved_accounts_json: Option<String>,
) -> Result<(), String> {
    let default_path = crate::commands::workspace::default_local_folder_for_context_json(Some(&workspace_context_json))?;
    let label = format!("account_{}", uuid::Uuid::new_v4().simple());

    let _pool = crate::window_ops::init_workspace_db(&default_path, &label, &app).await?;
    crate::watcher::start_workspace_watcher(app.clone(), default_path);

    let mut params = vec![
        format!("account_uid={}", url_encode(&account_uid)),
        format!("workspace_context={}", url_encode(&workspace_context_json)),
    ];
    if let Some(token) = account_token { params.push(format!("account_token={}", url_encode(&token))); }
    if let Some(accounts) = saved_accounts_json { params.push(format!("saved_accounts={}", url_encode(&accounts))); }
    let url = format!("index.html?{}", params.join("&"));

    #[cfg(target_os = "macos")]
    let win = crate::window_ops::build_window(&app, &label, WebviewUrl::App(url.into()))?;

    #[cfg(not(target_os = "macos"))]
    let win = {
        let home = dirs::home_dir().ok_or("Could not determine home directory")?;
        let data_dir = home.join("MarkType").join(".data").join(&account_uid);
        crate::window_ops::build_window_with_data_dir(&app, &label, WebviewUrl::App(url.into()), data_dir)?
    };

    Ok(())
}

#[tauri::command]
pub async fn start_google_auth(app: tauri::AppHandle, state: String) -> Result<u16, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let app_clone = app.clone();
    let expected_state = state.clone();

    tokio::spawn(async move {
        if let Ok((mut socket, _)) = listener.accept().await {
            let mut buf = [0; 4096];
            let mut bytes_read = 0;
            while bytes_read < buf.len() {
                match socket.read(&mut buf[bytes_read..]).await {
                    Ok(0) => break,
                    Ok(n) => { bytes_read += n; if buf[..bytes_read].windows(4).any(|w| w == b"\r\n\r\n") { break; } }
                    Err(_) => break,
                }
            }

            let url_decode = |input: &str| -> String {
                let mut result = String::new();
                let mut chars = input.chars();
                while let Some(ch) = chars.next() {
                    if ch == '%' {
                        let (c1, c2) = (chars.next(), chars.next());
                        if let (Some(c1), Some(c2)) = (c1, c2) {
                            if let Ok(byte) = u8::from_str_radix(&format!("{}{}", c1, c2), 16) { result.push(byte as char); continue; }
                        }
                        result.push('%'); if let Some(c) = c1 { result.push(c); } if let Some(c) = c2 { result.push(c); }
                    } else if ch == '+' { result.push(' '); } else { result.push(ch); }
                }
                result
            };

            let request = String::from_utf8_lossy(&buf[..bytes_read]);
            let mut auth_code = None;
            let mut recvd_state = None;

            if let Some(first_line) = request.lines().next() {
                if let Some(path_start) = first_line.find(" /callback?") {
                    let rest = &first_line[path_start + 11..];
                    if let Some(path_end) = rest.find(' ') {
                        for pair in rest[..path_end].split('&') {
                            let mut parts = pair.splitn(2, '=');
                            if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
                                if k == "code" { auth_code = Some(url_decode(v)); }
                                else if k == "state" { recvd_state = Some(url_decode(v)); }
                            }
                        }
                    }
                }
            }

            let success = auth_code.is_some() && recvd_state.as_deref() == Some(&expected_state);
            let body = if success {
                "<!DOCTYPE html><html><body style='display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#09090b;color:#fafafa;font-family:sans-serif'><div style='text-align:center'><h1>Authentication Complete</h1><p>You can close this tab and return to the app.</p></div></body></html>"
            } else {
                "<!DOCTYPE html><html><body style='display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#09090b;color:#f87171;font-family:sans-serif'><div style='text-align:center'><h1>Authentication Failed</h1><p>Invalid state parameter. Please try again.</p></div></body></html>"
            };
            let status_line = if success { "HTTP/1.1 200 OK" } else { "HTTP/1.1 400 Bad Request" };
            let response = format!("{}\r\nContent-Length: {}\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n{}", status_line, body.len(), body);
            let _ = socket.write_all(response.as_bytes()).await;
            let _ = socket.flush().await;

            if success {
                if let Some(code) = auth_code {
                    let _ = app_clone.emit("auth-google-callback", serde_json::json!({ "code": code, "state": expected_state }));
                }
            }
        }
    });

    Ok(port)
}
