//! RED-phase specification suite for the export pipeline.
//!
//! These tests encode the *intended* contract of the export pipeline, not its
//! current behaviour. Tests marked `SPEC` are expected to FAIL against the
//! current implementation — each one pins a defect described in the
//! architecture review. Tests marked `GUARD` already pass and exist to lock in
//! correct behaviour so the GREEN phase cannot regress it.

use crate::export::normalize::build_context;
use crate::export::normalize::headings::build_heading_tree;
use crate::export::site::content::{write_config_toml, write_pages};
use crate::export::site::project::{ensure_zola_project, find_index_page};
use crate::export::site::theme::get_theme_dir;
use crate::export::types::{DocInfo, ExportTarget, PageInfo, ProjectConfig, ProjectType};
use crate::export::utils::paths::{compute_slug, matches_exclude};
use crate::export::utils::title::to_anchor;
use crate::export::utils::toml::{escape_toml, strip_frontmatter};

use std::collections::HashMap;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/// Self-cleaning scratch directory. Uses `uuid`, already a crate dependency,
/// so the RED phase adds no new Cargo entries.
struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let p = std::env::temp_dir().join(format!(
            "frontmatter-export-test-{}-{}",
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

fn cfg() -> ProjectConfig {
    ProjectConfig {
        title: None,
        author: None,
        description: None,
        exclude: vec![],
        order: vec![],
        theme: None,
        excerpt: HashMap::new(),
        custom: None,
        index_page: None,
        base_url: None,
    }
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
        excerpt: None,
        word_count: 400,
        file_created_at: None,
        updated_at: None,
        content: content.to_string(),
    }
}

fn pages_for(docs: &[DocInfo], config: &ProjectConfig) -> Vec<PageInfo> {
    build_context(docs, config).pages
}

fn read(path: &Path) -> String {
    std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("expected file {} to exist: {}", path.display(), e))
}

// ---------------------------------------------------------------------------
// Group A — anchor generation (utils::title::to_anchor)
// ---------------------------------------------------------------------------

#[test]
fn guard_anchor_lowercases_and_hyphenates() {
    assert_eq!(to_anchor("Getting Started"), "getting-started");
}

#[test]
fn guard_anchor_drops_punctuation() {
    assert_eq!(to_anchor("What's New?"), "whats-new");
}

#[test]
fn spec_anchor_collapses_runs_of_whitespace() {
    // A heading rendered with irregular spacing must still produce a single
    // hyphen, otherwise the in-page TOC link never matches the rendered id.
    assert_eq!(to_anchor("Hello   World"), "hello-world");
}

#[test]
fn spec_anchor_trims_leading_and_trailing_separators() {
    assert_eq!(to_anchor("  Trailing  "), "trailing");
    assert_eq!(to_anchor("— Dash Lead"), "dash-lead");
}

// ---------------------------------------------------------------------------
// Group B — heading tree (normalize::headings)
// ---------------------------------------------------------------------------

#[test]
fn guard_heading_tree_nests_by_level() {
    let tree = build_heading_tree("# Top\n## Middle\n### Leaf\n");
    assert_eq!(tree.len(), 1);
    assert_eq!(tree[0].text, "Top");
    assert_eq!(tree[0].children.len(), 1);
    assert_eq!(tree[0].children[0].children[0].text, "Leaf");
}

#[test]
fn guard_heading_requires_space_after_hashes() {
    assert!(build_heading_tree("#hashtag not a heading\n").is_empty());
}

#[test]
fn spec_heading_tree_ignores_hashes_inside_fenced_code() {
    let md = "# Title\n\n```python\n# not a heading\nx = 1\n```\n\n## Real Section\n";
    let tree = build_heading_tree(md);
    assert_eq!(tree.len(), 1, "code comments must not become top-level headings");
    assert_eq!(tree[0].text, "Title");
    assert_eq!(tree[0].children.len(), 1);
    assert_eq!(tree[0].children[0].text, "Real Section");
}

#[test]
fn spec_heading_tree_ignores_hashes_inside_tilde_fences() {
    let tree = build_heading_tree("# Title\n\n~~~sh\n# comment\n~~~\n");
    assert_eq!(tree.len(), 1);
    assert!(tree[0].children.is_empty());
}

#[test]
fn spec_duplicate_headings_get_unique_anchors() {
    let tree = build_heading_tree("## Overview\n## Overview\n");
    assert_eq!(tree.len(), 2);
    assert_eq!(tree[0].anchor, "overview");
    assert_eq!(
        tree[1].anchor, "overview-1",
        "colliding anchors silently break every second TOC link"
    );
}

// ---------------------------------------------------------------------------
// Group C — slugs (utils::paths::compute_slug)
// ---------------------------------------------------------------------------

#[test]
fn guard_slug_strips_ordering_prefix() {
    assert_eq!(compute_slug("01-getting-started.md"), "getting-started");
}

#[test]
fn spec_slug_is_never_empty() {
    // A purely numeric filename currently slugs to "" and Zola then emits the
    // page at the parent URL, silently shadowing the section index.
    assert_eq!(compute_slug("123.md"), "123");
    assert!(!compute_slug("2024.md").is_empty());
}

#[test]
fn spec_slug_preserves_year_like_prefixes() {
    // An ordering prefix is a short run of digits. A four-digit year is part of
    // the title and must survive.
    assert_eq!(
        compute_slug("2024-annual-report.md"),
        "2024-annual-report"
    );
}

#[test]
fn spec_slugs_are_unique_across_the_whole_site() {
    let docs = vec![
        doc("guide/intro.md", "# Guide Intro"),
        doc("reference/intro.md", "# Reference Intro"),
    ];
    let pages = pages_for(&docs, &cfg());
    let a = &pages[0].slug;
    let b = &pages[1].slug;
    assert_ne!(
        a, b,
        "two pages resolving to the same slug collide at the same Zola URL"
    );
}

// ---------------------------------------------------------------------------
// Group D — exclude matching (utils::paths::matches_exclude)
// ---------------------------------------------------------------------------

#[test]
fn guard_exclude_matches_directory_prefix() {
    assert!(matches_exclude("drafts/wip.md", &["drafts/".to_string()]));
}

#[test]
fn guard_exclude_matches_bare_filename_in_any_folder() {
    assert!(matches_exclude(
        "notes/private.md",
        &["private.md".to_string()]
    ));
}

#[test]
fn spec_exclude_matches_whole_path_segments_only() {
    // "drafts/" must not swallow a sibling directory that merely starts with
    // the same characters.
    assert!(
        !matches_exclude("archive/drafts-old/x.md", &["drafts/".to_string()]),
        "substring matching excludes documents the user meant to publish"
    );
}

#[test]
fn spec_exclude_supports_glob_patterns() {
    // `glob` is already a dependency; the config field is documented as
    // patterns, so patterns must actually work.
    assert!(matches_exclude("notes/scratch.tmp.md", &["*.tmp.md".to_string()]));
    assert!(matches_exclude("a/b/c/deep.md", &["**/deep.md".to_string()]));
    assert!(!matches_exclude("notes/keep.md", &["*.tmp.md".to_string()]));
}

// ---------------------------------------------------------------------------
// Group E — TOML emission (utils::toml, utils::frontmatter, site::content)
// ---------------------------------------------------------------------------

#[test]
fn guard_escape_toml_escapes_quotes_and_backslashes() {
    assert_eq!(escape_toml(r#"a"b\c"#), r#"a\"b\\c"#);
}

#[test]
fn spec_escape_toml_escapes_control_characters() {
    // A raw newline inside a TOML basic string is a parse error, and excerpts
    // come straight out of the documents table.
    assert_eq!(escape_toml("line1\nline2"), "line1\\nline2");
    assert!(!escape_toml("a\tb").contains('\t'));
}

#[test]
fn spec_config_toml_escapes_description_and_author() {
    let tmp = TempDir::new("config-escape");
    let mut c = cfg();
    c.description = Some(r#"He said "hello""#.to_string());
    c.author = Some(r#"O"Brien"#.to_string());

    write_config_toml(tmp.path(), &c, "My Site");

    let out = read(&tmp.path().join("config.toml"));
    assert!(
        out.contains(r#"description = "He said \"hello\"""#),
        "unescaped quotes in description produce an invalid config.toml, \
         which fails the entire zola build. Got:\n{out}"
    );
    assert!(out.contains(r#"author = "O\"Brien""#), "author is not escaped either");
}

#[test]
fn spec_page_frontmatter_never_emits_a_raw_newline_in_a_value() {
    let tmp = TempDir::new("page-frontmatter");
    let mut d = doc("notes/entry.md", "# Entry\n\nbody\n");
    d.excerpt = Some("first line\nsecond line".to_string());
    let pages = pages_for(&[d], &cfg());

    write_pages(&tmp.path().join("content"), &pages, None);

    let out = read(&tmp.path().join("content").join("notes").join("entry.md"));
    let frontmatter = out.split("+++").nth(1).unwrap_or_default();
    let description_line = frontmatter
        .lines()
        .find(|l| l.trim_start().starts_with("description ="))
        .expect("description key present");
    assert!(
        description_line.trim_end().ends_with('"'),
        "multi-line excerpt broke out of its TOML string: {description_line:?}"
    );
}

// ---------------------------------------------------------------------------
// Group F — content layout (site::content::write_pages)
// ---------------------------------------------------------------------------

#[test]
fn spec_leaf_page_in_a_folder_is_written_as_a_page() {
    let tmp = TempDir::new("leaf-page");
    let content_dir = tmp.path().join("content");
    let docs = vec![
        doc("guide/intro.md", "# Intro\n\nhello\n"),
        doc("guide/advanced.md", "# Advanced\n\nmore\n"),
    ];
    let pages = pages_for(&docs, &cfg());

    write_pages(&content_dir, &pages, None);

    assert!(
        content_dir.join("guide").join("intro.md").is_file(),
        "a leaf document must become a page, not a section"
    );
    assert!(
        !content_dir.join("guide").join("intro").join("_index.md").exists(),
        "leaf documents must not be promoted to section indexes"
    );
}

#[test]
fn spec_folder_note_becomes_the_section_index() {
    let tmp = TempDir::new("folder-note");
    let content_dir = tmp.path().join("content");
    let docs = vec![
        doc("guide.md", "# Guide\n\noverview\n"),
        doc("guide/intro.md", "# Intro\n\nhello\n"),
    ];
    let pages = pages_for(&docs, &cfg());

    write_pages(&content_dir, &pages, None);

    let index = content_dir.join("guide").join("_index.md");
    assert!(
        index.is_file(),
        "a document that is the parent of other documents is the section index"
    );
    assert!(read(&index).contains("overview"));
    assert!(
        !content_dir.join("guide.md").exists(),
        "the folder note must not also be emitted as a sibling page"
    );
}

#[test]
fn spec_nested_pages_keep_their_page_metadata() {
    let tmp = TempDir::new("nested-meta");
    let content_dir = tmp.path().join("content");
    let docs = vec![
        doc("guide/intro.md", "# Intro\n\nhello\n"),
        doc("guide/advanced.md", "# Advanced\n\nmore\n"),
    ];
    let pages = pages_for(&docs, &cfg());

    write_pages(&content_dir, &pages, None);

    let out = read(&content_dir.join("guide").join("intro.md"));
    assert!(out.contains("template = \"page.html\""));
    assert!(out.contains("word_count = 400"));
    assert!(
        out.contains("reading_time_minutes"),
        "themes render reading time on every page; the section path drops it"
    );
}

// ---------------------------------------------------------------------------
// Group G — theme resolution (site::theme, site::project)
// ---------------------------------------------------------------------------

#[test]
fn spec_list_offers_only_directories_that_can_render() {
    let tmp = TempDir::new("theme-listing");
    let root = tmp.path().join("themes").join("blog");
    // A real theme, and two directories that are not themes.
    std::fs::create_dir_all(root.join("minimal").join("templates")).unwrap();
    std::fs::create_dir_all(root.join("scratch-notes")).unwrap();
    std::fs::create_dir_all(tmp.path().join("themes").join("skills")).unwrap();

    let listed = crate::export::utils::theme::list_themes(tmp.path(), ProjectType::Blog);

    assert_eq!(
        listed.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
        vec!["minimal"],
        "only directories carrying templates are themes"
    );
}

#[test]
fn spec_named_theme_resolves_within_its_project_type() {
    let tmp = TempDir::new("theme-resolve");
    let theme = tmp.path().join("themes").join("blog").join("minimal");
    std::fs::create_dir_all(&theme).unwrap();

    let resolved = get_theme_dir("minimal", tmp.path(), ProjectType::Blog);

    assert_eq!(
        resolved, theme,
        "a theme id returned by list_theme_options must resolve back to its directory"
    );
}

#[test]
fn spec_export_honours_the_selected_project_type_and_theme() {
    let tmp = TempDir::new("theme-copy");
    let workspace = tmp.path().join("ws");
    let output = tmp.path().join("out");
    let theme_templates = workspace.join("themes").join("blog").join("minimal").join("templates");
    std::fs::create_dir_all(&theme_templates).unwrap();
    std::fs::write(theme_templates.join("index.html"), "<h1>minimal</h1>").unwrap();

    let ctx = build_context(&[doc("post.md", "# Post\n\nbody\n")], &cfg());
    let target = ExportTarget::new(ProjectType::Blog, "minimal");
    ensure_zola_project(&output, &ctx, &target, &workspace, None).expect("export succeeds");

    let copied = output.join("templates").join("index.html");
    assert!(
        copied.is_file(),
        "the chosen theme was never copied — export_project_zola discards project_type \
         and ensure_zola_project hardcodes \"documentation\", so no theme is ever found"
    );
    assert_eq!(read(&copied), "<h1>minimal</h1>");
}

#[test]
fn spec_unresolvable_theme_is_an_error_not_a_silent_empty_site() {
    let tmp = TempDir::new("theme-missing");
    let resolved = get_theme_dir("does-not-exist", tmp.path(), ProjectType::Blog);
    assert!(
        !resolved.exists(),
        "precondition: nothing on disk for this theme"
    );

    // Every theme offered to the user must resolve to a real directory.
    let listed = crate::export::utils::theme::list_themes(tmp.path(), ProjectType::Blog);
    assert!(
        listed
            .iter()
            .all(|t| get_theme_dir(&t.id, tmp.path(), ProjectType::Blog).exists()),
        "list_theme_options offered a theme that does not exist on disk"
    );

    // And an unresolvable theme must surface as an error, not a silent
    // template-less site reported as a success.
    let ctx = build_context(&[doc("post.md", "# Post\n\nbody\n")], &cfg());
    let target = ExportTarget::new(ProjectType::Blog, "does-not-exist");
    let err = ensure_zola_project(&tmp.path().join("out"), &ctx, &target, tmp.path(), None)
        .expect_err("unresolvable theme must be an error");
    assert!(err.contains("does-not-exist"), "error names the missing theme: {err}");
}

// ---------------------------------------------------------------------------
// Group H — ordering and navigation (normalize::build_context)
// ---------------------------------------------------------------------------

#[test]
fn guard_default_order_sorts_by_numeric_prefix_then_path() {
    let docs = vec![
        doc("02-second.md", "# Second"),
        doc("01-first.md", "# First"),
    ];
    let pages = pages_for(&docs, &cfg());
    assert_eq!(pages[0].file_path, "01-first.md");
    assert_eq!(pages[1].file_path, "02-second.md");
}

#[test]
fn guard_prev_next_chain_is_linked_and_terminated() {
    let docs = vec![doc("a.md", "# A"), doc("b.md", "# B")];
    let pages = pages_for(&docs, &cfg());
    assert!(pages[0].prev.is_none());
    assert_eq!(pages[0].next.as_ref().unwrap().0, "b.html");
    assert!(pages[1].next.is_none());
}

#[test]
fn spec_partial_explicit_order_appends_the_rest_deterministically() {
    let docs = vec![
        doc("zeta.md", "# Zeta"),
        doc("alpha.md", "# Alpha"),
        doc("intro.md", "# Intro"),
    ];
    let mut c = cfg();
    c.order = vec!["intro.md".to_string()];

    let pages = pages_for(&docs, &c);

    assert_eq!(pages[0].file_path, "intro.md");
    assert_eq!(
        pages[1].file_path, "alpha.md",
        "documents missing from config.order must fall back to a stable sort, \
         not to unspecified SQLite row order"
    );
    assert_eq!(pages[2].file_path, "zeta.md");
}

#[test]
fn spec_index_page_is_removed_from_the_navigation_chain() {
    let docs = vec![
        doc("README.md", "# Home"),
        doc("a.md", "# A"),
        doc("b.md", "# B"),
    ];
    let mut c = cfg();
    c.index_page = Some("README.md".to_string());
    let pages = pages_for(&docs, &c);

    let index = find_index_page(&pages, c.index_page.as_deref()).expect("index page found");
    let index_html = index.html_path.clone();

    for p in &pages {
        if p.file_path == index.file_path {
            continue;
        }
        assert_ne!(
            p.prev.as_ref().map(|(h, _)| h.as_str()),
            Some(index_html.as_str()),
            "{} links back to the index, which write_pages never emits as a page",
            p.file_path
        );
        assert_ne!(
            p.next.as_ref().map(|(h, _)| h.as_str()),
            Some(index_html.as_str()),
            "{} links forward to the index, which write_pages never emits as a page",
            p.file_path
        );
    }
}

// ---------------------------------------------------------------------------
// Group I — frontmatter stripping (utils::toml::strip_frontmatter)
// ---------------------------------------------------------------------------

#[test]
fn guard_strips_yaml_frontmatter() {
    assert_eq!(strip_frontmatter("---\ntitle: x\n---\nBody\n"), "Body\n");
}

#[test]
fn guard_strips_toml_frontmatter() {
    assert_eq!(strip_frontmatter("+++\ntitle = \"x\"\n+++\nBody\n"), "Body\n");
}

#[test]
fn guard_leaves_plain_markdown_untouched() {
    let md = "# Title\n\nBody\n";
    assert_eq!(strip_frontmatter(md), md);
}

#[test]
fn spec_thematic_break_is_not_frontmatter() {
    // A document that opens with a horizontal rule currently loses everything
    // up to the second rule.
    let md = "---\n\nIntro paragraph\n\n---\n\nSecond section\n";
    assert_eq!(
        strip_frontmatter(md),
        md,
        "an opening thematic break was mistaken for a frontmatter delimiter \
         and the first section was deleted from the export"
    );
}

#[test]
fn spec_unterminated_frontmatter_is_left_intact() {
    let md = "---\ntitle: x\n\nBody with no closing delimiter\n";
    assert_eq!(strip_frontmatter(md), md);
}

#[test]
fn guard_document_relative_image_paths_are_repointed_at_the_site_root() {
    // Uploaded images live in `.assets/imgs` beside the document that uses
    // them. A page's URL in the built site bears no relation to its path on
    // disk, so a document-relative reference resolves to nothing once exported;
    // the export collects those folders into `static/.assets/imgs` instead.
    let config = cfg();
    let pages = pages_for(
        &[doc(
            "guides/intro.md",
            "# Intro\n\n![A diagram](./.assets/imgs/diagram-1a2b3c4d.webp)\n",
        )],
        &config,
    );

    assert_eq!(pages.len(), 1);
    assert!(
        pages[0].content.contains("](/.assets/imgs/diagram-1a2b3c4d.webp)"),
        "image reference was not repointed: {}",
        pages[0].content
    );
    assert!(
        !pages[0].content.contains("](./.assets/imgs/"),
        "document-relative form survived into the exported page"
    );
}

#[test]
fn guard_absolute_and_remote_image_urls_are_left_alone() {
    let config = cfg();
    let pages = pages_for(
        &[doc(
            "post.md",
            "# Post\n\n![CDN](https://cdn.example.com/assets/abc.webp)\n![Site](/images/logo.png)\n",
        )],
        &config,
    );

    assert!(pages[0].content.contains("https://cdn.example.com/assets/abc.webp"));
    assert!(pages[0].content.contains("](/images/logo.png)"));
}

// ---------------------------------------------------------------------------
// Group H — theme metadata (utils::theme)
//
// The contract these pin down: a theme is a directory with `templates/`, and
// nothing in `theme.toml` is required. Every assertion here exists so a future
// change cannot quietly start demanding a manifest.
// ---------------------------------------------------------------------------

/// Builds a listable theme directory, optionally with a manifest.
fn theme_fixture(root: &Path, id: &str, manifest: Option<&str>) -> PathBuf {
    let dir = root.join(id);
    std::fs::create_dir_all(dir.join("templates")).unwrap();
    std::fs::write(dir.join("templates").join("index.html"), "<h1>x</h1>").unwrap();
    if let Some(toml) = manifest {
        std::fs::write(dir.join("theme.toml"), toml).unwrap();
    }
    dir
}

fn list_bundled(workspace: &Path, bundled: &Path, t: ProjectType) -> Vec<crate::export::types::ThemeOption> {
    crate::export::utils::theme::ThemeRoots::new(workspace, Some(bundled), t).list()
}

#[test]
fn spec_theme_without_a_manifest_is_named_after_its_folder() {
    let tmp = TempDir::new("theme-no-manifest");
    let root = tmp.path().join("themes").join("docs");
    theme_fixture(&root, "my-custom-theme", None);

    let listed = crate::export::utils::theme::list_themes(tmp.path(), ProjectType::Docs);

    assert_eq!(listed.len(), 1, "a theme.toml is not required to be listed");
    assert_eq!(listed[0].name, "My Custom Theme", "the folder name is title-cased");
    assert_eq!(listed[0].description, "");
    assert!(listed[0].screenshot.is_none());
    assert!(listed[0].options.is_empty());
}

#[test]
fn spec_malformed_manifest_does_not_hide_the_theme() {
    let tmp = TempDir::new("theme-bad-manifest");
    let root = tmp.path().join("themes").join("docs");
    theme_fixture(&root, "broken", Some("name = \"Unclosed\nthis is not toml ["));

    let listed = crate::export::utils::theme::list_themes(tmp.path(), ProjectType::Docs);

    assert_eq!(listed.len(), 1, "an unparseable manifest must not drop the theme");
    assert_eq!(
        listed[0].name, "Broken",
        "the theme falls back to its folder name rather than vanishing"
    );
}

#[test]
fn spec_partial_manifest_fills_only_what_it_declares() {
    let tmp = TempDir::new("theme-partial");
    let root = tmp.path().join("themes").join("docs");
    theme_fixture(&root, "half", Some("description = \"Only a description.\"\n"));

    let listed = crate::export::utils::theme::list_themes(tmp.path(), ProjectType::Docs);

    assert_eq!(listed[0].name, "Half", "an absent name falls back to the folder");
    assert_eq!(listed[0].description, "Only a description.");
}

#[test]
fn spec_manifest_reads_nested_author_and_declared_options() {
    let tmp = TempDir::new("theme-full");
    let root = tmp.path().join("themes").join("docs");
    // The previous line-scanning parser could not see into either table, so
    // `[author]` and `[[extra.options]]` were invisible.
    theme_fixture(
        &root,
        "full",
        Some(
            r#"
name = "Full"
description = "Everything declared."

[author]
name = "Ada"

[[extra.options]]
key = "repo_url"
label = "Source repository"
type = "text"
default = ""

[[extra.options]]
key = "show_toc"
type = "boolean"
default = true
"#,
        ),
    );

    let listed = crate::export::utils::theme::list_themes(tmp.path(), ProjectType::Docs);
    let theme = &listed[0];

    assert_eq!(theme.author.as_deref(), Some("Ada"));
    assert_eq!(theme.options.len(), 2);
    assert_eq!(theme.options[0].key, "repo_url");
    assert_eq!(theme.options[0].label.as_deref(), Some("Source repository"));
    assert_eq!(theme.options[1].key, "show_toc");
    assert!(
        matches!(theme.options[1].kind, crate::export::types::ThemeOptionKind::Boolean),
        "the field's `type` selects the control it renders as"
    );
}

#[test]
fn spec_screenshot_is_found_by_convention_and_by_declaration() {
    let tmp = TempDir::new("theme-screenshot");
    let root = tmp.path().join("themes").join("docs");

    // Conventional filename, undeclared.
    let implicit = theme_fixture(&root, "implicit", Some("name = \"Implicit\"\n"));
    std::fs::write(implicit.join("screenshot.png"), b"png").unwrap();

    // Declared under a different name.
    let explicit = theme_fixture(&root, "explicit", Some("name = \"E\"\nscreenshot = \"preview/cover.png\"\n"));
    std::fs::create_dir_all(explicit.join("preview")).unwrap();
    std::fs::write(explicit.join("preview").join("cover.png"), b"png").unwrap();

    // Declared but absent — the card falls back to a wireframe rather than a
    // broken image.
    theme_fixture(&root, "missing", Some("name = \"M\"\nscreenshot = \"nope.png\"\n"));

    let listed = crate::export::utils::theme::list_themes(tmp.path(), ProjectType::Docs);
    let by_id = |id: &str| listed.iter().find(|t| t.id == id).unwrap();

    assert!(by_id("implicit").screenshot.as_deref().unwrap().ends_with("screenshot.png"));
    assert!(by_id("explicit").screenshot.as_deref().unwrap().ends_with("cover.png"));
    assert!(by_id("missing").screenshot.is_none());
}

#[test]
fn spec_screenshot_cannot_escape_the_theme_directory() {
    let tmp = TempDir::new("theme-escape");
    let root = tmp.path().join("themes").join("docs");
    std::fs::write(tmp.path().join("secret.png"), b"png").unwrap();
    theme_fixture(&root, "sneaky", Some("screenshot = \"../../../secret.png\"\n"));

    let listed = crate::export::utils::theme::list_themes(tmp.path(), ProjectType::Docs);

    assert!(
        listed[0].screenshot.is_none(),
        "a manifest must not be able to point the picker at files outside its own folder"
    );
}

#[test]
fn spec_workspace_theme_shadows_a_bundled_one_and_is_marked_custom() {
    let tmp = TempDir::new("theme-source");
    let workspace = tmp.path().join("ws");
    let bundled = tmp.path().join("bundled");

    theme_fixture(&workspace.join("themes").join("docs"), "default", Some("name = \"Mine\"\n"));
    theme_fixture(&bundled.join("docs"), "default", Some("name = \"Shipped\"\n"));
    theme_fixture(&bundled, "shared", Some("name = \"Shared\"\n"));

    let listed = list_bundled(&workspace, &bundled, ProjectType::Docs);
    let default = listed.iter().find(|t| t.id == "default").unwrap();

    assert_eq!(default.name, "Mine", "the workspace copy wins");
    assert_eq!(
        default.source,
        crate::export::types::ThemeSource::Workspace,
        "a workspace theme is badged Custom in the picker"
    );
    assert_eq!(
        listed.iter().find(|t| t.id == "shared").unwrap().source,
        crate::export::types::ThemeSource::Bundled,
    );
    assert_eq!(listed.len(), 2, "the shadowed bundled theme is not listed twice");
}

#[test]
fn spec_undecorated_theme_still_builds_a_site() {
    // The guarantee for third-party authors: no theme.toml, no screenshot, no
    // declared options — just templates — and the export works end to end.
    let tmp = TempDir::new("theme-bare");
    let workspace = tmp.path().join("ws");
    let output = tmp.path().join("out");
    let theme = workspace.join("themes").join("docs").join("bare");
    std::fs::create_dir_all(theme.join("templates")).unwrap();
    std::fs::write(theme.join("templates").join("index.html"), "<h1>bare</h1>").unwrap();
    std::fs::write(theme.join("templates").join("page.html"), "<article></article>").unwrap();

    let ctx = build_context(&[doc("intro.md", "# Intro\n\nbody\n")], &cfg());
    let target = ExportTarget::new(ProjectType::Docs, "bare");

    ensure_zola_project(&output, &ctx, &target, &workspace, None)
        .expect("a theme needs nothing but templates/");

    assert!(output.join("templates").join("index.html").is_file());
    assert!(output.join("config.toml").is_file());
}

#[test]
fn spec_pages_carry_a_top_level_date_so_dated_targets_can_sort() {
    use crate::export::utils::frontmatter::build_page_frontmatter;

    let mut source = doc("post.md", "# Post\n\nbody\n");
    source.file_created_at = Some("2026-03-04T10:00:00Z".to_string());

    let pages = pages_for(&[source], &cfg());
    let rendered = build_page_frontmatter(&pages[0], "post", 1);

    // `created_at` lived only under [extra], where Zola's sort cannot reach it,
    // so a blog set to sort_by = "date" silently kept input order.
    assert!(
        rendered.contains("date = 2026-03-04"),
        "a bare top-level date is what Zola sorts on; got:\n{rendered}"
    );
}

#[test]
fn spec_date_falls_back_to_updated_when_a_page_was_never_dated() {
    use crate::export::utils::frontmatter::build_page_frontmatter;

    let mut source = doc("post.md", "# Post\n\nbody\n");
    source.file_created_at = None;
    source.updated_at = Some("2025-11-02T09:15:00Z".to_string());

    let pages = pages_for(&[source], &cfg());
    let rendered = build_page_frontmatter(&pages[0], "post", 1);

    assert!(rendered.contains("date = 2025-11-02"), "got:\n{rendered}");
}

#[test]
fn spec_an_unparseable_timestamp_emits_no_date_rather_than_breaking_the_build() {
    use crate::export::utils::frontmatter::build_page_frontmatter;

    let mut source = doc("post.md", "# Post\n");
    source.file_created_at = Some("not a date".to_string());
    source.updated_at = None;

    let pages = pages_for(&[source], &cfg());
    let rendered = build_page_frontmatter(&pages[0], "post", 1);

    assert!(
        !rendered.contains("date ="),
        "an invalid date would fail `zola build` outright; got:\n{rendered}"
    );
}

// ---------------------------------------------------------------------------
// Group I2 — backlinks (normalize::pages)
// ---------------------------------------------------------------------------

/// Titles of the pages linking to `title`. Looked up by title rather than by
/// position, because `build_context` sorts the pages it returns.
fn backlinks_to(docs: &[DocInfo], title: &str) -> Vec<String> {
    pages_for(docs, &cfg())
        .into_iter()
        .find(|p| p.title == title)
        .unwrap_or_else(|| panic!("no page titled {title}"))
        .backlinks
        .into_iter()
        .map(|(_, t)| t)
        .collect()
}

#[test]
fn spec_a_link_between_documents_becomes_a_backlink_on_the_target() {
    let docs = [
        doc("intro.md", "# Intro\n\nSee [Concepts](concepts.md).\n"),
        doc("concepts.md", "# Concepts\n\nBody.\n"),
    ];

    assert_eq!(backlinks_to(&docs, "Concepts"), vec!["Intro".to_string()]);
    assert!(
        backlinks_to(&docs, "Intro").is_empty(),
        "a link is one-directional",
    );
}

#[test]
fn spec_relative_and_rooted_link_targets_both_resolve() {
    let docs = [
        doc("guide/a.md", "# A\n\n[B](./b.md) and [Top](../top.md)\n"),
        doc("guide/b.md", "# B\n"),
        doc("top.md", "# Top\n"),
    ];

    assert_eq!(backlinks_to(&docs, "B"), vec!["A".to_string()], "sibling link");
    assert_eq!(backlinks_to(&docs, "Top"), vec!["A".to_string()], "parent link");
}

#[test]
fn spec_anchors_and_external_links_do_not_produce_backlinks() {
    let docs = [
        doc(
            "intro.md",
            "# Intro\n\n[Site](https://example.com) [Mail](mailto:a@b.c) \
             [Self](#section) [Deep](concepts.md#overview)\n",
        ),
        doc("concepts.md", "# Concepts\n"),
    ];

    assert_eq!(
        backlinks_to(&docs, "Concepts"),
        vec!["Intro".to_string()],
        "an anchored target still names the document, and nothing else linked",
    );
}

#[test]
fn spec_an_image_is_not_a_link() {
    let docs = [
        doc("intro.md", "# Intro\n\n![Diagram](concepts.md)\n"),
        doc("concepts.md", "# Concepts\n"),
    ];

    assert!(
        backlinks_to(&docs, "Concepts").is_empty(),
        "the leading ! is what separates an image from a link",
    );
}

#[test]
fn spec_repeated_links_from_one_page_are_recorded_once() {
    let docs = [
        doc(
            "intro.md",
            "# Intro\n\n[One](concepts.md) then [again](concepts.md).\n",
        ),
        doc("concepts.md", "# Concepts\n"),
    ];

    assert_eq!(backlinks_to(&docs, "Concepts"), vec!["Intro".to_string()]);
}

// ---------------------------------------------------------------------------
// Group I — config.yml round trips (export::config)
// ---------------------------------------------------------------------------

#[test]
fn spec_saving_settings_keeps_keys_the_exporter_does_not_model() {
    use crate::export::config::{config_path, write_values};

    let tmp = TempDir::new("settings-unknown-keys");
    let workspace = tmp.path();

    // A key `ProjectConfig` has no field for. Round-tripping through the typed
    // struct would drop it, silently deleting the user's setting.
    let yaml = "title: Site\nmy_own_key: keep me\ncustom:\n  repo_url: https://example.com\n";
    let values: serde_yaml::Value = serde_yaml::from_str(yaml).unwrap();

    write_values(workspace, &values).expect("save");

    let saved = std::fs::read_to_string(config_path(workspace)).unwrap();
    assert!(saved.contains("my_own_key: keep me"), "got: {saved}");
    assert!(saved.contains("repo_url"), "nested values survive too; got: {saved}");
}

#[test]
fn spec_saving_settings_reports_what_the_exporter_will_read() {
    use crate::export::config::write_values;

    let tmp = TempDir::new("settings-typed-view");
    let values: serde_yaml::Value = serde_yaml::from_str(
        "title: My Site\nbase_url: https://example.com/docs/\n",
    )
    .unwrap();

    let payload = write_values(tmp.path(), &values).expect("save");

    assert_eq!(payload.config.title.as_deref(), Some("My Site"));
    assert_eq!(payload.config.base_url.as_deref(), Some("https://example.com/docs/"));
    assert_eq!(payload.values, values, "the editor gets back exactly what it sent");
}

#[test]
fn spec_a_value_the_exporter_cannot_read_is_rejected_before_the_write() {
    use crate::export::config::{config_path, write_values};

    let tmp = TempDir::new("settings-bad-type");
    let workspace = tmp.path();
    let good: serde_yaml::Value = serde_yaml::from_str("title: Working\n").unwrap();
    write_values(workspace, &good).unwrap();

    // `exclude` is a list; a string there would fail the export later. Catching
    // it here means a broken value never reaches the file.
    let bad: serde_yaml::Value = serde_yaml::from_str("title: Broken\nexclude: not-a-list\n").unwrap();
    let err = write_values(workspace, &bad).unwrap_err();

    assert!(err.contains("not valid"), "got: {err}");
    assert!(
        std::fs::read_to_string(config_path(workspace)).unwrap().contains("Working"),
        "a rejected edit must leave the working config untouched",
    );
}

#[test]
fn spec_publishing_records_the_chosen_theme() {
    use crate::export::config::{config_path, remember_theme, write_values};

    let tmp = TempDir::new("config-theme");
    let values: serde_yaml::Value =
        serde_yaml::from_str("title: Site\nauthor: Ada\n").unwrap();
    write_values(tmp.path(), &values).unwrap();

    remember_theme(tmp.path(), "editorial");

    let saved: ProjectConfig =
        serde_yaml::from_str(&std::fs::read_to_string(config_path(tmp.path())).unwrap()).unwrap();
    assert_eq!(saved.theme.as_deref(), Some("editorial"));
    assert_eq!(saved.title.as_deref(), Some("Site"), "other keys are left alone");
}

#[test]
fn spec_base_url_reaches_the_generated_config_toml() {
    let tmp = TempDir::new("config-base-url");
    let mut config = cfg();
    config.base_url = Some("https://example.com/docs/".to_string());

    write_config_toml(tmp.path(), &config, "Site");
    let toml = std::fs::read_to_string(tmp.path().join("config.toml")).unwrap();

    assert!(
        toml.contains(r#"base_url = "https://example.com/docs/""#),
        "a subpath deploy was previously impossible — base_url was hardcoded to /\ngot: {toml}"
    );
}

#[test]
fn guard_absent_base_url_still_defaults_to_root() {
    let tmp = TempDir::new("config-base-url-default");
    write_config_toml(tmp.path(), &cfg(), "Site");
    let toml = std::fs::read_to_string(tmp.path().join("config.toml")).unwrap();

    assert!(toml.contains(r#"base_url = "/""#), "got: {toml}");
}

// ---------------------------------------------------------------------------
// Group J — archive and scaffolding (export::archive, export::scaffold)
// ---------------------------------------------------------------------------

#[test]
fn spec_archive_contains_the_built_site_at_its_root() {
    use crate::export::archive::zip_directory;

    let tmp = TempDir::new("archive");
    let public = tmp.path().join("public");
    std::fs::create_dir_all(public.join("guide")).unwrap();
    std::fs::write(public.join("index.html"), "<h1>Home</h1>").unwrap();
    std::fs::write(public.join("guide").join("index.html"), "<h1>Guide</h1>").unwrap();

    let destination = tmp.path().join("site.zip");
    let count = zip_directory(&public, &destination).expect("zip");

    assert_eq!(count, 2);
    let names = zip_entry_names(&destination);
    assert!(names.contains(&"index.html".to_string()), "got: {names:?}");
    assert!(names.contains(&"guide/index.html".to_string()), "got: {names:?}");
}

#[test]
fn spec_archiving_before_a_build_explains_itself() {
    use crate::export::archive::zip_directory;

    let tmp = TempDir::new("archive-empty");
    let err = zip_directory(&tmp.path().join("public"), &tmp.path().join("s.zip")).unwrap_err();

    assert!(err.contains("Publish once"), "got: {err}");
}

fn zip_entry_names(path: &Path) -> Vec<String> {
    let file = std::fs::File::open(path).unwrap();
    let mut zip = zip::ZipArchive::new(file).unwrap();
    (0..zip.len())
        .map(|i| zip.by_index(i).unwrap().name().to_string())
        .filter(|n| !n.ends_with('/'))
        .collect()
}

