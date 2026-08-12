//! End-to-end proof that each shipped theme renders a real site.
//!
//! Builds a fixture workspace, runs the export pipeline against the bundled
//! themes, then invokes the real `zola` binary. A template error in any theme
//! fails the build here rather than in front of a user.
//!
//! Skips itself (with a warning) when the zola binary is absent, so a checkout
//! without it still passes the gate.

use crate::export::normalize::build_context;
use crate::export::site::ensure_zola_project;
use crate::export::types::{DocInfo, ExportTarget, ProjectConfig, ProjectType};

use std::collections::HashMap;
use std::path::{Path, PathBuf};

struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let p = std::env::temp_dir().join(format!(
            "marktype-theme-build-{}-{}",
            tag,
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&p).expect("create temp dir");
        TempDir(p)
    }
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn repo_themes_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("workspace root")
        .join("themes")
}

fn zola_binary() -> Option<PathBuf> {
    let bin = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries").join("zola");
    bin.is_file().then_some(bin)
}

fn doc(file_path: &str, content: &str) -> DocInfo {
    let h1 = content
        .lines()
        .find_map(|l| l.trim().strip_prefix("# ").map(|s| s.trim().to_string()))
        .unwrap_or_else(|| file_path.to_string());
    DocInfo {
        file_path: file_path.to_string(),
        title: h1.clone(),
        h1,
        h2s: vec![],
        excerpt: Some("A short summary of the document.".to_string()),
        word_count: 640,
        file_created_at: Some("2026-03-04T10:00:00Z".to_string()),
        updated_at: Some("2026-05-19T08:30:00Z".to_string()),
        content: content.to_string(),
    }
}

/// A workspace shaped like a real project: a root index, top-level pages, a
/// folder note with children, and a nested leaf page.
fn fixture_docs() -> Vec<DocInfo> {
    vec![
        doc("README.md", "# Welcome\n\nThe project index page.\n"),
        doc(
            "01-getting-started.md",
            "# Getting Started\n\nIntro prose.\n\n## Install\n\n```bash\n# not a heading\nnpm i\n```\n\n## Configure\n\nMore prose.\n",
        ),
        doc("guide.md", "# Guide\n\nOverview of the guide section.\n"),
        doc(
            "guide/concepts.md",
            "# Concepts\n\n## Overview\n\nFirst.\n\n## Overview\n\nDuplicate heading on purpose.\n",
        ),
        doc("guide/advanced.md", "# Advanced\n\nDeeper material.\n"),
        doc(
            "reference/api.md",
            "# API Reference\n\n| Name | Type |\n|---|---|\n| id | string |\n",
        ),
    ]
}

fn config() -> ProjectConfig {
    ProjectConfig {
        title: Some(r#"The "Quoted" Project"#.to_string()),
        author: Some(r#"A. O"Brien"#.to_string()),
        description: Some("A description with \"quotes\" and\na newline.".to_string()),
        exclude: vec![],
        order: vec![],
        theme: None,
        excerpt: HashMap::new(),
        custom: None,
        index_page: Some("README.md".to_string()),
    }
}

fn build_site_with(project_type: ProjectType, theme: &str) {
    let Some(zola) = zola_binary() else {
        eprintln!("skipping: zola binary not present");
        return;
    };

    let tmp = TempDir::new(project_type.slug());
    let workspace = tmp.path().join("ws");
    let output = tmp.path().join("out");
    std::fs::create_dir_all(&workspace).unwrap();

    let cfg = config();
    let ctx = build_context(&fixture_docs(), &cfg);
    let target = ExportTarget::new(project_type, theme);

    ensure_zola_project(
        &output,
        &ctx,
        &target,
        &workspace,
        Some(&repo_themes_root()),
    )
    .unwrap_or_else(|e| panic!("{} export failed: {e}", project_type.slug()));

    let result = std::process::Command::new(&zola)
        .arg("build")
        .current_dir(&output)
        .output()
        .expect("run zola");

    assert!(
        result.status.success(),
        "zola build failed for {} theme '{}':\n{}",
        project_type.slug(),
        theme,
        String::from_utf8_lossy(&result.stderr),
    );

    // The generated site must actually contain pages.
    let public = output.join("public");
    assert!(public.join("index.html").is_file(), "no index.html generated");
    assert!(
        public.join("guide").is_dir(),
        "nested section was not rendered",
    );
}

#[test]
fn docs_theme_builds_a_real_site() {
    build_site_with(ProjectType::Docs, "default");
}

#[test]
fn blog_theme_builds_a_real_site() {
    build_site_with(ProjectType::Blog, "default");
}

#[test]
fn book_theme_builds_a_real_site() {
    build_site_with(ProjectType::Book, "default");
}

#[test]
fn slides_theme_builds_a_real_site() {
    build_site_with(ProjectType::Slides, "default");
}

#[test]
fn base_theme_builds_a_real_site() {
    build_site_with(ProjectType::Docs, "base");
}

/// Every project type must have a default theme that renders, so the export
/// menu can never offer a target with nothing behind it.
#[test]
fn every_project_type_has_a_working_default_theme() {
    for project_type in ProjectType::all() {
        let themes = crate::export::site::theme::ThemeRoots::new(
            Path::new("/nonexistent-workspace"),
            Some(&repo_themes_root()),
            project_type,
        );
        assert!(
            themes.resolve("default").is_some(),
            "{} has no bundled 'default' theme",
            project_type.slug(),
        );
    }
}
