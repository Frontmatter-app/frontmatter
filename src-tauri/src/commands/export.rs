use pulldown_cmark::{Parser, html};
use serde::Serialize;

#[derive(Serialize)]
pub struct ExportResult {
    pub path: Option<String>,
    pub success: bool,
    pub error: Option<String>,
}

fn render_html(markdown: &str) -> String {
    let parser = Parser::new(markdown);
    let mut body = String::new();
    html::push_html(&mut body, parser);
    format!(r#"<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Export</title>
<style>
body{{max-width:800px;margin:3rem auto;padding:0 2rem;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;line-height:1.7;font-size:16px;color:#1a1a1a}}
img{{max-width:100%;height:auto}}a{{color:#0366d6}}
pre{{background:#f6f8fa;padding:1rem;border-radius:6px;overflow-x:auto}}
code{{background:#f6f8fa;padding:.2em .4em;border-radius:3px;font-size:.9em}}
pre code{{padding:0;background:0}}blockquote{{border-left:4px solid #d0d7de;margin:0;padding:0 1em;color:#656d76}}
table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid #d0d7de;padding:.5em;text-align:left}}
h1,h2,h3,h4{{margin-top:1.5em;margin-bottom:.5em}}
</style></head>
<body>{body}</body></html>"#)
}

#[tauri::command]
pub fn convert_md_to_html(markdown: String) -> Result<String, String> {
    Ok(render_html(&markdown))
}

#[tauri::command]
pub async fn export_file_html(markdown: String) -> Result<ExportResult, String> {
    let html = render_html(&markdown);
    let file = rfd::AsyncFileDialog::new()
        .set_file_name("export.html")
        .add_filter("HTML", &["html", "htm"])
        .save_file()
        .await;
    match file {
        Some(f) => {
            let path = f.path().to_string_lossy().to_string();
            std::fs::write(f.path(), &html).map_err(|e| e.to_string())?;
            Ok(ExportResult { path: Some(path), success: true, error: None })
        }
        None => Ok(ExportResult { path: None, success: false, error: None }),
    }
}

#[tauri::command]
pub async fn export_file_pdf(app: tauri::AppHandle, markdown: String) -> Result<ExportResult, String> {
    let html = render_html(&markdown);
    let temp_dir = std::env::temp_dir().join("marktype-export");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    let file_path = temp_dir.join("preview.html");
    std::fs::write(&file_path, &html).map_err(|e| e.to_string())?;

    let file_url = url::Url::from_file_path(&file_path)
        .map_err(|_| "Could not convert file path to URL".to_string())?;
    let label = format!("pdf_export_{}", uuid::Uuid::new_v4().simple());

    let win = tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::External(file_url))
        .title("Export PDF")
        .inner_size(800.0, 600.0)
        .build()
        .map_err(|e| e.to_string())?;

    let win_clone = win.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(800)).await;
        let _ = win_clone.eval(
            "setTimeout(() => { window.print(); setTimeout(() => window.close(), 1500); }, 300);"
        );
    });

    Ok(ExportResult {
        path: Some(file_path.to_string_lossy().to_string()),
        success: true,
        error: None,
    })
}
