use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn};
use uuid::Uuid;

fn stable_object_uuid(doc_path: &str, line: i32) -> String {
    let ns = Uuid::NAMESPACE_URL;
    let name = format!("obj:{}:{}", doc_path, line);
    Uuid::new_v5(&ns, name.as_bytes()).simple().to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ObjectType {
    CodeBlock {
        language: String,
        id: Option<String>,
        profile: Option<String>,
        session: Option<String>,
        continue_of: Option<String>,
        before_line: Option<i32>,
        after_line: Option<i32>,
        ref_id: Option<String>,
    },
    Heading {
        level: i32,
        ref_id: Option<String>,
    },
    Image {
        url: String,
        alt: Option<String>,
        ref_id: Option<String>,
    },
    Table {
        ref_id: Option<String>,
    },
    MathBlock {
        ref_id: Option<String>,
    },
    Diagram {
        diagram_type: String,
        ref_id: Option<String>,
    },
    Output {
        output_type: String,
        parent_uuid: String,
        ref_id: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceObject {
    pub uuid: String,
    pub object_type: ObjectType,
    pub name: String,
    pub document_path: String,
    pub start_line: i32,
    pub end_line: i32,
    pub start_col: i32,
    pub end_col: i32,
    pub content_hash: String,
    pub metadata: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceReference {
    pub id: String,
    pub document_path: String,
    pub line: i32,
    pub col: i32,
    pub object_uuid: Option<String>,
    pub output_uuid: Option<String>,
    pub marker_text: String,
    pub created_at: String,
    pub updated_at: String,
}

static CODE_BLOCK_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^```(\w+)(.*?)$").unwrap());
static CODE_BLOCK_END_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^```\s*$").unwrap());
static HEADING_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^(#{1,6})\s+(.+)$").unwrap());
static IMAGE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^!\[([^\]]*)\]\(([^)]+)\)(.*)$").unwrap());
static TABLE_ROW_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\|?(\s*[^\|]+\s*\|)+\s*[^\|]*\s*$").unwrap());
static TABLE_SEP_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*$").unwrap());
static MATH_BLOCK_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\$\$(.*)$").unwrap());
static MATH_BLOCK_END_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^.*\$\$\s*(?:\{[^}]*\}\s*)?$").unwrap());
static REF_MARKER_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\{\{ref:([^}]+)\}\}").unwrap());
static META_PAIR_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))"#).unwrap());
static INLINE_ATTRS_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\{([^}]*)\}\s*$").unwrap());

fn parse_inline_attrs(line: &str) -> HashMap<String, String> {
    let mut attrs = HashMap::new();
    if let Some(caps) = INLINE_ATTRS_RE.captures(line) {
        let inner = caps.get(1).unwrap().as_str();
        for pair in META_PAIR_RE.captures_iter(inner) {
            let key = pair.get(1).unwrap().as_str().to_string();
            let value = pair.get(2)
                .or_else(|| pair.get(3))
                .or_else(|| pair.get(4))
                .map(|m| m.as_str())
                .unwrap_or("")
                .to_string();
            attrs.insert(key, value);
        }
    }
    attrs
}

fn find_excerpt(lines: &[&str]) -> Option<String> {
    let mut h1_index = None;
    for (i, line) in lines.iter().enumerate() {
        if HEADING_RE.is_match(line) && line.trim_start().starts_with("# ") {
            h1_index = Some(i);
            break;
        }
    }
    let start = match h1_index {
        Some(idx) => idx + 1,
        None => 0,
    };
    for line in &lines[start..] {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with('#') || trimmed.starts_with("```") || trimmed.starts_with("$$") {
            continue;
        }
        let excerpt = trimmed.chars().take(250).collect::<String>();
        return if excerpt.is_empty() { None } else { Some(excerpt) };
    }
    None
}

pub struct WorkspaceIndexer {
    pool: sqlx::SqlitePool,
    workspace_path: PathBuf,
    object_names: Arc<RwLock<HashMap<String, usize>>>,
    seen_hashes: Arc<RwLock<HashMap<String, String>>>,
}

impl WorkspaceIndexer {
    pub fn new(pool: sqlx::SqlitePool, workspace_path: PathBuf) -> Self {
        Self {
            pool,
            workspace_path,
            object_names: Arc::new(RwLock::new(HashMap::new())),
            seen_hashes: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn index_workspace(&self) -> Result<(), String> {
        info!("Starting workspace index for {:?}", self.workspace_path);
        self.object_names.write().await.clear();
        self.seen_hashes.write().await.clear();

        // Sync and reconcile filesystem changes to the database
        if let Err(e) = crate::workspace_sync::reconcile_workspace(&self.workspace_path, &self.pool).await {
            warn!("Reconciliation failed: {}", e);
        }

        let files = self.collect_markdown_files(&self.workspace_path);
        let total = files.len();
        info!("Found {} markdown files", total);

        for (idx, file_path) in files.iter().enumerate() {
            if idx % 100 == 0 {
                info!("Indexing {}/{} files", idx, total);
            }
            if let Err(e) = self.index_file(file_path).await {
                warn!("Failed to index {}: {}", file_path.display(), e);
            }
        }

        info!("Workspace index complete");
        Ok(())
    }

    pub async fn index_file(&self, file_path: &Path) -> Result<(), String> {
        let content = fs::read_to_string(file_path)
            .map_err(|e| format!("Failed to read {}: {}", file_path.display(), e))?;

        let abs_path_str = file_path.to_string_lossy().to_string();
        self.index_content_string(&content, &abs_path_str).await?;

        // Persist file_created_at from filesystem metadata
        if let Ok(meta) = fs::metadata(file_path) {
            if let Ok(created) = meta.created() {
                let created_rfc: String = {
                    let dt: chrono::DateTime<chrono::Utc> = created.into();
                    dt.to_rfc3339()
                };
                let _ = sqlx::query("UPDATE documents SET file_created_at = ? WHERE file_path = ?")
                    .bind(&created_rfc)
                    .bind(&abs_path_str)
                    .execute(&self.pool)
                    .await;
            }
        }

        Ok(())
    }

    /// Index a document whose content is already in memory (no file I/O).
    /// `virtual_path` is used as the stable key in the `objects` table and
    /// for UUID derivation — it should be unique per document (e.g. the doc id).
    pub async fn index_content_string(&self, content: &str, virtual_path: &str) -> Result<(), String> {
        let rel_path = virtual_path;
        let lines: Vec<&str> = content.lines().collect();

        let mut objects = Vec::new();
        let mut references = Vec::new();

        let mut i = 0;
        while i < lines.len() {
            let line_num = i + 1;
            let line = lines[i];

            // Check for code blocks
            if let Some(caps) = CODE_BLOCK_RE.captures(line) {
                let lang = caps.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
                let meta = caps.get(2).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
                let start_line = line_num;
                let start_col = line.find("```").unwrap_or(0) as i32;

                let mut end_line = start_line;
                let mut j = i + 1;
                while j < lines.len() {
                    if CODE_BLOCK_END_RE.is_match(lines[j]) {
                        end_line = j + 1;
                        break;
                    }
                    j += 1;
                }

                let end_col = lines[end_line - 1].find("```").unwrap_or(0) as i32;
                let code_content = lines[start_line..end_line].join("\n");
                let content_hash = self.hash_content(&code_content);

                let object_type = self.parse_code_block_metadata(&lang, &meta, &code_content, &rel_path, start_line);
                let name = self.resolve_name(&object_type, &code_content, &rel_path, start_line, &content_hash).await;

                objects.push(WorkspaceObject {
                    uuid: stable_object_uuid(&rel_path, start_line as i32),
                    object_type,
                    name,
                    document_path: rel_path.to_string(),
                    start_line: start_line as i32,
                    end_line: end_line as i32,
                    start_col,
                    end_col,
                    content_hash,
                    metadata: serde_json::json!({}),
                    created_at: chrono::Utc::now().to_rfc3339(),
                    updated_at: chrono::Utc::now().to_rfc3339(),
                });

                i = end_line;
                continue;
            }

            // Check for display math blocks
            if MATH_BLOCK_RE.is_match(line.trim()) {
                let start_line = line_num;
                let start_col = line.find("$$").unwrap_or(0) as i32;
                let mut end_line: Option<usize> = None;

                if line.trim()[2..].contains("$$") {
                    end_line = Some(start_line);
                } else {
                    let mut j = i + 1;
                    while j < lines.len() {
                        if MATH_BLOCK_END_RE.is_match(lines[j].trim()) {
                            end_line = Some(j + 1);
                            break;
                        }
                        j += 1;
                    }
                }

                if let Some(end_line) = end_line {
                    let raw = lines[start_line - 1..end_line].join("\n");
                    let attrs = parse_inline_attrs(lines[start_line - 1]);
                    let ref_id = attrs.get("ref").or_else(|| attrs.get("rid")).cloned();
                    let content_hash = self.hash_content(&raw);
                    let object_type = ObjectType::MathBlock { ref_id };
                    let name = self.resolve_name(&object_type, &raw, &rel_path, start_line, &content_hash).await;

                    objects.push(WorkspaceObject {
                        uuid: stable_object_uuid(&rel_path, start_line as i32),
                        object_type,
                        name,
                        document_path: rel_path.to_string(),
                        start_line: start_line as i32,
                        end_line: end_line as i32,
                        start_col,
                        end_col: lines[end_line - 1].len() as i32,
                        content_hash,
                        metadata: serde_json::json!({}),
                        created_at: chrono::Utc::now().to_rfc3339(),
                        updated_at: chrono::Utc::now().to_rfc3339(),
                    });

                    i = end_line;
                    continue;
                }
            }

            // Check for headings
            if let Some(caps) = HEADING_RE.captures(line) {
                let level = caps.get(1).unwrap().as_str().len() as i32;
                let raw_text = caps.get(2).unwrap().as_str().trim().to_string();

                let attrs = parse_inline_attrs(&raw_text);
                let ref_id = attrs.get("ref").or_else(|| attrs.get("rid")).cloned();
                let text = INLINE_ATTRS_RE.replace(&raw_text, "").trim().to_string();
                let content_hash = self.hash_content(&text);

                let name = self.resolve_heading_name(&text, &rel_path).await?;

                objects.push(WorkspaceObject {
                    uuid: stable_object_uuid(&rel_path, line_num as i32),
                    object_type: ObjectType::Heading { level, ref_id },
                    name,
                    document_path: rel_path.to_string(),
                    start_line: line_num as i32,
                    end_line: line_num as i32,
                    start_col: 0,
                    end_col: line.len() as i32,
                    content_hash,
                    metadata: serde_json::json!({}),
                    created_at: chrono::Utc::now().to_rfc3339(),
                    updated_at: chrono::Utc::now().to_rfc3339(),
                });
            }

            // Check for standalone images
            if let Some(caps) = IMAGE_RE.captures(line) {
                let alt = caps.get(1).map(|m| m.as_str().to_string());
                let url = caps.get(2).unwrap().as_str().to_string();

                let after_md = caps.get(3).map(|m| m.as_str()).unwrap_or("");
                let attrs = parse_inline_attrs(after_md);
                let ref_id = attrs.get("ref").or_else(|| attrs.get("rid")).cloned();
                let content_hash = self.hash_content(&url);

                let name = self.resolve_image_name(&url, alt.as_deref(), &rel_path).await?;

                objects.push(WorkspaceObject {
                    uuid: stable_object_uuid(&rel_path, line_num as i32),
                    object_type: ObjectType::Image { url, alt: alt.clone(), ref_id },
                    name,
                    document_path: rel_path.to_string(),
                    start_line: line_num as i32,
                    end_line: line_num as i32,
                    start_col: 0,
                    end_col: line.len() as i32,
                    content_hash,
                    metadata: serde_json::json!({}),
                    created_at: chrono::Utc::now().to_rfc3339(),
                    updated_at: chrono::Utc::now().to_rfc3339(),
                });
            }

            // Check for tables
            if TABLE_ROW_RE.is_match(line.trim())
                && i + 1 < lines.len()
                && !lines[i + 1].trim().is_empty()
                && (TABLE_SEP_RE.is_match(lines[i + 1].trim())
                    || (i + 2 < lines.len() && TABLE_ROW_RE.is_match(lines[i + 2].trim()) && TABLE_SEP_RE.is_match(lines[i + 1].trim())))
            {
                let start_line = line_num;
                let mut end_line = line_num;
                let mut j = i + 1;
                while j < lines.len() {
                    if lines[j].trim().is_empty() || (!TABLE_ROW_RE.is_match(lines[j].trim()) && !TABLE_SEP_RE.is_match(lines[j].trim())) {
                        break;
                    }
                    end_line = j + 1;
                    j += 1;
                }

                let raw = lines[start_line - 1..end_line].join("\n");
                let content_hash = self.hash_content(&raw);
                let name = self.resolve_table_name(&raw, &rel_path).await?;

                let attrs = parse_inline_attrs(lines[i]);
                let trailing_attrs = if end_line < lines.len() {
                    parse_inline_attrs(lines[end_line])
                } else {
                    HashMap::new()
                };
                let ref_id = attrs.get("ref").or_else(|| attrs.get("rid")).cloned();
                let ref_id = ref_id.or_else(|| trailing_attrs.get("ref").or_else(|| trailing_attrs.get("rid")).cloned());

                objects.push(WorkspaceObject {
                    uuid: stable_object_uuid(&rel_path, start_line as i32),
                    object_type: ObjectType::Table { ref_id },
                    name,
                    document_path: rel_path.to_string(),
                    start_line: start_line as i32,
                    end_line: end_line as i32,
                    start_col: 0,
                    end_col: lines[end_line - 1].len() as i32,
                    content_hash,
                    metadata: serde_json::json!({}),
                    created_at: chrono::Utc::now().to_rfc3339(),
                    updated_at: chrono::Utc::now().to_rfc3339(),
                });

                i = end_line;
                continue;
            }

            // Check for reference markers in text
            if let Some(caps) = REF_MARKER_RE.captures(line) {
                let marker = caps.get(0).unwrap().as_str();
                let ref_id = caps.get(1).unwrap().as_str().to_string();
                references.push(WorkspaceReference {
                    id: Uuid::new_v4().simple().to_string(),
                    document_path: rel_path.to_string(),
                    line: line_num as i32,
                    col: line.find(marker).unwrap_or(0) as i32,
                    object_uuid: self.resolve_ref_id(&ref_id).await?,
                    output_uuid: None,
                    marker_text: marker.to_string(),
                    created_at: chrono::Utc::now().to_rfc3339(),
                    updated_at: chrono::Utc::now().to_rfc3339(),
                });
            }

            i += 1;
        }

        // Persist to database
        self.persist_objects(&rel_path, objects).await?;
        self.persist_references(&rel_path, references).await?;

        // Compute and persist doc-level metadata
        let word_count = content.split_whitespace().count() as i32;
        let excerpt = find_excerpt(&lines);

        // Update the documents row — may not exist yet for brand-new files, ignore if so
        let _ = sqlx::query("UPDATE documents SET word_count = ?, excerpt = ? WHERE file_path = ?")
            .bind(word_count)
            .bind(&excerpt)
            .bind(rel_path)
            .execute(&self.pool)
            .await;

        Ok(())
    }

    fn collect_markdown_files(&self, dir: &Path) -> Vec<PathBuf> {
        let mut files = Vec::new();
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        if name.starts_with('.') || name == "node_modules" || name == "target" {
                            continue;
                        }
                    }
                    files.extend(self.collect_markdown_files(&path));
                } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    if ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown") || ext.eq_ignore_ascii_case("txt") {
                        files.push(path);
                    }
                }
            }
        }
        files
    }


    fn hash_content(&self, content: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    fn parse_code_block_metadata(&self, lang: &str, meta: &str, _content: &str, _doc: &str, _line: usize) -> ObjectType {
        let language = if lang.is_empty() { "text".to_string() } else { lang.to_string() };

        let mut profile: Option<String> = None;
        let mut session: Option<String> = None;
        let mut continue_of: Option<String> = None;
        let mut before_line: Option<i32> = None;
        let mut after_line: Option<i32> = None;
        let mut id: Option<String> = None;
        let mut ref_id: Option<String> = None;

        for cap in META_PAIR_RE.captures_iter(meta) {
            let key = cap.get(1).unwrap().as_str();
            let value = cap.get(2)
                .or_else(|| cap.get(3))
                .or_else(|| cap.get(4))
                .map(|m| m.as_str())
                .unwrap_or("");

            match key {
                "profile" | "p" => profile = Some(value.to_string()),
                "session" | "s" => session = Some(value.to_string()),
                "chain" | "c" => continue_of = Some(value.to_string()),
                "id" => id = Some(value.to_string()),
                "ref" | "rid" => ref_id = Some(value.to_string()),
                "before" | "b" => {
                    if let Ok(n) = value.parse::<i32>() { before_line = Some(n); }
                }
                "after" | "a" => {
                    if let Ok(n) = value.parse::<i32>() { after_line = Some(n); }
                }
                _ => {}
            }
        }

        if language.eq_ignore_ascii_case("mermaid") {
            return ObjectType::Diagram { diagram_type: "mermaid".to_string(), ref_id };
        }

        ObjectType::CodeBlock { language, id, profile, session, continue_of, before_line, after_line, ref_id }
    }

    async fn resolve_name(&self, object_type: &ObjectType, content: &str, _doc: &str, _line: usize, hash: &str) -> String {
        match object_type {
            ObjectType::CodeBlock { id, .. } => {
                if let Some(i) = id {
                    return self.unique_name(i, "code").await;
                }
                // Try to extract from first comment or function
                for l in content.lines().skip(1).take(20) {
                    let trimmed = l.trim();
                    if trimmed.starts_with('#') && trimmed.len() > 1 {
                        let name = trimmed[1..].trim().to_string();
                        if !name.is_empty() {
                            return self.unique_name(&name, "code").await;
                        }
                    }
                    if trimmed.starts_with("def ") || trimmed.starts_with("function ") || trimmed.starts_with("class ") {
                        let name = trimmed
                            .split(|c: char| c == '(' || c == ' ' || c == '{' || c == ':')
                            .nth(1)
                            .unwrap_or("code")
                            .to_string();
                        if !name.is_empty() {
                            return self.unique_name(&name, "code").await;
                        }
                    }
                    if trimmed.starts_with("//") && trimmed.len() > 2 {
                        let name = trimmed[2..].trim().to_string();
                        if !name.is_empty() {
                            return self.unique_name(&name, "code").await;
                        }
                    }
                }
                self.unique_name(&format!("Code Block {}", hash[..8].to_string()), "code").await
            }
            ObjectType::Heading { .. } => {
                // Name is set separately from heading text
                "".to_string()
            }
            ObjectType::Image { url, alt, .. } => {
                if let Some(a) = alt {
                    if !a.is_empty() {
                        return self.unique_name(a, "image").await;
                    }
                }
                let filename = Path::new(url).file_stem().and_then(|s| s.to_str()).unwrap_or("image");
                self.unique_name(filename, "image").await
            }
            ObjectType::Table { .. } => {
                self.unique_name("Table", "table").await
            }
            ObjectType::MathBlock { .. } => {
                let formula = content
                    .lines()
                    .map(|line| line.trim().trim_start_matches("$$").trim_end_matches("$$").trim())
                    .find(|line| !line.is_empty() && !line.starts_with('{'))
                    .unwrap_or("Math");
                let base_owned = formula.chars().take(36).collect::<String>();
                let base = if base_owned.is_empty() { "Math" } else { base_owned.as_str() };
                self.unique_name(base, "math").await
            }
            ObjectType::Diagram { diagram_type, .. } => {
                self.unique_name(diagram_type, "diagram").await
            }
            ObjectType::Output { .. } => {
                self.unique_name("Output", "output").await
            }
        }
    }

    async fn resolve_heading_name(&self, text: &str, doc: &str) -> Result<String, String> {
        let base = text.trim().to_string();
        let mut name = base.clone();
        let mut counter = 1;
        loop {
            let key = format!("heading:{}:{}", doc, name);
            if let Some(existing) = self.object_names.read().await.get(&key) {
                if *existing == 1 {
                    break;
                }
                name = format!("{} {}", base, counter);
                counter += 1;
            } else {
                break;
            }
        }
        self.object_names.write().await.entry(format!("heading:{}:{}", doc, name)).and_modify(|e| *e += 1).or_insert(1);
        Ok(name)
    }

    async fn resolve_image_name(&self, url: &str, alt: Option<&str>, doc: &str) -> Result<String, String> {
        let base = alt.unwrap_or_else(|| Path::new(url).file_stem().and_then(|s| s.to_str()).unwrap_or("image")).to_string();
        let mut name = base.clone();
        let mut counter = 1;
        loop {
            let key = format!("image:{}:{}", doc, name);
            if self.object_names.read().await.contains_key(&key) {
                name = format!("{} {}", base, counter);
                counter += 1;
            } else {
                break;
            }
        }
        self.object_names.write().await.insert(format!("image:{}:{}", doc, name), 1);
        Ok(name)
    }

    async fn resolve_table_name(&self, raw: &str, doc: &str) -> Result<String, String> {
        let first_line = raw.lines().next().unwrap_or("Table");
        let cells: Vec<&str> = first_line.split('|').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
        let base = if !cells.is_empty() { cells[0].to_string() } else { "Table".to_string() };
        let mut name = base.clone();
        let mut counter = 1;
        loop {
            let key = format!("table:{}:{}", doc, name);
            if self.object_names.read().await.contains_key(&key) {
                name = format!("{} {}", base, counter);
                counter += 1;
            } else {
                break;
            }
        }
        self.object_names.write().await.insert(format!("table:{}:{}", doc, name), 1);
        Ok(name)
    }

    async fn unique_name(&self, base: &str, kind: &str) -> String {
        let mut name = base.to_string();
        let mut counter = 1;
        loop {
            let key = format!("{}:{}", kind, name);
            if self.object_names.read().await.contains_key(&key) {
                name = format!("{} {}", base, counter);
                counter += 1;
            } else {
                break;
            }
        }
        self.object_names.write().await.insert(format!("{}:{}", kind, name), 1);
        name
    }

    async fn resolve_ref_id(&self, ref_text: &str) -> Result<Option<String>, String> {
        if ref_text.starts_with("uuid:") {
            return Ok(Some(ref_text[5..].to_string()));
        }
        // Look up by name in current index
        let row = sqlx::query("SELECT uuid FROM objects WHERE name = ? LIMIT 1")
            .bind(ref_text)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(row.map(|r| r.get("uuid")))
    }

    async fn persist_objects(&self, doc_path: &str, objects: Vec<WorkspaceObject>) -> Result<(), String> {
        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;

        // Remove old objects for this document
        sqlx::query("DELETE FROM objects WHERE document_path = ?")
            .bind(doc_path)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

        for obj in objects {
            sqlx::query(
                "INSERT OR REPLACE INTO objects (uuid, object_type, name, document_path, start_line, end_line, start_col, end_col, content_hash, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&obj.uuid)
            .bind(serde_json::to_string(&obj.object_type).map_err(|e| e.to_string())?)
            .bind(&obj.name)
            .bind(&obj.document_path)
            .bind(obj.start_line)
            .bind(obj.end_line)
            .bind(obj.start_col)
            .bind(obj.end_col)
            .bind(&obj.content_hash)
            .bind(&obj.metadata.to_string())
            .bind(&obj.created_at)
            .bind(&obj.updated_at)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        }

        tx.commit().await.map_err(|e| e.to_string())
    }

    async fn persist_references(&self, doc_path: &str, references: Vec<WorkspaceReference>) -> Result<(), String> {
        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;

        sqlx::query("DELETE FROM doc_references WHERE document_path = ?")
            .bind(doc_path)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

        for ref_obj in references {
            sqlx::query(
                "INSERT OR REPLACE INTO doc_references (id, document_path, line, col, object_uuid, output_uuid, marker_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&ref_obj.id)
            .bind(&ref_obj.document_path)
            .bind(ref_obj.line)
            .bind(ref_obj.col)
            .bind(&ref_obj.object_uuid)
            .bind(&ref_obj.output_uuid)
            .bind(&ref_obj.marker_text)
            .bind(&ref_obj.created_at)
            .bind(&ref_obj.updated_at)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        }

        tx.commit().await.map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn index_workspace(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let label = window.label();
    let ws_guard = state.window_workspaces.lock().await;
    let workspace_path = match ws_guard.get(label) {
        Some(p) => p,
        None => return Err("No workspace open".to_string()),
    };

    let db_guard = state.dbs.lock().await;
    let pool = match db_guard.get(workspace_path) {
        Some(p) => p,
        None => return Err("No database pool".to_string()),
    };

    let indexer = WorkspaceIndexer::new(pool.clone(), std::path::PathBuf::from(workspace_path));
    indexer.index_workspace().await
}

#[tauri::command]
pub async fn index_file(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    file_path: String,
) -> Result<(), String> {
    let label = window.label();
    let ws_guard = state.window_workspaces.lock().await;
    let workspace_path = match ws_guard.get(label) {
        Some(p) => p,
        None => return Err("No workspace open".to_string()),
    };

    let db_guard = state.dbs.lock().await;
    let pool = match db_guard.get(workspace_path) {
        Some(p) => p,
        None => return Err("No database pool".to_string()),
    };

    let indexer = WorkspaceIndexer::new(pool.clone(), std::path::PathBuf::from(workspace_path));
    indexer.index_file(std::path::Path::new(&file_path)).await
}

/// Index a cloud/team document from its markdown content string.
/// Called when a document has no local file_path (cloud-only).
/// Uses the document id as a stable virtual path key.
#[tauri::command]
pub async fn index_document_content(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    document_id: String,
    markdown: String,
) -> Result<(), String> {
    let label = window.label();
    let ws_guard = state.window_workspaces.lock().await;
    let workspace_path = match ws_guard.get(label) {
        Some(p) => p,
        None => return Err("No workspace open".to_string()),
    };

    let db_guard = state.dbs.lock().await;
    let pool = match db_guard.get(workspace_path) {
        Some(p) => p,
        None => return Err("No database pool".to_string()),
    };

    let indexer = WorkspaceIndexer::new(pool.clone(), std::path::PathBuf::from(workspace_path));
    // Use __cloud__/<id>.md as a stable virtual path that won't clash with real files
    let virtual_path = format!("__cloud__/{}.md", document_id);
    indexer.index_content_string(&markdown, &virtual_path).await
}
