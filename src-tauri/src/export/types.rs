use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub exclude: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub order: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub excerpt: HashMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocInfo {
    pub file_path: String,
    pub title: String,
    pub h1: String,
    pub h2s: Vec<String>,
    pub excerpt: Option<String>,
    pub word_count: i32,
    pub file_created_at: Option<String>,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportContext {
    pub config: ProjectConfig,
    pub tree: Vec<ExportNode>,
    pub pages: Vec<PageInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportNode {
    pub title: String,
    pub file_path: Option<String>,
    pub html_path: Option<String>,
    pub depth: usize,
    pub children: Vec<ExportNode>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HeadingNode {
    pub level: i32,
    pub text: String,
    pub anchor: String,
    pub children: Vec<HeadingNode>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PageInfo {
    pub file_path: String,
    pub html_path: String,
    pub slug: String,
    pub title: String,
    pub h1: String,
    pub heading_tree: Vec<HeadingNode>,
    pub excerpt: Option<String>,
    pub word_count: i32,
    pub reading_time_minutes: i32,
    pub depth: usize,
    pub prev: Option<(String, String)>,
    pub next: Option<(String, String)>,
    pub breadcrumbs: Vec<(String, Option<String>)>,
    pub tags: Vec<String>,
    pub images: Vec<String>,
    pub code_languages: Vec<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Manifest {
    pub config: ProjectConfig,
    pub tree: Vec<ExportNode>,
    pub pages: Vec<PageIndexEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PageIndexEntry {
    pub file_path: String,
    pub html_path: String,
    pub json_path: String,
    pub slug: String,
    pub title: String,
    pub h1: String,
    pub excerpt: Option<String>,
    pub word_count: i32,
    pub reading_time_minutes: i32,
    pub depth: usize,
    pub prev: Option<(String, String)>,
    pub next: Option<(String, String)>,
    pub breadcrumbs: Vec<(String, Option<String>)>,
    pub tags: Vec<String>,
    pub code_languages: Vec<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}


