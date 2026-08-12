use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// What kind of site the workspace is exported as.
///
/// This used to be a bare `String` that `export_project_zola` accepted and
/// discarded, so every export resolved themes against a hardcoded
/// `"documentation"` directory regardless of what the user picked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ProjectType {
    #[default]
    Docs,
    Blog,
    Book,
    Slides,
}

impl ProjectType {
    /// Directory name under `themes/` holding this target's themes.
    pub fn slug(self) -> &'static str {
        match self {
            ProjectType::Docs => "docs",
            ProjectType::Blog => "blog",
            ProjectType::Book => "book",
            ProjectType::Slides => "slides",
        }
    }

    /// Zola section sort order that suits the target: blogs read newest-first,
    /// docs and books follow the author's ordering.
    pub fn sort_by(self) -> &'static str {
        match self {
            ProjectType::Blog => "date",
            _ => "weight",
        }
    }

    pub fn all() -> [ProjectType; 4] {
        [ProjectType::Docs, ProjectType::Blog, ProjectType::Book, ProjectType::Slides]
    }
}

impl std::str::FromStr for ProjectType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_lowercase().as_str() {
            "docs" | "doc" | "documentation" => Ok(ProjectType::Docs),
            "blog" | "blogs" => Ok(ProjectType::Blog),
            "book" | "books" => Ok(ProjectType::Book),
            // The menu emits the singular "slide".
            "slide" | "slides" | "deck" => Ok(ProjectType::Slides),
            other => Err(format!("unknown project type: {other}")),
        }
    }
}

/// Everything the export needs to know about *what* the user asked for.
#[derive(Debug, Clone)]
pub struct ExportTarget {
    pub project_type: ProjectType,
    pub theme: String,
}

impl ExportTarget {
    pub fn new(project_type: ProjectType, theme: impl Into<String>) -> Self {
        Self { project_type, theme: theme.into() }
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
pub struct ThemeOption {
    pub id: String,
    pub name: String,
    pub description: String,
    pub preview_type: String,
}

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub index_page: Option<String>,
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
    pub updated_at: Option<String>,
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
    pub content: String,
}


