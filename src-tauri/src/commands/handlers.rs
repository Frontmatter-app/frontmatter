//! The IPC surface, grouped by domain.
//!
//! `tauri::generate_handler!` must be a single macro invocation, so the list
//! cannot literally be split across modules. Wrapping it here keeps `main.rs`
//! free of a hundred-line block and gives the commands somewhere to be grouped
//! and commented by the area they belong to.
//!
//! Adding a command means adding it here and running `npm run ipc:gen`; the
//! contract test fails the build if the generated TypeScript drifts.

/// Expands to the full `invoke_handler` for the application.
#[macro_export]
macro_rules! app_command_handlers {
    () => {
        tauri::generate_handler![
            // -- Workspace ------------------------------------------------
            $crate::commands::workspace::get_default_workspace,
            $crate::commands::workspace::get_last_workspace,
            $crate::commands::workspace::save_last_workspace,
            $crate::commands::workspace::get_window_workspace,
            $crate::commands::workspace::get_pending_import,
            $crate::commands::workspace::get_documents,
            $crate::commands::workspace::open_workspace,
            $crate::commands::workspace_tree::get_directory_tree,
            // -- Documents ------------------------------------------------
            $crate::commands::documents::create_document,
            $crate::commands::documents::update_document,
            $crate::commands::documents::get_document,
            $crate::commands::documents::delete_document,
            $crate::commands::documents::update_document_path,
            $crate::commands::drafts::sync_draft_nodes,
            // -- Files on disk --------------------------------------------
            $crate::commands::file_ops::open_or_import_file,
            $crate::commands::file_ops::create_file_on_disk,
            $crate::commands::file_ops::create_directory_on_disk,
            $crate::commands::file_ops::delete_file_or_dir_on_disk,
            $crate::commands::file_ops::move_or_rename_on_disk,
            $crate::commands::file_ops::reveal_in_folder,
            // -- Dialogs --------------------------------------------------
            $crate::commands::dialogs::open_external_file,
            $crate::commands::dialogs::pick_save_path,
            $crate::commands::dialogs::pick_folder,
            $crate::commands::dialogs::show_unsaved_dialog,
            $crate::commands::dialogs::show_confirm_dialog,
            $crate::commands::dialogs::show_alert_dialog,
            // -- Cloud sync -----------------------------------------------
            $crate::commands::cloud_sync::set_cloud_sync,
            $crate::commands::cloud_sync::clear_cloud_sync,
            $crate::commands::cloud_sync::set_offline_enabled,
            // -- History and annotations ----------------------------------
            $crate::commands::snapshots::save_snapshot,
            $crate::commands::snapshots::get_snapshots,
            $crate::commands::snapshots::get_snapshot_data,
            $crate::commands::snapshots::delete_snapshot,
            $crate::commands::snapshots::clear_document_history,
            $crate::commands::snapshots::create_snapshot,
            $crate::commands::annotations::save_annotation,
            $crate::commands::annotations::resolve_annotation,
            $crate::commands::annotations::save_annotation_replies,
            $crate::commands::annotations::get_annotations,
            // -- Metrics and focus ----------------------------------------
            $crate::commands::metrics::get_metrics_date_range,
            $crate::commands::metrics::save_daily_metrics,
            $crate::commands::metrics::save_doc_health_daily,
            $crate::commands::metrics::get_doc_health_range,
            $crate::commands::metrics::get_review_backlog,
            $crate::commands::focus_sessions::save_focus_session,
            // -- Windows --------------------------------------------------
            $crate::commands::new_window::open_file_in_new_window_command,
            $crate::commands::new_window::open_account_window,
            $crate::commands::new_window::start_google_auth,
            $crate::commands::window::open_browser_url,
            $crate::commands::window::open_folder_in_new_window_from_path,
            $crate::commands::window::minimize_window,
            $crate::commands::window::maximize_window,
            $crate::commands::window::restore_window,
            $crate::commands::window::close_window,
            $crate::commands::window::get_window_state,
            // -- Indexing and references ----------------------------------
            $crate::commands::indexer::index_workspace,
            $crate::commands::indexer::index_file,
            $crate::commands::indexer::index_document_content,
            $crate::commands::references::search_objects,
            $crate::commands::references::find_references,
            $crate::commands::references::rename_object,
            $crate::commands::references::get_object_by_uuid,
            $crate::commands::references::get_references_for_document,
            $crate::commands::references::set_transclusion_hash,
            $crate::commands::references::get_transclusion_hash,
            // -- Code execution -------------------------------------------
            $crate::commands::execution::execute_block,
            $crate::commands::execution::get_outputs,
            $crate::commands::runtimes::list_runtimes,
            $crate::commands::runtimes::add_runtime,
            $crate::commands::runtimes::remove_runtime,
            $crate::commands::runtimes::set_default_runtime,
            // -- Export ---------------------------------------------------
            $crate::commands::export::convert_md_to_html,
            $crate::commands::export::export_file_html,
            $crate::commands::export::export_file_pdf,
            $crate::export::commands::export_project_zola,
            $crate::export::commands::list_theme_options,
            // -- Git ------------------------------------------------------
            $crate::commands::git::git_is_available,
            $crate::commands::git::git_is_repo,
            $crate::commands::git::git_init,
            $crate::commands::git::git_status,
            $crate::commands::git::git_add,
            $crate::commands::git::git_unstage,
            $crate::commands::git::git_commit,
            $crate::commands::git::git_push,
            $crate::commands::git::git_pull,
            $crate::commands::git::git_log,
            $crate::commands::git::git_branches,
            $crate::commands::git::git_current_branch,
            $crate::commands::git::git_checkout,
            $crate::commands::git::git_create_branch,
            $crate::commands::git::git_has_remote_changes,
            $crate::commands::git::git_has_remote,
            $crate::commands::git::git_read_gitignore,
            $crate::commands::git::git_write_gitignore,
            $crate::commands::git::git_show_file,
            $crate::commands::git::git_ensure_ignores,
            $crate::commands::git::git_add_remote,
            $crate::commands::git::git_get_remote_url,
            $crate::commands::git_clone::git_clone,
            // -- Project and misc -----------------------------------------
            $crate::commands::project::save_as_document,
            $crate::commands::project::get_auto_save,
            $crate::commands::project::set_auto_save,
            $crate::commands::project::get_recent_projects,
            $crate::commands::project::add_recent_project,
            $crate::commands::project::clear_recent_projects,
            $crate::commands::grammar::check_grammar,
            $crate::commands::fonts::get_system_fonts,
        ]
    };
}
