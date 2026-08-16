// GENERATED FILE — DO NOT EDIT.
// Produced by scripts/generate-ipc.mjs from the #[tauri::command] definitions
// in src-tauri/src. Run `npm run ipc:gen` after changing a command.
//
// 114 commands registered in main.rs.
//
// `unknown` means the Rust type is not a serialisable struct this generator
// could resolve; narrow it with a cast at the call site.

export interface AnnotationRecord {
  id: string;
  document_id: string;
  start_pos: string;
  end_pos: string;
  selected_text: string;
  note: string;
  author_id: string;
  resolved: boolean;
  created_at: string;
  replies?: string | null;
}

export interface CloneResult {
  path: string;
  success: boolean;
  error?: string | null;
}

export interface DailyMetricsRow {
  uid: string;
  date: string;
  edits: number;
  writing_time_seconds: number;
  hourly_buckets: string;
  focus_sessions_total: number;
  focus_sessions_avg_min: number;
  avg_wpm: number;
  peak_wpm: number;
  wpm_sample_count: number;
  words_written: number;
  issues_resolved: number;
}

export interface DocHealthRow {
  date: string;
  documents: number;
  words: number;
  stale_docs: number;
  broken_links: number;
  missing_alt_text: number;
  empty_sections: number;
  unclosed_fences: number;
  undefined_acronyms: number;
  hard_sentences: number;
  passives: number;
  inclusive_issues: number;
  median_grade: number;
  docs_over_grade_target: number;
  review_open: number;
  review_resolved: number;
  oldest_open_review_days: number;
  defects: number;
}

export interface DocumentMeta {
  id: string;
  title: string;
  content: string;
  stage: string;
  file_path?: string | null;
  focus_mode: boolean;
  cloud_id?: string | null;
  cloud_synced: boolean;
  cloud_path?: string | null;
  offline_enabled: boolean;
  last_cloud_sync?: string | null;
  created_at: string;
  updated_at: string;
  word_count: number;
  excerpt?: string | null;
  file_created_at?: string | null;
}

export interface DraftNodeRecord {
  id: string;
  document_id: string;
  level: number;
  title: string;
  notes: string;
}

export interface ExecutionRequest {
  object_uuid: string;
  language: string;
  code: string;
  runtime_path: string;
  session_id?: string | null;
  continue_of?: string | null;
  working_dir?: string | null;
}

export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
}

export interface ExportResult {
  path?: string | null;
  success: boolean;
  error?: string | null;
}

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: unknown[] | null;
}

export interface FocusSessionMeta {
  id: string;
  document_id: string;
  words_written: number;
  started_at: string;
  ended_at?: string | null;
}

export interface GitBranch {
  name: string;
  current: boolean;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  dirty: boolean;
  entries: GitStatusEntry[];
}

export interface GitStatusEntry {
  path: string;
  staged: boolean;
  status: string;
}

export interface GrammarLint {
  start: number;
  end: number;
  message: string;
  kind: string;
  severity: string;
  suggestions: string[];
}

export interface HeadingNode {
  level: number;
  text: string;
  anchor: string;
  children: unknown[];
}

export interface ObjectSearchResult {
  uuid: string;
  name: string;
  object_type: string;
  document_path: string;
  start_line: number;
}

export interface OutputQueryResult {
  uuid: string;
  parent_object_uuid: string;
  output_type: string;
  content_hash: string;
  file_path?: string | null;
  content?: string | null;
  updated_at: string;
}

export interface PendingImport {
  path: string;
  name: string;
  content: string;
}

export interface ProjectConfig {
  title?: string | null;
  author?: string | null;
  description?: string | null;
  exclude?: string[];
  order?: string[];
  theme?: string | null;
  excerpt?: Record<string, string>;
  custom?: unknown | null;
  index_page?: string | null;
  base_url?: string | null;
}

export interface ProjectConfigPayload {
  values: unknown;
  config: ProjectConfig;
  path: string;
}

export interface ReferenceResult {
  id: string;
  document_path: string;
  line: number;
  col: number;
  marker_text: string;
}

export interface RenameResult {
  updated_count: number;
}

export interface ReviewBacklogRow {
  open: number;
  resolved: number;
  oldest_open_days: number;
}

export interface RuntimeListItem {
  id: string;
  language: string;
  runtime_type: string;
  executable_path: string;
  managed_path?: string | null;
  version?: string | null;
  is_default: boolean;
}

export interface SaveAsResult {
  path: string;
  success: boolean;
}

export interface SnapshotMeta {
  id: string;
  document_id: string;
  created_at: string;
  label?: string | null;
  word_count?: number | null;
  author?: string | null;
}

export interface SuccessResponse {
  success: boolean;
}

export interface ThemeOption {
  id: string;
  name: string;
  description: string;
  preview_type: string;
  screenshot?: string | null;
  source: unknown;
  author?: string | null;
  options: ThemeOptionField[];
  path: string;
}

export interface ThemeOptionField {
  key: string;
  label?: string | null;
  type: unknown;
  default?: unknown | null;
  help?: string | null;
  choices: string[];
}

export interface WorkspaceMeta {
  path: string;
  is_valid: boolean;
}

export interface WorkspaceReference {
  id: string;
  document_path: string;
  line: number;
  col: number;
  object_uuid?: string | null;
  output_uuid?: string | null;
  marker_text: string;
  created_at: string;
  updated_at: string;
}

/** Arguments accepted by each command, camelCased as Tauri expects. */
export interface IpcArgsMap {
  'get_default_workspace': { workspaceContextJson?: string | null };
  'get_last_workspace': { workspaceContextJson?: string | null };
  'save_last_workspace': { workspaceContextJson?: string | null; path: string };
  'get_window_workspace': Record<string, never>;
  'get_pending_import': Record<string, never>;
  'get_documents': Record<string, never>;
  'open_workspace': { path?: string | null };
  'get_directory_tree': { workspacePath: string; showHidden?: boolean | null };
  'credential_set': { account: string; secret: string };
  'credential_get': { account: string };
  'credential_delete': { account: string };
  'credential_exists': { account: string };
  'create_document': { id: string; title: string; content: string; filePath?: string | null };
  'update_document': { id: string; title: string; content: string; stage: string; focusMode: boolean };
  'get_document': { id: string };
  'delete_document': { id: string };
  'update_document_path': { id: string; filePath: string };
  'sync_draft_nodes': { documentId: string; nodes: DraftNodeRecord[] };
  'open_or_import_file': { filePath: string };
  'create_file_on_disk': { parentDir: string; name: string };
  'create_directory_on_disk': { parentDir: string; name: string };
  'delete_file_or_dir_on_disk': { path: string };
  'move_or_rename_on_disk': { oldPath: string; newPath: string };
  'reveal_in_folder': { path: string };
  'open_external_file': Record<string, never>;
  'pick_save_path': { suggestedTitle: string };
  'pick_folder': { title?: string | null };
  'show_unsaved_dialog': { title: string };
  'show_confirm_dialog': { title: string; description: string };
  'show_alert_dialog': { title: string; description: string };
  'set_cloud_sync': { id: string; cloudId: string; cloudPath?: string | null };
  'clear_cloud_sync': { id: string };
  'set_offline_enabled': { id: string; enabled: boolean };
  'save_snapshot': { documentId: string; snapshot: number[]; label?: string | null; wordCount?: number | null; author?: string | null };
  'get_snapshots': { documentId: string };
  'get_snapshot_data': { id: string };
  'delete_snapshot': { id: string };
  'clear_document_history': { documentId: string };
  'create_snapshot': { documentId: string; snapshot: number[]; label?: string | null; wordCount?: number | null; author?: string | null };
  'save_annotation': { annotation: AnnotationRecord };
  'resolve_annotation': { id: string };
  'save_annotation_replies': { id: string; replies: string };
  'get_annotations': { documentId: string };
  'get_metrics_date_range': { args: unknown };
  'save_daily_metrics': { args: unknown };
  'save_doc_health_daily': { args: unknown };
  'get_doc_health_range': { args: unknown };
  'get_review_backlog': Record<string, never>;
  'save_focus_session': { documentId: string; wordsWritten: number; startedAt: string };
  'open_file_in_new_window_command': { workspacePath: string; filePath: string };
  'open_account_window': { accountUid: string; accountToken?: string | null; workspaceContextJson: string; savedAccountsJson?: string | null };
  'start_google_auth': { state: string };
  'open_browser_url': { url: string };
  'open_folder_in_new_window_from_path': { path: string };
  'minimize_window': Record<string, never>;
  'maximize_window': Record<string, never>;
  'restore_window': Record<string, never>;
  'close_window': Record<string, never>;
  'get_window_state': Record<string, never>;
  'index_workspace': Record<string, never>;
  'index_file': { filePath: string };
  'index_document_content': { documentId: string; markdown: string };
  'search_objects': { query: string };
  'find_references': { objectUuid: string };
  'rename_object': { objectUuid: string; newName: string };
  'get_object_by_uuid': { objectUuid: string };
  'get_references_for_document': { documentPath: string };
  'set_transclusion_hash': { objectUuid: string; hash: string };
  'get_transclusion_hash': { objectUuid: string };
  'execute_block': { request: ExecutionRequest };
  'get_outputs': { objectUuid: string };
  'list_runtimes': Record<string, never>;
  'add_runtime': { language: string; executablePath: string; runtimeType: string };
  'remove_runtime': { runtimeId: string };
  'set_default_runtime': { language: string; executablePath: string };
  'convert_md_to_html': { markdown: string };
  'export_file_html': { markdown: string };
  'export_file_pdf': { markdown: string };
  'export_project_zola': { projectType: string; themeName: string; preview?: boolean | null };
  'list_theme_options': { projectType: string };
  'read_project_config': Record<string, never>;
  'save_project_settings': { values: unknown };
  'save_site_archive': { suggestedName?: string | null };
  'git_is_available': Record<string, never>;
  'git_is_repo': { path: string };
  'git_init': { path: string };
  'git_status': { path: string };
  'git_add': { path: string; files: string[] };
  'git_unstage': { path: string; files: string[] };
  'git_commit': { path: string; message: string };
  'git_push': { path: string };
  'git_pull': { path: string };
  'git_log': { path: string; filePath?: string | null };
  'git_branches': { path: string };
  'git_current_branch': { path: string };
  'git_checkout': { path: string; branch: string };
  'git_create_branch': { path: string; name: string };
  'git_has_remote_changes': { path: string };
  'git_has_remote': { path: string };
  'git_read_gitignore': { path: string };
  'git_write_gitignore': { path: string; patterns: string[] };
  'git_show_file': { path: string; commit: string; filePath: string };
  'git_ensure_ignores': { path: string };
  'git_add_remote': { path: string; name: string; url: string };
  'git_get_remote_url': { path: string };
  'git_clone': { url: string; destination: string; token?: string | null };
  'save_as_document': { id: string };
  'get_auto_save': Record<string, never>;
  'set_auto_save': { enabled: boolean };
  'get_recent_projects': Record<string, never>;
  'add_recent_project': { path: string };
  'clear_recent_projects': Record<string, never>;
  'check_grammar': { text: string };
  'get_system_fonts': Record<string, never>;
}

/** Value each command resolves to. */
export interface IpcResultMap {
  'get_default_workspace': string;
  'get_last_workspace': string | null;
  'save_last_workspace': null;
  'get_window_workspace': string | null;
  'get_pending_import': PendingImport | null;
  'get_documents': DocumentMeta[];
  'open_workspace': WorkspaceMeta | null;
  'get_directory_tree': FileNode;
  'credential_set': null;
  'credential_get': string | null;
  'credential_delete': null;
  'credential_exists': boolean;
  'create_document': DocumentMeta;
  'update_document': SuccessResponse;
  'get_document': DocumentMeta;
  'delete_document': SuccessResponse;
  'update_document_path': SuccessResponse;
  'sync_draft_nodes': null;
  'open_or_import_file': DocumentMeta;
  'create_file_on_disk': string;
  'create_directory_on_disk': string;
  'delete_file_or_dir_on_disk': null;
  'move_or_rename_on_disk': null;
  'reveal_in_folder': null;
  'open_external_file': [string, string, string] | null;
  'pick_save_path': string | null;
  'pick_folder': string | null;
  'show_unsaved_dialog': string;
  'show_confirm_dialog': boolean;
  'show_alert_dialog': null;
  'set_cloud_sync': SuccessResponse;
  'clear_cloud_sync': SuccessResponse;
  'set_offline_enabled': SuccessResponse;
  'save_snapshot': SnapshotMeta;
  'get_snapshots': SnapshotMeta[];
  'get_snapshot_data': number[];
  'delete_snapshot': null;
  'clear_document_history': null;
  'create_snapshot': SnapshotMeta;
  'save_annotation': null;
  'resolve_annotation': null;
  'save_annotation_replies': null;
  'get_annotations': AnnotationRecord[];
  'get_metrics_date_range': DailyMetricsRow[];
  'save_daily_metrics': null;
  'save_doc_health_daily': null;
  'get_doc_health_range': DocHealthRow[];
  'get_review_backlog': ReviewBacklogRow;
  'save_focus_session': FocusSessionMeta;
  'open_file_in_new_window_command': null;
  'open_account_window': null;
  'start_google_auth': number;
  'open_browser_url': null;
  'open_folder_in_new_window_from_path': null;
  'minimize_window': void;
  'maximize_window': void;
  'restore_window': void;
  'close_window': void;
  'get_window_state': boolean;
  'index_workspace': null;
  'index_file': null;
  'index_document_content': null;
  'search_objects': ObjectSearchResult[];
  'find_references': ReferenceResult[];
  'rename_object': RenameResult;
  'get_object_by_uuid': unknown | null;
  'get_references_for_document': WorkspaceReference[];
  'set_transclusion_hash': null;
  'get_transclusion_hash': string | null;
  'execute_block': ExecutionResult;
  'get_outputs': OutputQueryResult[];
  'list_runtimes': RuntimeListItem[];
  'add_runtime': RuntimeListItem;
  'remove_runtime': null;
  'set_default_runtime': null;
  'convert_md_to_html': string;
  'export_file_html': ExportResult;
  'export_file_pdf': ExportResult;
  'export_project_zola': unknown;
  'list_theme_options': ThemeOption[];
  'read_project_config': ProjectConfigPayload;
  'save_project_settings': ProjectConfigPayload;
  'save_site_archive': string | null;
  'git_is_available': boolean;
  'git_is_repo': boolean;
  'git_init': null;
  'git_status': GitStatus;
  'git_add': null;
  'git_unstage': null;
  'git_commit': string;
  'git_push': null;
  'git_pull': null;
  'git_log': GitCommit[];
  'git_branches': GitBranch[];
  'git_current_branch': string;
  'git_checkout': null;
  'git_create_branch': null;
  'git_has_remote_changes': boolean;
  'git_has_remote': boolean;
  'git_read_gitignore': string[];
  'git_write_gitignore': null;
  'git_show_file': string;
  'git_ensure_ignores': null;
  'git_add_remote': null;
  'git_get_remote_url': string;
  'git_clone': CloneResult;
  'save_as_document': SaveAsResult | null;
  'get_auto_save': boolean;
  'set_auto_save': null;
  'get_recent_projects': string[];
  'add_recent_project': null;
  'clear_recent_projects': null;
  'check_grammar': GrammarLint[];
  'get_system_fonts': string[];
}

export type IpcCommand = keyof IpcArgsMap;
export type IpcArgs<C extends IpcCommand> = IpcArgsMap[C];
export type IpcResult<C extends IpcCommand> = IpcResultMap[C];

/** Every registered command name, for runtime contract checks. */
export const IPC_COMMANDS = [
  'get_default_workspace',
  'get_last_workspace',
  'save_last_workspace',
  'get_window_workspace',
  'get_pending_import',
  'get_documents',
  'open_workspace',
  'get_directory_tree',
  'credential_set',
  'credential_get',
  'credential_delete',
  'credential_exists',
  'create_document',
  'update_document',
  'get_document',
  'delete_document',
  'update_document_path',
  'sync_draft_nodes',
  'open_or_import_file',
  'create_file_on_disk',
  'create_directory_on_disk',
  'delete_file_or_dir_on_disk',
  'move_or_rename_on_disk',
  'reveal_in_folder',
  'open_external_file',
  'pick_save_path',
  'pick_folder',
  'show_unsaved_dialog',
  'show_confirm_dialog',
  'show_alert_dialog',
  'set_cloud_sync',
  'clear_cloud_sync',
  'set_offline_enabled',
  'save_snapshot',
  'get_snapshots',
  'get_snapshot_data',
  'delete_snapshot',
  'clear_document_history',
  'create_snapshot',
  'save_annotation',
  'resolve_annotation',
  'save_annotation_replies',
  'get_annotations',
  'get_metrics_date_range',
  'save_daily_metrics',
  'save_doc_health_daily',
  'get_doc_health_range',
  'get_review_backlog',
  'save_focus_session',
  'open_file_in_new_window_command',
  'open_account_window',
  'start_google_auth',
  'open_browser_url',
  'open_folder_in_new_window_from_path',
  'minimize_window',
  'maximize_window',
  'restore_window',
  'close_window',
  'get_window_state',
  'index_workspace',
  'index_file',
  'index_document_content',
  'search_objects',
  'find_references',
  'rename_object',
  'get_object_by_uuid',
  'get_references_for_document',
  'set_transclusion_hash',
  'get_transclusion_hash',
  'execute_block',
  'get_outputs',
  'list_runtimes',
  'add_runtime',
  'remove_runtime',
  'set_default_runtime',
  'convert_md_to_html',
  'export_file_html',
  'export_file_pdf',
  'export_project_zola',
  'list_theme_options',
  'read_project_config',
  'save_project_settings',
  'save_site_archive',
  'git_is_available',
  'git_is_repo',
  'git_init',
  'git_status',
  'git_add',
  'git_unstage',
  'git_commit',
  'git_push',
  'git_pull',
  'git_log',
  'git_branches',
  'git_current_branch',
  'git_checkout',
  'git_create_branch',
  'git_has_remote_changes',
  'git_has_remote',
  'git_read_gitignore',
  'git_write_gitignore',
  'git_show_file',
  'git_ensure_ignores',
  'git_add_remote',
  'git_get_remote_url',
  'git_clone',
  'save_as_document',
  'get_auto_save',
  'set_auto_save',
  'get_recent_projects',
  'add_recent_project',
  'clear_recent_projects',
  'check_grammar',
  'get_system_fonts',
] as const;
