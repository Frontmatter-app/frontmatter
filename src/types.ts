export interface User {
  id: string;
  display_name?: string;
  email?: string;
  avatar_url?: string;
  created_at: string;
  last_seen_at: string;
  is_anonymous: boolean;
  role?: string;
  restricted_paths?: string[];
  plan?: 'free' | 'author' | 'team' | 'enterprise';
  planStatus?: 'active' | 'past_due' | 'canceled' | null;
  teamId?: string | null;
}

export type Stage = 'draft' | 'write' | 'revise';

export interface DocumentMeta {
  id: string;
  title: string;
  content: string;
  stage: Stage;
  file_path?: string;
  focus_mode: boolean;
  created_at: string;
  updated_at: string;
  // Cloud sync
  is_cloud?: boolean;        // true when this doc came purely from Firestore (no local copy)
  cloud_id?: string;         // Firestore document id of the mirrored cloud copy
  cloud_synced?: boolean;    // local file is synced to cloud
  cloud_path?: string;       // folder path inside cloud tree, e.g. "chapter1/intro"
  offline_enabled?: boolean; // user has enabled offline access for this cloud doc
}

export interface CloudFolderMeta {
  id: string;
  ownerId: string;
  teamId: string | null;
  path: string;
  created_at: string;
  updated_at: string;
}

export interface Annotation {
  id: string;
  documentId: string;
  startPos: number;
  endPos: number;
  selectedText: string;
  note: string;
  authorId: string;
  createdAt: string;
  resolved: boolean;
}

export interface DraftNode {
  id: string;
  type: 'heading' | 'description' | 'goal';
  level: number;
  content: string;
  children: string[];
  collapsed: boolean;
}

export interface ValeAlert {
  line: number;
  span: [number, number];
  message: string;
  description: string;
  severity: string;
  match: string;
  rule: string;
  action?: unknown;
  link?: string;
}

export type ValeResponse = Record<string, ValeAlert[]>;

export interface ObjectSearchResult {
  uuid: string;
  name: string;
  object_type: string;
  document_path: string;
  start_line: number;
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

export interface ExecutionRequest {
  object_uuid: string;
  language: string;
  code: string;
  runtime_path: string;
  session_id?: string;
  continue_of?: string;
  working_dir?: string;
}

export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
}

export interface OutputQueryResult {
  uuid: string;
  parent_object_uuid: string;
  output_type: string;
  content_hash: string;
  file_path?: string;
  content?: string;
  updated_at: string;
}

export interface RuntimeListItem {
  id: string;
  language: string;
  runtime_type: string;
  executable_path: string;
  managed_path?: string;
  version?: string;
  is_default: boolean;
}

export interface SnapshotMeta {
  id: string;
  document_id: string;
  created_at: string;
  label?: string;
  word_count?: number;
  author?: string;
}

