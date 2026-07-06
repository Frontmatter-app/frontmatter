#[tauri::command]
pub async fn open_external_file() -> Result<Option<(String, String, String)>, String> {
    let file = rfd::AsyncFileDialog::new()
        .add_filter("Markdown", &["md", "markdown", "txt"])
        .pick_file()
        .await;

    Ok(file.map(|handle| {
        let path = handle.path().to_string_lossy().to_string();
        let name = handle.file_name();
        let content = std::fs::read_to_string(handle.path()).unwrap_or_default();
        (path, name, content)
    }))
}

#[tauri::command]
pub async fn pick_save_path(suggested_title: String) -> Result<Option<String>, String> {
    let handle = rfd::AsyncFileDialog::new()
        .set_file_name(&format!("{}.md", suggested_title))
        .add_filter("Markdown", &["md", "markdown", "txt"])
        .save_file()
        .await;

    Ok(handle.map(|f| f.path().to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn pick_folder(title: Option<String>) -> Result<Option<String>, String> {
    let folder = rfd::AsyncFileDialog::new()
        .set_title(&title.unwrap_or_else(|| "Select Folder".to_string()))
        .pick_folder()
        .await;

    Ok(folder.map(|f| f.path().to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn show_confirm_dialog(title: String, description: String) -> Result<bool, String> {
    let res = rfd::AsyncMessageDialog::new()
        .set_level(rfd::MessageLevel::Info)
        .set_title(&title)
        .set_description(&description)
        .set_buttons(rfd::MessageButtons::OkCancel)
        .show()
        .await;
    Ok(matches!(res, rfd::MessageDialogResult::Ok))
}

#[tauri::command]
pub async fn show_alert_dialog(title: String, description: String) -> Result<(), String> {
    rfd::AsyncMessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title(&title)
        .set_description(&description)
        .set_buttons(rfd::MessageButtons::Ok)
        .show()
        .await;
    Ok(())
}

#[tauri::command]
pub async fn show_unsaved_dialog(title: String) -> Result<String, String> {
    let res = rfd::AsyncMessageDialog::new()
        .set_level(rfd::MessageLevel::Warning)
        .set_title("Unsaved Changes")
        .set_description(&format!(
            "Do you want to save the changes you made to \"{}\"?\nYour changes will be lost if you don't save them.",
            title
        ))
        .set_buttons(rfd::MessageButtons::YesNoCancel)
        .show()
        .await;

    match res {
        rfd::MessageDialogResult::Yes => Ok("save".to_string()),
        rfd::MessageDialogResult::No => Ok("discard".to_string()),
        _ => Ok("cancel".to_string()),
    }
}
